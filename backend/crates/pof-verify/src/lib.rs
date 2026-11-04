//! The Vouch verifier. One implementation, compiled natively (CLI, attestor) and to WASM.
//!
//! Six checks, cheapest first; the first failure stops the run, and no cryptography is done
//! on an artifact that failed a cheap check. Chain data (the anchor table) and the
//! revocation list are passed in as data: this crate never touches the network or disk.

use std::collections::HashSet;

use pof_core::{audience_hash, decode, revocation_tag, Claim, DecodeError, Envelope};
pub use pof_zk::Verifier as ZkVerifier;
use serde::{Deserialize, Serialize};

/// One authenticated anchor: the two ledger roots at a finalised height, and where they came from.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorRecord {
    /// "mainnet", "testnet", or "demo" for the committed demonstration tree.
    pub network: String,
    pub height: u32,
    #[serde(default)]
    pub block_hash: Option<String>,
    /// hex, 32 bytes
    pub nc_root: String,
    /// hex, 32 bytes
    pub nf_root: String,
}

/// The typed outcome. This enum is the UI copy and the API surface.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum Verdict {
    Valid {
        claim: Claim,
        #[serde(rename = "anchorHeight")]
        anchor_height: u32,
        /// The block since which the notes have not moved, when the proof says so.
        #[serde(rename = "dormantSince", skip_serializing_if = "Option::is_none")]
        dormant_since: Option<u32>,
    },
    Expired {
        at: u64,
    },
    Revoked,
    WrongAudience,
    AnchorNotFound,
    /// The spent set the proof was made against is older than this verifier accepts.
    AnchorTooOld {
        #[serde(rename = "anchorHeight")]
        anchor_height: u32,
    },
    /// The notes are not shown to be unmoved since the block this verifier requires.
    NotDormantLongEnough {
        #[serde(rename = "dormantSince")]
        dormant_since: u32,
        required: u32,
    },
    /// Made for this verifier, but for another period (or with no shared scope at all, version 1).
    WrongScope {
        epoch: u64,
        required: u64,
    },
    /// A valid proof whose notes this verifier has already seen in the same scope.
    AlreadyUsed,
    ProofInvalid {
        detail: String,
    },
    Malformed {
        reason: String,
    },
}

impl Verdict {
    /// CLI exit code: 0 valid · 1 invalid · 2 expired · 3 malformed. The CLI keeps 4 for "could not run".
    pub fn exit_code(&self) -> i32 {
        match self {
            Verdict::Valid { .. } => 0,
            Verdict::Expired { .. } => 2,
            Verdict::Malformed { .. } => 3,
            _ => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    Pass,
    Fail,
    NotRun,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Check {
    pub id: &'static str,
    pub label: &'static str,
    pub status: CheckStatus,
    pub detail: String,
}

/// Human-readable projection of an envelope, for display. Mirrors the TypeScript `Envelope`.
/// The envelope carries its own `version`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeView {
    #[serde(flatten)]
    pub envelope: Envelope,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub verdict: Verdict,
    pub checks: Vec<Check>,
    pub envelope: Option<EnvelopeView>,
    pub size_bytes: usize,
    pub checksum: Option<String>,
    /// The anchor record the proof was checked against, when one matched.
    pub anchor: Option<AnchorRecord>,
    /// The scope the proof's tags belong to (hex), when it parsed. Same scope, same note, same tag.
    pub scope: Option<String>,
    /// The proof's five per-note tags (hex), for a verifier's reuse registry. Record them only
    /// for a Valid verdict.
    pub tags: Vec<String>,
    /// An exit certificate's revealed nullifiers (hex, circuit 2): the deposit it certifies must
    /// spend only these. Empty for any other proof.
    pub revealed: Vec<String>,
    /// Unix seconds the verification was evaluated at.
    pub now: u64,
    pub verifier: &'static str,
}

pub const VERIFIER_VERSION: &str = concat!("pof-verify ", env!("CARGO_PKG_VERSION"));

/// Everything a verification depends on besides the file itself.
pub struct Context<'a> {
    /// The verifier's own identifier; only its hash is compared.
    pub audience: &'a str,
    pub anchors: &'a [AnchorRecord],
    /// Published revocation secrets (hex, 32 bytes). Tags are derived from them.
    pub revoked_secrets: &'a [String],
    pub now: u64,
    pub zk: &'a ZkVerifier,
    pub policy: Policy,
    /// Tags (hex, 32 bytes) this verifier has already accepted in the scope it requires: its
    /// reuse registry. Passed in as data, like the revocation list.
    pub seen: &'a [String],
}

/// What this verifier additionally requires. The default requires nothing beyond the six checks,
/// which is how every version 1 verifier behaved.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    /// The chain tip as this verifier knows it. Needed for `max_anchor_age`.
    pub tip_height: Option<u32>,
    /// Refuse a spent set older than this many blocks below `tip_height`: how fresh "unmoved"
    /// must be. An exit wants this small.
    pub max_anchor_age: Option<u32>,
    /// Require the notes to be shown unmoved since this block or earlier (for example, a block
    /// before a known incident).
    pub dormant_since: Option<u32>,
    /// Require this epoch: the period the verifier asked for. Without it a holder could choose a
    /// fresh scope and reuse would never show.
    pub epoch: Option<u64>,
}

