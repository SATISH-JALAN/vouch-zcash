//! pof-credit — the demo consumer of pof-gate receipts.
//!
//! Deliberately small: it exists to show a receipt is integrable, not to be a lending
//! protocol. A pool names the audience it accepts proofs for (the hash of its verifier
//! identifier) and a threshold. `open_line` reads a `ClaimReceipt`, checks audience,
//! threshold, expiry and that the signer is the account the proof was bound to, consumes the
//! receipt by CPI and opens a credit line. `draw` lends from the vault.
//!
//! A line is keyed by the proof it was opened against and its borrower
//! (`[b"line", subject, borrower]`): one proof, one line. Keying by borrower alone would not stop
//! anyone reusing funds (a second wallet gets around it), and it would let one open line block
//! every later proof bound to the same account. The borrower in the seed means another wallet
//! presenting the same receipt reaches the `NotBoundToSigner` check instead of a collision.
//!
//! FRESHNESS: a proof says "held at least X at block H", not "still holds it". Nothing locks the
//! notes, so the holder can spend them the moment the proof is made. A line therefore draws only
//! while its latest proof is fresh: for `fresh_secs` after it was presented (never past the
//! proof's own expiry). After that, `refresh_line` takes a new receipt for the same pool and
//! borrower, against an anchor no older than the line's last one and no older than the pool's
//! `min_anchor_height`. The pool's authority raises that floor as newer anchors are published, so
//! how stale a snapshot can be is the lender's call. A holder who spent the funds cannot make a
//! new proof, and the line stops paying out. Like a bank statement: true when issued, and a
//! lender asks for a new one.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use pof_gate::{program::PofGate, ClaimReceipt};

declare_id!("J6ewFZAzcTkbVsYNBrcZvzdBtTTUK5UrpqCg9jiNyra1");

/// How long a proof keeps a line drawable, until the pool's authority sets otherwise.
pub const DEFAULT_FRESH_SECS: i64 = 24 * 60 * 60;

#[program]
pub mod pof_credit {
    use super::*;

    pub fn init_pool(ctx: Context<InitPool>, audience: [u8; 32], required_zatoshi: u64, line_limit: u64) -> Result<()> {
        require!(required_zatoshi > 0 && line_limit > 0, CreditError::BadTerms);
        let p = &mut ctx.accounts.pool;
        p.authority = ctx.accounts.authority.key();
        p.mint = ctx.accounts.mint.key();
        p.vault = ctx.accounts.vault.key();
        p.audience = audience;
        p.required_zatoshi = required_zatoshi;
        p.line_limit = line_limit;
        p.bump = ctx.bumps.pool;
        p.fresh_secs = DEFAULT_FRESH_SECS;
        p.min_anchor_height = 0;
        Ok(())
    }

    /// The pool's authority sets how long a proof keeps a line drawable, and the oldest Zcash
    /// anchor the pool accepts when a line is opened or refreshed.
    pub fn set_freshness(ctx: Context<SetFreshness>, fresh_secs: i64, min_anchor_height: u32) -> Result<()> {
        require!(fresh_secs > 0, CreditError::BadTerms);
        let p = &mut ctx.accounts.pool;
        p.fresh_secs = fresh_secs;
        p.min_anchor_height = min_anchor_height;
        emit!(FreshnessChanged { pool: p.key(), fresh_secs, min_anchor_height });
        Ok(())
    }

    pub fn open_line(ctx: Context<OpenLine>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let borrower = ctx.accounts.borrower.key();
        let clock = Clock::get()?;
        accept(&ctx.accounts.receipt, pool, &borrower, pool.min_anchor_height, clock.unix_timestamp)?;
        consume(
            &ctx.accounts.receipt,
            &ctx.accounts.borrower,
            &ctx.accounts.consumer,
            &ctx.accounts.consumer_program,
            &ctx.accounts.gate_program,
            ctx.bumps.consumer,
        )?;

        let r = &ctx.accounts.receipt;
        let line = &mut ctx.accounts.line;
        line.pool = pool.key();
        line.borrower = borrower;
        line.limit = pool.line_limit;
        line.drawn = 0;
        line.opened_against = r.subject;
        line.anchor_height = r.anchor_height;
        line.opened_slot = clock.slot;
        line.bump = ctx.bumps.line;
        line.fresh_until = fresh_until(pool, r, clock.unix_timestamp);
        line.refreshed_against = r.subject;
        line.refreshes = 0;
        emit!(LineOpened { line: line.key(), borrower, limit: line.limit, against: line.opened_against });
        Ok(())
    }

