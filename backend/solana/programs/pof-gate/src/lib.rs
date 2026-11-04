//! pof-gate — turns a signed Vouch attestation into an on-chain, replay-protected fact.
//!
//! Solana cannot verify a Halo2 proof over Pallas or read Zcash state. An allowlisted
//! attestor (pof-attest) runs the open-source verifier and signs a domain-separated message;
//! this program checks those signatures through instruction introspection and records a
//! `ClaimReceipt`. It knows nothing about lending: consumers read receipts and consume them.
//!
//! TRUST MODEL: this program trusts the attestor allowlist and nothing else. It performs no
//! Halo2 verification and has no view of Zcash. With `threshold > 1`, that many distinct
//! allowlisted attestors must have signed the same message.
//!
//! Signature checking: the transaction carries one or more Ed25519 native-program
//! instructions before `submit_attestation`. Each signature entry is accepted only if all
//! three of its data offsets point inside that same Ed25519 instruction (index u16::MAX), its
//! public key is on the allowlist, and its message is byte-for-byte the attestation passed to
//! this instruction. An entry whose offsets point into another instruction is rejected: that
//! is the classic introspection bug, where a signature over one message is presented as a
//! signature over another.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

declare_id!("A6WmRTgEAHC9GHstaj9oD8woVNRw9jgu31bpKVREXn8C");

pub const MESSAGE_LEN: usize = 139;
pub const DOMAIN: &[u8; 13] = b"POF-ATTEST-v1";
pub const MAX_ATTESTORS: usize = 8;
pub const CLAIM_HOLDS_AT_LEAST: u8 = 0;

/// The parsed attestation. Layout (little-endian): domain 13 · subject 32 · beneficiary 32 ·
/// audience 32 · claim_kind 1 · claim_value 8 · anchor_height 4 · expires_at 8 · verdict 1 ·
/// slot 8.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attestation {
    pub subject: [u8; 32],
    pub beneficiary: Pubkey,
    pub audience: [u8; 32],
    pub claim_kind: u8,
    pub claim_value: u64,
    pub anchor_height: u32,
    pub expires_at: i64,
    pub verdict: u8,
    pub slot: u64,
}

pub fn parse(m: &[u8]) -> Result<Attestation> {
    require!(m.len() == MESSAGE_LEN, GateError::BadLength);
    require!(&m[0..13] == DOMAIN, GateError::BadDomain);
    let arr = |r: std::ops::Range<usize>| -> [u8; 32] { m[r].try_into().unwrap() };
    let u64le = |at: usize| u64::from_le_bytes(m[at..at + 8].try_into().unwrap());
    Ok(Attestation {
        subject: arr(13..45),
        beneficiary: Pubkey::new_from_array(arr(45..77)),
        audience: arr(77..109),
        claim_kind: m[109],
        claim_value: u64le(110),
        anchor_height: u32::from_le_bytes(m[118..122].try_into().unwrap()),
        expires_at: i64::try_from(u64le(122)).map_err(|_| GateError::BadExpiry)?,
        verdict: m[130],
        slot: u64le(131),
    })
}

