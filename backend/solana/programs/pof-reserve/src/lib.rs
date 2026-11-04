//! pof-reserve — shielded reserves as an on-chain feed, and a mint that cannot outrun it.
//!
//! A holder (a fund, a desk, a wrapped-ZEC issuer) proves its shielded reserves with a Vouch
//! batch: several proofs, one scope, no note counted twice, summed by the verifier. An allowlisted
//! attestor (pof-attest, `/v1/batch` with `attest`) signs the batch verdict; `publish` checks that
//! signature through instruction introspection — exactly as pof-gate does — and writes the
//! `Feed`: total, anchor block, when it was updated. Any program can read a feed; it is stale
//! once `heartbeat_slots` pass without a new publish, or once the proofs behind it expire.
//!
//! `secure_mint` is the Secure Mint pattern on that feed: the feed's own demo token (mint
//! authority: the feed PDA) mints only while the feed is fresh and only while supply + amount
//! stays within the proven reserves. 1 token unit = 1 zatoshi (8 decimals).
//!
//! TRUST MODEL: like pof-gate, this program trusts the attestor allowlist and nothing else. It
//! does no Halo2 verification and has no view of Zcash.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

declare_id!("5Q26Tjcd4equ5te5hF15eG4xK6uvkbZtKkEeqdf535h9");

pub const DOMAIN: &[u8; 14] = b"POF-RESERVE-v1";
/// domain 14 · scope 32 · audience 32 · total_zatoshi 8 · members 2 · anchor_height 4 ·
/// nc_height 4 · expires_at 8 · slot 8 (little-endian).
pub const MESSAGE_LEN: usize = 112;
pub const MAX_ATTESTORS: usize = 8;

/// A signed batch verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reserve {
    pub scope: [u8; 32],
    pub audience: [u8; 32],
    pub total_zatoshi: u64,
    pub members: u16,
    pub anchor_height: u32,
    /// The block the notes are shown unmoved since; equal to `anchor_height` when not shown.
    pub nc_height: u32,
    pub expires_at: i64,
    pub slot: u64,
}

pub fn parse(m: &[u8]) -> Result<Reserve> {
    require!(m.len() == MESSAGE_LEN, ReserveError::BadLength);
    require!(&m[0..14] == DOMAIN, ReserveError::BadDomain);
    let arr = |r: std::ops::Range<usize>| -> [u8; 32] { m[r].try_into().unwrap() };
    let u64le = |at: usize| u64::from_le_bytes(m[at..at + 8].try_into().unwrap());
    let u32le = |at: usize| u32::from_le_bytes(m[at..at + 4].try_into().unwrap());
    let r = Reserve {
        scope: arr(14..46),
        audience: arr(46..78),
        total_zatoshi: u64le(78),
        members: u16::from_le_bytes([m[86], m[87]]),
        anchor_height: u32le(88),
        nc_height: u32le(92),
        expires_at: i64::try_from(u64le(96)).map_err(|_| ReserveError::BadExpiry)?,
        slot: u64le(104),
    };
    require!(r.members >= 1 && r.nc_height <= r.anchor_height, ReserveError::BadMessage);
    Ok(r)
}

/// Distinct allowlisted keys that signed exactly `message` in Ed25519 instructions earlier in
/// this transaction, every offset pointing into its own instruction (the same rule as pof-gate).
pub fn count_signers(ix_sysvar: &AccountInfo, message: &[u8], allowlist: &[Pubkey]) -> Result<usize> {
    let current = load_current_index_checked(ix_sysvar)? as usize;
    let mut signers: Vec<Pubkey> = Vec::new();
    for i in 0..current {
        let ix = load_instruction_at_checked(i, ix_sysvar)?;
        if ix.program_id != solana_sdk_ids::ed25519_program::ID {
            continue;
        }
        let d = &ix.data;
        require!(d.len() >= 2, ReserveError::BadEd25519);
        let n = d[0] as usize;
        let read_u16 = |at: usize| -> Result<usize> {
            let b = d.get(at..at + 2).ok_or(ReserveError::BadEd25519)?;
            Ok(u16::from_le_bytes([b[0], b[1]]) as usize)
        };
        for k in 0..n {
            let o = 2 + k * 14;
            let (sig_off, sig_ix) = (read_u16(o)?, read_u16(o + 2)?);
            let (pk_off, pk_ix) = (read_u16(o + 4)?, read_u16(o + 6)?);
            let (msg_off, msg_len, msg_ix) = (read_u16(o + 8)?, read_u16(o + 10)?, read_u16(o + 12)?);
            require!(sig_ix == u16::MAX as usize && pk_ix == u16::MAX as usize && msg_ix == u16::MAX as usize, ReserveError::ForeignOffsets);
            require!(d.len() >= sig_off + 64, ReserveError::BadEd25519);
            let pk = d.get(pk_off..pk_off + 32).ok_or(ReserveError::BadEd25519)?;
            let msg = d.get(msg_off..msg_off + msg_len).ok_or(ReserveError::BadEd25519)?;
            let key = Pubkey::new_from_array(pk.try_into().unwrap());
            if msg == message && allowlist.contains(&key) && !signers.contains(&key) {
                signers.push(key);
            }
        }
    }
    Ok(signers.len())
}