const ORDER: [(&str, &str); 6] = [
    ("format", "Format and version parse"),
    ("expiry", "Not expired"),
    ("revocation", "Not revoked"),
    ("audience", "Audience matches this verifier"),
    ("anchor", "Anchor is real"),
    ("proof", "Proof verifies against the claim"),
];

fn stamp(sec: u64) -> String {
    // yyyy-mm-dd hh:mm UTC without a date library (civil-from-days, Howard Hinnant).
    let days = (sec / 86_400) as i64;
    let secs = sec % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02} UTC", secs / 3_600, (secs % 3_600) / 60)
}

fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Parse a file given as raw bytes or as base64url text.
pub fn to_bytes(input: &[u8]) -> Result<Vec<u8>, DecodeError> {
    if input.starts_with(b"POF1") {
        return Ok(input.to_vec());
    }
    let text = std::str::from_utf8(input).map_err(|_| DecodeError::NotBase64)?;
    pof_core::from_base64url(text)
}

pub fn verify(input: &[u8], ctx: &Context) -> VerificationResult {
    verify_inner(input, ctx, |env| ctx.zk.verify_holding(env))
}

/// The six checks, with the cryptographic one supplied by the caller: `verify` checks the proof
/// alone, a batch defers it and checks every member's proof together.
fn verify_inner(input: &[u8], ctx: &Context, prove: impl FnOnce(&Envelope) -> Result<(), pof_zk::ZkError>) -> VerificationResult {
    let mut checks: Vec<Check> = ORDER
        .iter()
        .map(|(id, label)| Check { id, label, status: CheckStatus::NotRun, detail: "Not run — an earlier check failed.".into() })
        .collect();
    let mut set = |i: usize, status: CheckStatus, detail: String| {
        checks[i].status = status;
        checks[i].detail = detail;
    };
    let result = |verdict: Verdict, env: Option<&Envelope>, checksum: Option<[u8; 32]>, size: usize, anchor: Option<AnchorRecord>, checks: Vec<Check>| {
        VerificationResult {
            verdict,
            checks,
            envelope: env.map(|e| EnvelopeView { envelope: e.clone() }),
            size_bytes: size,
            checksum: checksum.map(hex::encode),
            anchor,
            scope: env.map(|e| hex::encode(pof_zk::scope_key(e))),
            tags: env.map(|e| pof_zk::tags(e).iter().map(hex::encode).collect()).unwrap_or_default(),
            revealed: env.and_then(pof_zk::revealed_nullifiers).map(|n| n.iter().map(hex::encode).collect()).unwrap_or_default(),
            now: ctx.now,
            verifier: VERIFIER_VERSION,
        }
    };

    // 1 · format
    let file = match to_bytes(input) {
        Ok(f) if !f.is_empty() => f,
        _ => {
            let reason = DecodeError::NotBase64.to_string();
            set(0, CheckStatus::Fail, reason.clone());
            return result(Verdict::Malformed { reason }, None, None, 0, None, checks);
        }
    };
    let size = file.len();
    let (env, checksum) = match decode(&file) {
        Ok(v) => v,
        Err(e) => {
            set(0, CheckStatus::Fail, e.to_string());
            return result(Verdict::Malformed { reason: e.to_string() }, None, None, size, None, checks);
        }
    };
    if !matches!(env.claim, Claim::HoldsAtLeast { .. }) {
        let reason = "This verifier version checks HoldsAtLeast proofs only.".to_string();
        set(0, CheckStatus::Fail, reason.clone());
        return result(Verdict::Malformed { reason }, Some(&env), Some(checksum), size, None, checks);
    }
    if env.claim.min_units().is_none() {
        let reason = "The threshold is not a whole number of 0.125 ZEC units.".to_string();
        set(0, CheckStatus::Fail, reason.clone());
        return result(Verdict::Malformed { reason }, Some(&env), Some(checksum), size, None, checks);
    }
    set(0, CheckStatus::Pass, format!("POF1 · version {} · {} bytes · checksum ok", env.version, thousands(size as u64)));

    // 2 · expiry
    if ctx.now >= env.expires_at {
        set(1, CheckStatus::Fail, format!("Expired {}.", stamp(env.expires_at)));
        return result(Verdict::Expired { at: env.expires_at }, Some(&env), Some(checksum), size, None, checks);
    }
    let days = (env.expires_at - ctx.now) / 86_400;
    set(1, CheckStatus::Pass, format!("Valid until {} — {} day{} left.", stamp(env.expires_at), days, if days == 1 { "" } else { "s" }));

    // 3 · revocation
    let revoked: HashSet<[u8; 16]> = ctx
        .revoked_secrets
        .iter()
        .filter_map(|s| hex::decode(s.trim()).ok()?.try_into().ok())
        .map(|secret: [u8; 32]| revocation_tag(&secret))
        .collect();
    if revoked.contains(&env.revocation) {
        set(2, CheckStatus::Fail, "The holder revoked this proof: its revocation secret is published.".into());
        return result(Verdict::Revoked, Some(&env), Some(checksum), size, None, checks);
    }
    set(2, CheckStatus::Pass, format!("Tag {}… is not on the revocation list ({} revoked).", &hex::encode(env.revocation)[..8], revoked.len()));

    // 4 · audience
    if audience_hash(ctx.audience) != env.audience {
        set(3, CheckStatus::Fail, format!("This proof was made for someone else. Your identifier \"{}\" does not match.", ctx.audience.trim()));
        return result(Verdict::WrongAudience, Some(&env), Some(checksum), size, None, checks);
    }
    if let Some(required) = ctx.policy.epoch {
        // A version 1 proof has no shared scope: it can never answer a request for one.
        let epoch = if env.wire_version() == pof_core::FORMAT_V1 { None } else { Some(env.epoch) };
        if epoch != Some(required) {
            let got = epoch.map_or("no shared period (a version 1 proof)".to_string(), |e| format!("period {e}"));
            set(3, CheckStatus::Fail, format!("Made for you, but for {got}; you asked for period {required}."));
            return result(Verdict::WrongScope { epoch: env.epoch, required }, Some(&env), Some(checksum), size, None, checks);
        }
    }
    let scope = match ctx.policy.epoch {
        Some(e) => format!(", in period {e}"),
        None => String::new(),
    };
    set(3, CheckStatus::Pass, format!("blake2b(\"{}\") matches the audience field{scope}.", ctx.audience.trim()));

    // 5 · anchor — the note-commitment root must equal an authenticated record at nc_height, and
    // the nullifier-set root one at height (the same record when the heights are equal)
    let nc = hex::encode(env.anchor.nc_root);
    let nf = hex::encode(env.anchor.nf_root);
    let at = |h: u32| ctx.anchors.iter().filter(move |a| a.height == h);
    let record = at(env.anchor.height).find(|a| a.nf_root.eq_ignore_ascii_case(&nf)).cloned();
    let nc_record = at(env.anchor.nc_height)
        .find(|a| a.nc_root.eq_ignore_ascii_case(&nc) && record.as_ref().is_none_or(|r| r.network == a.network))
        .cloned();
    let (Some(record), Some(_)) = (record, nc_record) else {
        let detail = match env.dormant_since() {
            None => format!("No authenticated anchor with these roots at block {}.", thousands(env.anchor.height as u64)),
            Some(h0) => format!(
                "No authenticated anchors with these roots at blocks {} and {}.",
                thousands(h0 as u64),
                thousands(env.anchor.height as u64)
            ),
        };
        set(4, CheckStatus::Fail, detail);
        return result(Verdict::AnchorNotFound, Some(&env), Some(checksum), size, None, checks);
    };
    if let (Some(tip), Some(max_age)) = (ctx.policy.tip_height, ctx.policy.max_anchor_age) {
        if tip.saturating_sub(env.anchor.height) > max_age {
            set(
                4,
                CheckStatus::Fail,
                format!(
                    "The spent set is from block {}, more than {} blocks before {}: \"unmoved\" is too old here.",
                    thousands(env.anchor.height as u64),
                    thousands(max_age as u64),
                    thousands(tip as u64)
                ),
            );
            return result(Verdict::AnchorTooOld { anchor_height: env.anchor.height }, Some(&env), Some(checksum), size, Some(record), checks);
        }
    }
    if let Some(required) = ctx.policy.dormant_since {
        if env.anchor.nc_height > required {
            set(
                4,
                CheckStatus::Fail,
                format!(
                    "The notes are shown unmoved since block {}; this verifier requires block {} or earlier.",
                    thousands(env.anchor.nc_height as u64),
                    thousands(required as u64)
                ),
            );
            let verdict = Verdict::NotDormantLongEnough { dormant_since: env.anchor.nc_height, required };
            return result(verdict, Some(&env), Some(checksum), size, Some(record), checks);
        }
    }
    let detail = match env.dormant_since() {
        None => format!("Block {} ({}): note-commitment root and nullifier-set root both match.", thousands(record.height as u64), record.network),
        Some(h0) => format!(
            "In the chain at block {} and unspent at block {} ({}): both roots match. Unmoved since block {}.",
            thousands(h0 as u64),
            thousands(record.height as u64),
            record.network,
            thousands(h0 as u64)
        ),
    };
    set(4, CheckStatus::Pass, detail);

    // 6 · proof
    match prove(&env) {
        Ok(()) => {
            // Reuse is judged only on a proof that verified: otherwise anyone could probe the registry.
            let seen: HashSet<String> = ctx.seen.iter().map(|t| t.trim().to_ascii_lowercase()).collect();
            if pof_zk::tags(&env).iter().any(|t| seen.contains(&hex::encode(t))) {
                set(5, CheckStatus::Fail, "The proof verifies, but these notes were already used with you in this period.".into());
                return result(Verdict::AlreadyUsed, Some(&env), Some(checksum), size, Some(record), checks);
            }
            let what = if pof_zk::revealed_nullifiers(&env).is_some() {
                "Halo2 proof and spend-authorisation signature verify for this exact statement. Exit certificate: it names the notes being sent."
            } else {
                "Halo2 proof and spend-authorisation signature verify for this exact statement."
            };
            set(5, CheckStatus::Pass, what.into());
            let verdict = Verdict::Valid { claim: env.claim.clone(), anchor_height: env.anchor.height, dormant_since: env.dormant_since() };
            result(verdict, Some(&env), Some(checksum), size, Some(record), checks)
        }
        Err(e) => {
            let detail = proof_failure(&e);
            set(5, CheckStatus::Fail, format!("Proof does not verify: {detail}"));
            result(Verdict::ProofInvalid { detail: detail.into() }, Some(&env), Some(checksum), size, Some(record), checks)
        }
    }
}