/// Count distinct allowlisted keys that signed exactly `message` in Ed25519 instructions
/// earlier in this transaction.
pub fn count_signers(ix_sysvar: &AccountInfo, message: &[u8], allowlist: &[Pubkey]) -> Result<usize> {
    let current = load_current_index_checked(ix_sysvar)? as usize;
    let mut signers: Vec<Pubkey> = Vec::new();
    for i in 0..current {
        let ix = load_instruction_at_checked(i, ix_sysvar)?;
        if ix.program_id != solana_sdk_ids::ed25519_program::ID {
            continue;
        }
        let d = &ix.data;
        require!(d.len() >= 2, GateError::BadEd25519);
        let n = d[0] as usize;
        let read_u16 = |at: usize| -> Result<usize> {
            let b = d.get(at..at + 2).ok_or(GateError::BadEd25519)?;
            Ok(u16::from_le_bytes([b[0], b[1]]) as usize)
        };
        for k in 0..n {
            let o = 2 + k * 14;
            let (sig_off, sig_ix) = (read_u16(o)?, read_u16(o + 2)?);
            let (pk_off, pk_ix) = (read_u16(o + 4)?, read_u16(o + 6)?);
            let (msg_off, msg_len, msg_ix) = (read_u16(o + 8)?, read_u16(o + 10)?, read_u16(o + 12)?);
            // every offset must point into this same instruction's data
            require!(sig_ix == u16::MAX as usize && pk_ix == u16::MAX as usize && msg_ix == u16::MAX as usize, GateError::ForeignOffsets);
            require!(d.len() >= sig_off + 64, GateError::BadEd25519);
            let pk = d.get(pk_off..pk_off + 32).ok_or(GateError::BadEd25519)?;
            let msg = d.get(msg_off..msg_off + msg_len).ok_or(GateError::BadEd25519)?;
            let key = Pubkey::new_from_array(pk.try_into().unwrap());
            if msg == message && allowlist.contains(&key) && !signers.contains(&key) {
                signers.push(key);
            }
        }
    }
    Ok(signers.len())
}

#[program]
pub mod pof_gate {
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
        emit!(AttestorsChanged { threshold, count: c.attestors.len() as u8 });
        Ok(())
    }

    /// Checks, cheapest first: layout and domain · verdict · claim kind · freshness · expiry ·
    /// signatures (introspection) · create the receipt (fails if it exists: replay protection).
    pub fn submit_attestation(ctx: Context<SubmitAttestation>, subject: [u8; 32], message: Vec<u8>) -> Result<()> {
        let a = parse(&message)?;
        require!(a.subject == subject, GateError::SubjectMismatch);
        require!(a.verdict == 0, GateError::NotValid);
        require!(a.claim_kind == CLAIM_HOLDS_AT_LEAST, GateError::UnknownClaim);
        let clock = Clock::get()?;
        let cfg = &ctx.accounts.config;
        require!(a.slot <= clock.slot && clock.slot - a.slot <= cfg.max_age_slots, GateError::Stale);
        require!(a.expires_at > clock.unix_timestamp, GateError::Expired);
        let signed = count_signers(&ctx.accounts.instructions, &message, &cfg.attestors)?;
        require!(signed >= cfg.threshold as usize, GateError::NotEnoughSignatures);

        let r = &mut ctx.accounts.receipt;
        r.subject = a.subject;
        r.beneficiary = a.beneficiary;
        r.audience = a.audience;
        r.claim_kind = a.claim_kind;
        r.claim_value = a.claim_value;
        r.anchor_height = a.anchor_height;
        r.expires_at = a.expires_at;
        r.attested_slot = a.slot;
        r.signers = signed as u8;
        r.created_slot = clock.slot;
        r.consumed = false;
        r.consumed_by = Pubkey::default();
        r.bump = ctx.bumps.receipt;
        emit!(ReceiptCreated { subject: a.subject, beneficiary: a.beneficiary, claim_value: a.claim_value, anchor_height: a.anchor_height });
        Ok(())
    }

    /// Called by a consumer program (by CPI) to spend a receipt exactly once. The beneficiary
    /// must sign, so nobody can burn someone else's receipt. The consumer program must sign too,
    /// through its `[b"consumer"]` PDA, so the program recorded in `consumed_by` is the one that called.
    pub fn mark_consumed(ctx: Context<MarkConsumed>) -> Result<()> {
        let r = &mut ctx.accounts.receipt;
        require!(!r.consumed, GateError::AlreadyConsumed);
        require_keys_eq!(r.beneficiary, ctx.accounts.beneficiary.key(), GateError::WrongBeneficiary);
        r.consumed = true;
        r.consumed_by = ctx.accounts.consumer_program.key();
        emit!(ReceiptConsumed { subject: r.subject, consumer: r.consumed_by });
        Ok(())
    }
}