    /// Present a new proof for an open line. The receipt must meet the pool's terms like the one
    /// that opened the line, and its anchor must be no older than the line's last.
    pub fn refresh_line(ctx: Context<RefreshLine>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let borrower = ctx.accounts.borrower.key();
        let now = Clock::get()?.unix_timestamp;
        let floor = pool.min_anchor_height.max(ctx.accounts.line.anchor_height);
        accept(&ctx.accounts.receipt, pool, &borrower, floor, now)?;
        consume(
            &ctx.accounts.receipt,
            &ctx.accounts.borrower,
            &ctx.accounts.consumer,
            &ctx.accounts.consumer_program,
            &ctx.accounts.gate_program,
            ctx.bumps.consumer,
        )?;

        let r = &ctx.accounts.receipt;
        let line = &mut ctx.accounts.line;
        line.anchor_height = r.anchor_height;
        line.fresh_until = fresh_until(pool, r, now);
        line.refreshed_against = r.subject;
        line.refreshes = line.refreshes.saturating_add(1);
        emit!(LineRefreshed { line: line.key(), against: r.subject, anchor_height: r.anchor_height, fresh_until: line.fresh_until });
        Ok(())
    }

    pub fn draw(ctx: Context<Draw>, amount: u64) -> Result<()> {
        let line = &mut ctx.accounts.line;
        require!(Clock::get()?.unix_timestamp < line.fresh_until, CreditError::NeedsFreshProof);
        let after = line.drawn.checked_add(amount).ok_or(CreditError::OverLimit)?;
        require!(amount > 0 && after <= line.limit, CreditError::OverLimit);
        line.drawn = after;
        let pool = &ctx.accounts.pool;
        let mint = pool.mint;
        let seeds: &[&[u8]] = &[b"pool", mint.as_ref(), &[pool.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.borrower_token.to_account_info(), authority: ctx.accounts.pool.to_account_info() },
                &[seeds],
            ),
            amount,
        )?;
        Ok(())
    }
}

/// The checks a receipt must pass to open or refresh a line in `pool` for `borrower`.
fn accept(r: &ClaimReceipt, pool: &Pool, borrower: &Pubkey, min_anchor_height: u32, now: i64) -> Result<()> {
    require!(r.audience == pool.audience, CreditError::WrongAudience);
    require!(r.claim_value >= pool.required_zatoshi, CreditError::BelowThreshold);
    require_keys_eq!(r.beneficiary, *borrower, CreditError::NotBoundToSigner);
    require!(!r.consumed, CreditError::ReceiptConsumed);
    require!(r.expires_at > now, CreditError::ProofExpired);
    require!(r.anchor_height >= min_anchor_height, CreditError::AnchorTooOld);
    Ok(())
}

/// Spend the receipt in pof-gate, signing as this program's `[b"consumer"]` PDA.
fn consume<'info>(
    receipt: &Account<'info, ClaimReceipt>,
    borrower: &Signer<'info>,
    consumer: &UncheckedAccount<'info>,
    consumer_program: &Program<'info, program::PofCredit>,
    gate_program: &Program<'info, PofGate>,
    bump: u8,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"consumer", &[bump]];
    pof_gate::cpi::mark_consumed(CpiContext::new_with_signer(
        gate_program.key(),
        pof_gate::cpi::accounts::MarkConsumed {
            receipt: receipt.to_account_info(),
            beneficiary: borrower.to_account_info(),
            consumer: consumer.to_account_info(),
            consumer_program: consumer_program.to_account_info(),
        },
        &[seeds],
    ))
}

/// A proof keeps the line drawable for the pool's window, and never past its own expiry.
fn fresh_until(pool: &Pool, r: &ClaimReceipt, now: i64) -> i64 {
    now.saturating_add(pool.fresh_secs).min(r.expires_at)
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    /// blake2b("pof-audience:" ‖ identifier). Proofs for anyone else are refused.
    pub audience: [u8; 32],
    pub required_zatoshi: u64,
    /// Per-line limit, in the mint's base units.
    pub line_limit: u64,
    pub bump: u8,
    // Appended after `bump`, so readers of the fields above keep their offsets.
    /// How long a proof keeps a line drawable, in seconds.
    pub fresh_secs: i64,
    /// The oldest Zcash anchor height accepted when a line is opened or refreshed.
    pub min_anchor_height: u32,
}