/// Whether a deposit spends exactly notes an exit certificate certified.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum ExitMatch {
    /// Every note the deposit spends is one the certificate proved.
    Matched {
        /// How many of the certificate's notes the deposit spends.
        spent: usize,
    },
    /// The deposit spends notes the certificate did not prove (hex nullifiers).
    Mismatch {
        #[serde(rename = "notCertified")]
        not_certified: Vec<String>,
    },
    /// The deposit spends no shielded notes at all, so it cannot be these.
    NoShieldedSpend,
    /// The file is not a revealing exit certificate (circuit 2, reveal = 1).
    NotACertificate,
}

/// The rail's check when the deposit lands: `deposit_nullifiers` are the Ironwood nullifiers the
/// deposit transaction reveals. Pure; call it only for a certificate that verified Valid.
pub fn exit_matches(certificate: &Envelope, deposit_nullifiers: &[[u8; 32]]) -> ExitMatch {
    let Some(revealed) = pof_zk::revealed_nullifiers(certificate) else {
        return ExitMatch::NotACertificate;
    };
    if deposit_nullifiers.is_empty() {
        return ExitMatch::NoShieldedSpend;
    }
    let not_certified: Vec<String> = deposit_nullifiers.iter().filter(|nf| !revealed.contains(nf)).map(hex::encode).collect();
    if not_certified.is_empty() {
        ExitMatch::Matched { spent: deposit_nullifiers.iter().collect::<HashSet<_>>().len() }
    } else {
        ExitMatch::Mismatch { not_certified }
    }
}