#[program]
pub mod pof_reserve {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, attestors: Vec<Pubkey>, threshold: u8, max_age_slots: u64) -> Result<()> {
        validate_set(&attestors, threshold)?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.attestors = attestors;
        c.threshold = threshold;
        c.max_age_slots = max_age_slots;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_attestors(ctx: Context<AdminOnly>, attestors: Vec<Pubkey>, threshold: u8, max_age_slots: u64) -> Result<()> {
        validate_set(&attestors, threshold)?;
        let c = &mut ctx.accounts.config;
        c.attestors = attestors;
        c.threshold = threshold;
        c.max_age_slots = max_age_slots;
        Ok(())
    }

    /// A feed for one verifier identifier (its audience hash), with its own demo token that only
    /// `issuer` may mint. Admin only.
    pub fn init_feed(ctx: Context<InitFeed>, audience: [u8; 32], heartbeat_slots: u64, issuer: Pubkey) -> Result<()> {
        require!(heartbeat_slots > 0, ReserveError::BadHeartbeat);
        let f = &mut ctx.accounts.feed;
        f.audience = audience;
        f.issuer = issuer;
        f.mint = ctx.accounts.mint.key();
        f.heartbeat_slots = heartbeat_slots;
        f.bump = ctx.bumps.feed;
        Ok(())
    }

    /// Write a signed batch verdict to the feed. Anyone may submit it; only the allowlisted
    /// attestors' signatures make it count. A feed never goes back to an older anchor.
    pub fn publish(ctx: Context<Publish>, message: Vec<u8>) -> Result<()> {
        let r = parse(&message)?;
        let config = &ctx.accounts.config;
        let signed = count_signers(&ctx.accounts.instructions, &message, &config.attestors)?;
        require!(signed >= config.threshold as usize, ReserveError::NotEnoughSignatures);
        let clock = Clock::get()?;
        require!(r.slot <= clock.slot && clock.slot - r.slot <= config.max_age_slots, ReserveError::Stale);
        require!(r.expires_at > clock.unix_timestamp, ReserveError::Expired);
        let f = &mut ctx.accounts.feed;
        require!(r.audience == f.audience, ReserveError::WrongAudience);
        require!(r.anchor_height >= f.anchor_height, ReserveError::OlderAnchor);
        f.scope = r.scope;
        f.total_zatoshi = r.total_zatoshi;
        f.members = r.members;
        f.anchor_height = r.anchor_height;
        f.nc_height = r.nc_height;
        f.expires_at = r.expires_at;
        f.updated_slot = clock.slot;
        f.publishes = f.publishes.saturating_add(1);
        emit!(FeedUpdated { audience: f.audience, total_zatoshi: r.total_zatoshi, anchor_height: r.anchor_height, signers: signed as u8 });
        Ok(())
    }

    /// Secure Mint: the feed's token mints only while the feed is fresh and the supply stays
    /// within the proven reserves. The issuer signs.
    pub fn secure_mint(ctx: Context<SecureMint>, amount: u64) -> Result<()> {
        let f = &ctx.accounts.feed;
        let clock = Clock::get()?;
        require!(f.publishes > 0, ReserveError::NeverPublished);
        require!(clock.slot.saturating_sub(f.updated_slot) <= f.heartbeat_slots, ReserveError::StaleFeed);
        require!(f.expires_at > clock.unix_timestamp, ReserveError::Expired);
        let after = ctx.accounts.mint.supply.checked_add(amount).ok_or(ReserveError::OverReserves)?;
        require!(amount > 0 && after <= f.total_zatoshi, ReserveError::OverReserves);
        let audience = f.audience;
        let seeds: &[&[u8]] = &[b"feed", audience.as_ref(), &[f.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo { mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.to.to_account_info(), authority: ctx.accounts.feed.to_account_info() },
                &[seeds],
            ),
            amount,
        )?;
        emit!(SecureMinted { audience, amount, supply: after });
        Ok(())
    }
}