#[account]
#[derive(InitSpace)]
pub struct CreditLine {
    pub pool: Pubkey,
    pub borrower: Pubkey,
    pub limit: u64,
    pub drawn: u64,
    /// The receipt subject (proof id) this line was opened against.
    pub opened_against: [u8; 32],
    /// The anchor of the latest proof: the one that opened the line, or the last refresh.
    pub anchor_height: u32,
    pub opened_slot: u64,
    pub bump: u8,
    // Appended after `bump`, so readers of the fields above keep their offsets.
    /// Draws are refused from this time on, until a refresh.
    pub fresh_until: i64,
    /// The receipt subject of the latest proof.
    pub refreshed_against: [u8; 32],
    pub refreshes: u32,
}

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(init, payer = authority, space = 8 + Pool::INIT_SPACE, seeds = [b"pool", mint.key().as_ref()], bump)]
    pub pool: Account<'info, Pool>,
    /// The pool's creator must control the mint: nobody can open a pool under someone else's asset.
    #[account(mint::authority = authority)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = authority, token::mint = mint, token::authority = pool, seeds = [b"vault", pool.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenLine<'info> {
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub receipt: Account<'info, ClaimReceipt>,
    #[account(init, payer = payer, space = 8 + CreditLine::INIT_SPACE, seeds = [b"line", receipt.subject.as_ref(), borrower.key().as_ref()], bump)]
    pub line: Account<'info, CreditLine>,
    pub borrower: Signer<'info>,
    /// Pays the line's rent, so a borrower needs no SOL (in the demo, the relayer).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: this program's consumer authority PDA; it signs the CPI into pof-gate.
    #[account(seeds = [b"consumer"], bump)]
    pub consumer: UncheckedAccount<'info>,
    /// This program, named to pof-gate as the consumer.
    pub consumer_program: Program<'info, program::PofCredit>,
    pub gate_program: Program<'info, PofGate>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetFreshness<'info> {
    #[account(mut, seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump, has_one = authority)]
    pub pool: Account<'info, Pool>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefreshLine<'info> {
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"line", line.opened_against.as_ref(), borrower.key().as_ref()], bump = line.bump, has_one = borrower, has_one = pool)]
    pub line: Account<'info, CreditLine>,
    #[account(mut)]
    pub receipt: Account<'info, ClaimReceipt>,
    pub borrower: Signer<'info>,
    /// CHECK: this program's consumer authority PDA; it signs the CPI into pof-gate.
    #[account(seeds = [b"consumer"], bump)]
    pub consumer: UncheckedAccount<'info>,
    /// This program, named to pof-gate as the consumer.
    pub consumer_program: Program<'info, program::PofCredit>,
    pub gate_program: Program<'info, PofGate>,
}

#[derive(Accounts)]
pub struct Draw<'info> {
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump, has_one = vault)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"line", line.opened_against.as_ref(), borrower.key().as_ref()], bump = line.bump, has_one = borrower, has_one = pool)]
    pub line: Account<'info, CreditLine>,
    pub borrower: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = pool.mint, token::authority = borrower)]
    pub borrower_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct LineOpened {
    pub line: Pubkey,
    pub borrower: Pubkey,
    pub limit: u64,
    pub against: [u8; 32],
}

#[event]
pub struct LineRefreshed {
    pub line: Pubkey,
    pub against: [u8; 32],
    pub anchor_height: u32,
    pub fresh_until: i64,
}

#[event]
pub struct FreshnessChanged {
    pub pool: Pubkey,
    pub fresh_secs: i64,
    pub min_anchor_height: u32,
}

#[error_code]
pub enum CreditError {
    #[msg("terms must be non-zero")]
    BadTerms,
    #[msg("the proof was made for a different verifier")]
    WrongAudience,
    #[msg("the proven amount is below this pool's threshold")]
    BelowThreshold,
    #[msg("the signer is not the account the proof is bound to")]
    NotBoundToSigner,
    #[msg("this receipt has already funded a line")]
    ReceiptConsumed,
    #[msg("the proof has expired")]
    ProofExpired,
    #[msg("draw exceeds the line's limit")]
    OverLimit,
    #[msg("the proof is older than this pool accepts: present a newer one")]
    AnchorTooOld,
    #[msg("the line's latest proof is no longer fresh: refresh it with a new proof")]
    NeedsFreshProof,
}