/// Say that a proof failed, never which constraint: detail is for debugging an attack.
fn proof_failure(e: &pof_zk::ZkError) -> &'static str {
    match e {
        pof_zk::ZkError::BadSignature | pof_zk::ZkError::BadKey => "the statement was altered after proving, or the signature is not the holder's.",
        pof_zk::ZkError::DuplicateNote => "the same note is counted more than once.",
        _ => "the evidence does not prove this statement.",
    }
}

/// The outcome of a reserves batch.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum BatchVerdict {
    /// Every member is valid, they share one audience, scope and anchor, and no note is counted
    /// twice: the holder controls at least `total_zatoshi`.
    Valid {
        #[serde(rename = "totalZatoshi")]
        total_zatoshi: u64,
        members: usize,
        #[serde(rename = "anchorHeight")]
        anchor_height: u32,
        #[serde(rename = "dormantSince", skip_serializing_if = "Option::is_none")]
        dormant_since: Option<u32>,
        /// hex
        scope: String,
    },
    /// The batch does not establish a total. `member` is the 0-based member at fault, if one is.
    Invalid {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        member: Option<usize>,
    },
    Malformed {
        reason: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub verdict: BatchVerdict,
    /// Each member's own result, in order.
    pub members: Vec<VerificationResult>,
    pub size_bytes: usize,
    pub now: u64,
    pub verifier: &'static str,
}