fn validate_set(attestors: &[Pubkey], threshold: u8) -> Result<()> {
    require!(!attestors.is_empty() && attestors.len() <= MAX_ATTESTORS, GateError::BadAttestorSet);
    require!(threshold >= 1 && threshold as usize <= attestors.len(), GateError::BadAttestorSet);
    for (i, a) in attestors.iter().enumerate() {
        require!(!attestors[..i].contains(a), GateError::BadAttestorSet);
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
pub struct ClaimReceipt {
    /// blake2b(statement): one proof, one receipt.
    pub subject: [u8; 32],
    /// The Solana account the proof is bound to.
    pub beneficiary: Pubkey,
    /// blake2b of the verifier identifier the proof was made for.
    pub audience: [u8; 32],
    pub claim_kind: u8,
    pub claim_value: u64,
    pub anchor_height: u32,
    pub expires_at: i64,
    pub attested_slot: u64,
    pub signers: u8,
    pub created_slot: u64,
    pub consumed: bool,
    /// The consumer program that spent it.
    pub consumed_by: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// Must be the program's upgrade authority: otherwise anyone could create the config first
    /// and make themselves admin.
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ GateError::NotUpgradeAuthority)]
    pub program: Program<'info, program::PofGate>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ GateError::NotUpgradeAuthority)]
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
#[instruction(subject: [u8; 32])]
pub struct SubmitAttestation<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [b"receipt", subject.as_ref()],
        bump
    )]
    pub receipt: Account<'info, ClaimReceipt>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: address-constrained to the Instructions sysvar.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkConsumed<'info> {
    #[account(mut, seeds = [b"receipt", receipt.subject.as_ref()], bump = receipt.bump)]
    pub receipt: Account<'info, ClaimReceipt>,
    pub beneficiary: Signer<'info>,
    /// `[b"consumer"]` under `consumer_program`. Only that program can sign for it (invoke_signed),
    /// so this signature proves which program is consuming.
    #[account(seeds = [b"consumer"], bump, seeds::program = consumer_program.key())]
    pub consumer: Signer<'info>,
    /// CHECK: any program; the PDA signature above binds it to the caller. Recorded as consumed_by.
    #[account(executable)]
    pub consumer_program: UncheckedAccount<'info>,
}

#[event]
pub struct ReceiptCreated {
    pub subject: [u8; 32],
    pub beneficiary: Pubkey,
    pub claim_value: u64,
    pub anchor_height: u32,
}

#[event]
pub struct ReceiptConsumed {
    pub subject: [u8; 32],
    pub consumer: Pubkey,
}

#[event]
pub struct AttestorsChanged {
    pub threshold: u8,
    pub count: u8,
}

#[error_code]
pub enum GateError {
    #[msg("attestation must be 139 bytes")]
    BadLength,
    #[msg("attestation is not domain-separated as POF-ATTEST-v1")]
    BadDomain,
    #[msg("expiry out of range")]
    BadExpiry,
    #[msg("only Valid verdicts are accepted")]
    NotValid,
    #[msg("unknown claim kind")]
    UnknownClaim,
    #[msg("attestation is older than max_age_slots, or from the future")]
    Stale,
    #[msg("the proof behind this attestation has expired")]
    Expired,
    #[msg("malformed Ed25519 instruction")]
    BadEd25519,
    #[msg("an Ed25519 signature entry points outside its own instruction")]
    ForeignOffsets,
    #[msg("not enough allowlisted attestors signed this exact message")]
    NotEnoughSignatures,
    #[msg("receipt already consumed")]
    AlreadyConsumed,
    #[msg("signer is not the account the proof is bound to")]
    WrongBeneficiary,
    #[msg("attestor set must be 1–8 distinct keys with 1 ≤ threshold ≤ count")]
    BadAttestorSet,
    #[msg("the subject argument does not match the attestation")]
    SubjectMismatch,
    #[msg("only the program's upgrade authority can initialize it")]
    NotUpgradeAuthority,
}
