//! Every hash in the format, domain-separated with a blake2b personalisation so no value
//! computed for one purpose can be replayed as another.

use blake2b_simd::Params;

use crate::{codec::encode_head, Envelope};

fn h<'a>(personal: &[u8; 16], parts: impl IntoIterator<Item = &'a [u8]>) -> [u8; 32] {
    let mut st = Params::new().hash_length(32).personal(personal).to_state();
    for p in parts {
        st.update(p);
    }
    st.finalize().as_bytes().try_into().expect("32-byte digest")
}

/// Plain blake2b-256, no personalisation: the file checksum and the audience hash.
pub(crate) fn blake2b_256(b: &[u8]) -> [u8; 32] {
    Params::new().hash_length(32).hash(b).as_bytes().try_into().expect("32-byte digest")
}

/// blake2b-256 of `"pof-audience:" ‖ lowercase(trim(id))`, unkeyed and unpersonalised so a
/// verifier can compute it in any language with one call.
pub fn audience_hash(id: &str) -> [u8; 32] {
    blake2b_256(format!("pof-audience:{}", id.trim().to_lowercase()).as_bytes())
}

/// The revocation tag for a holder-held secret. Revoking = publishing `secret`.
pub fn revocation_tag(secret: &[u8; 32]) -> [u8; 16] {
    h(b"vouch-revoke-v1\0", [&secret[..]])[..16].try_into().expect("16 of 32 bytes")
}

/// The statement: claim, audience, binding, anchor, issue and expiry, revocation tag (and in
/// version 2 the circuit, the epoch and both anchor heights). In version 1 the proof's round id
/// is derived from this; in both versions the holder's signature covers it, so changing any
/// field breaks the proof.
pub fn statement_hash(e: &Envelope) -> [u8; 32] {
    h(b"vouch-stmt-v1\0\0\0", [&encode_head(e)[..]])
}

/// The scope of a version 2 proof: its circuit, audience and the verifier's epoch. The proof's
/// round id, and so its nullifier domain, comes from this rather than from the statement, so one
/// note proven twice in the same scope yields the same tag (reuse is visible to that verifier),
/// while different audiences or epochs see unrelated tags. The statement stays bound by the
/// spend-authorisation signature, which covers it and every public input.
pub fn scope_id(circuit: u8, audience: &[u8; 32], epoch: u64) -> [u8; 32] {
    h(b"vouch-scope-v2\0\0", [&[circuit][..], &audience[..], &epoch.to_le_bytes()[..]])
}

/// The binding of an exit certificate to one deposit intent (a rail's quote or deposit id):
/// blake2b-256 personalised, so it can never equal a Solana key or another binding.
pub fn intent_binding(intent: &str) -> [u8; 32] {
    h(b"vouch-intent-v1\0", [intent.trim().as_bytes()])
}

/// What the spend-authorisation key signs: the statement and the carried public inputs.
pub fn signing_message(e: &Envelope) -> [u8; 32] {
    let st = statement_hash(e);
    h(b"vouch-sig-v1\0\0\0\0", std::iter::once(&st[..]).chain(e.evidence.public_inputs.iter().map(|pi| &pi[..])))
}

/// A stable id for one proof, used as the on-chain receipt seed. Independent of when or by
/// whom it was attested, so one proof yields at most one receipt.
pub fn subject_hash(e: &Envelope) -> [u8; 32] {
    h(b"vouch-subject-v1", [&statement_hash(e)[..]])
}