/// Verify a reserves batch (`POFB`, as bytes or base64url text): every member with the six checks,
/// then the batch rules — version 2, one scope, one anchor, no tag twice — and the members'
/// proofs checked together.
pub fn verify_batch(input: &[u8], ctx: &Context) -> BatchResult {
    let done = |verdict: BatchVerdict, members: Vec<VerificationResult>, size: usize| BatchResult { verdict, members, size_bytes: size, now: ctx.now, verifier: VERIFIER_VERSION };
    let bytes = if pof_core::is_batch(input) {
        Ok(input.to_vec())
    } else {
        std::str::from_utf8(input).map_err(|_| DecodeError::NotBase64).and_then(pof_core::from_base64url)
    };
    let files = match bytes.and_then(|b| pof_core::decode_batch(&b).map(|f| (f, b.len()))) {
        Ok(f) => f,
        Err(e) => return done(BatchVerdict::Malformed { reason: e.to_string() }, vec![], input.len()),
    };
    let (files, size) = files;
    let mut members: Vec<VerificationResult> = files.iter().map(|f| verify_inner(f, ctx, |_| Ok(()))).collect();
    let invalid = |reason: String, member: Option<usize>, members: Vec<VerificationResult>| done(BatchVerdict::Invalid { reason, member }, members, size);
    if let Some(i) = members.iter().position(|m| !matches!(m.verdict, Verdict::Valid { .. })) {
        let kind = serde_json::to_value(&members[i].verdict).ok().and_then(|v| v["kind"].as_str().map(str::to_string)).unwrap_or_default();
        return invalid(format!("Proof {} of {} is not valid here ({kind}).", i + 1, members.len()), Some(i), members);
    }
    let envs: Vec<Envelope> = files.iter().map(|f| decode(f).expect("verified above").0).collect();
    let first = &envs[0];
    if let Some(i) = envs.iter().position(|e| e.wire_version() == pof_core::FORMAT_V1) {
        return invalid("A batch needs version 2 proofs: version 1 proofs share no scope, so a repeated note could not be seen.".into(), Some(i), members);
    }
    if let Some(i) = envs.iter().position(|e| pof_zk::scope_key(e) != pof_zk::scope_key(first)) {
        return invalid(format!("Proof {} was made for another period than proof 1: a batch shares one scope.", i + 1), Some(i), members);
    }
    if let Some(i) = envs.iter().position(|e| e.anchor != first.anchor) {
        return invalid(format!("Proof {} is against another anchor than proof 1: a batch is one moment.", i + 1), Some(i), members);
    }
    let mut tags = HashSet::new();
    for (i, e) in envs.iter().enumerate() {
        if !pof_zk::tags(e).into_iter().all(|t| tags.insert(t)) {
            return invalid(format!("Proof {} counts a note another proof in the batch already counted.", i + 1), Some(i), members);
        }
    }
    for (i, r) in ctx.zk.verify_many(&envs).into_iter().enumerate() {
        let check = &mut members[i].checks[5];
        match r {
            Ok(()) => {
                check.status = CheckStatus::Pass;
                check.detail = "Halo2 proof and spend-authorisation signature verify for this exact statement (checked as a batch).".into();
            }
            Err(e) => {
                let detail = proof_failure(&e);
                check.status = CheckStatus::Fail;
                check.detail = format!("Proof does not verify: {detail}");
                members[i].verdict = Verdict::ProofInvalid { detail: detail.into() };
                return invalid(format!("Proof {} does not verify: {detail}", i + 1), Some(i), members);
            }
        }
    }
    let total_zatoshi = envs.iter().map(|e| e.claim.zatoshi()).sum();
    let verdict = BatchVerdict::Valid {
        total_zatoshi,
        members: envs.len(),
        anchor_height: first.anchor.height,
        dormant_since: first.dormant_since(),
        scope: hex::encode(pof_zk::scope_key(first)),
    };
    done(verdict, members, size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pof_core::{Anchor, Evidence};

    fn certificate(revealed: [[u8; 32]; 5], flag: u8) -> Envelope {
        let mut pi = vec![[0u8; 32]; 9];
        let mut f = [0u8; 32];
        f[0] = flag;
        pi.push(f);
        pi.extend(revealed);
        Envelope {
            version: pof_core::FORMAT_VERSION,
            circuit: pof_core::CIRCUIT_REVEAL,
            claim: Claim::HoldsAtLeast { zatoshi: 12_500_000 },
            audience: [0; 32],
            epoch: 1,
            binding: [0; 32],
            anchor: Anchor::at(1, [0; 32], [0; 32]),
            issued_at: 0,
            expires_at: 1,
            revocation: [0; 16],
            evidence: Evidence { public_inputs: pi, proof: vec![], signature: [0; 64] },
        }
    }

    #[test]
    fn exit_match_rules() {
        let nf = |b: u8| [b; 32];
        let cert = certificate([nf(1), nf(2), nf(7), nf(8), nf(9)], 1);
        assert_eq!(exit_matches(&cert, &[nf(1)]), ExitMatch::Matched { spent: 1 });
        assert_eq!(exit_matches(&cert, &[nf(1), nf(2)]), ExitMatch::Matched { spent: 2 });
        assert_eq!(exit_matches(&cert, &[nf(1), nf(3)]), ExitMatch::Mismatch { not_certified: vec![hex::encode(nf(3))] });
        assert_eq!(exit_matches(&cert, &[]), ExitMatch::NoShieldedSpend);
        assert_eq!(exit_matches(&certificate([nf(1); 5], 0), &[nf(1)]), ExitMatch::NotACertificate, "reveal = 0");
        let mut plain = cert.clone();
        plain.circuit = pof_core::CIRCUIT_THRESHOLD;
        assert_eq!(exit_matches(&plain, &[nf(1)]), ExitMatch::NotACertificate);
    }
}