fn validate_set(attestors: &[Pubkey], threshold: u8) -> Result<()> {
    require!(!attestors.is_empty() && attestors.len() <= MAX_ATTESTORS, ReserveError::BadAttestorSet);
    require!(threshold >= 1 && threshold as usize <= attestors.len(), ReserveError::BadAttestorSet);
    for (i, a) in attestors.iter().enumerate() {
        require!(!attestors[..i].contains(a), ReserveError::BadAttestorSet);
    }
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    #[max_len(MAX_ATTESTORS)]
    pub attestors: Vec<Pubkey>,
    pub threshold: u8,
    pub max_age_slots: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Feed {
    /// blake2b of the verifier identifier the reserves were proven to.
    pub audience: [u8; 32],
    /// Who may mint the feed's token.
    pub issuer: Pubkey,
    pub mint: Pubkey,
    pub heartbeat_slots: u64,
    pub scope: [u8; 32],
    pub total_zatoshi: u64,
    pub members: u16,
    pub anchor_height: u32,
    pub nc_height: u32,
    pub expires_at: i64,
    pub updated_slot: u64,
    pub publishes: u32,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// Must be the program's upgrade authority: otherwise anyone could create the config first.
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ReserveError::NotUpgradeAuthority)]
    pub program: Program<'info, program::PofReserve>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ReserveError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(audience: [u8; 32])]
pub struct InitFeed<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Feed::INIT_SPACE, seeds = [b"feed", audience.as_ref()], bump)]
    pub feed: Account<'info, Feed>,
    #[account(init, payer = admin, mint::decimals = 8, mint::authority = feed, seeds = [b"mint", feed.key().as_ref()], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Publish<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"feed", feed.audience.as_ref()], bump = feed.bump)]
    pub feed: Account<'info, Feed>,
    /// CHECK: address-constrained to the Instructions sysvar.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SecureMint<'info> {
    #[account(seeds = [b"feed", feed.audience.as_ref()], bump = feed.bump, has_one = issuer, has_one = mint)]
    pub feed: Account<'info, Feed>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint)]
    pub to: Account<'info, TokenAccount>,
    pub issuer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct FeedUpdated {
    pub audience: [u8; 32],
    pub total_zatoshi: u64,
    pub anchor_height: u32,
    pub signers: u8,
}

#[event]
pub struct SecureMinted {
    pub audience: [u8; 32],
    pub amount: u64,
    pub supply: u64,
}

#[error_code]
pub enum ReserveError {
    #[msg("a reserve message is 112 bytes")]
    BadLength,
    #[msg("message is not domain-separated as POF-RESERVE-v1")]
    BadDomain,
    #[msg("expiry out of range")]
    BadExpiry,
    #[msg("malformed reserve message")]
    BadMessage,
    #[msg("malformed Ed25519 instruction")]
    BadEd25519,
    #[msg("an Ed25519 signature entry points outside its own instruction")]
    ForeignOffsets,
    #[msg("not enough allowlisted attestors signed this exact message")]
    NotEnoughSignatures,
    #[msg("the attestation is older than max_age_slots, or from the future")]
    Stale,
    #[msg("the proofs behind these reserves have expired")]
    Expired,
    #[msg("the reserves were proven to another verifier than this feed")]
    WrongAudience,
    #[msg("a feed never goes back to an older anchor")]
    OlderAnchor,
    #[msg("the feed has never been published")]
    NeverPublished,
    #[msg("the feed is stale: no publish within its heartbeat")]
    StaleFeed,
    #[msg("minting this would exceed the proven reserves")]
    OverReserves,
    #[msg("heartbeat must be at least one slot")]
    BadHeartbeat,
    #[msg("attestor set must be 1–8 distinct keys with 1 ≤ threshold ≤ count")]
    BadAttestorSet,
    #[msg("only the program's upgrade authority can initialize it")]
    NotUpgradeAuthority,
}
