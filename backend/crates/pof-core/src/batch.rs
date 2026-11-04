//! A reserves batch: several proofs from one holder, in one scope, summed.
//!
//! ```text
//!  magic      "POFB"                 4 bytes
//!  version    u16, little-endian     2 bytes (1)
//!  count      u16, little-endian     2 bytes (1..=MAX_BATCH)
//!  members    count × (u32 LE length ‖ a complete POF1 file)
//!  checksum   blake2b-256 of everything before it
//! ```
//!
//! The container only carries the members. What makes a batch a batch — one audience, one
//! epoch, one anchor, no note counted twice across members — is checked by the verifier.

use crate::{codec::DecodeError, hash::blake2b_256};

pub const BATCH_MAGIC: [u8; 4] = *b"POFB";
pub const BATCH_VERSION: u16 = 1;
/// At most 64 members (320 notes): a verifier must bound the work a file can ask for.
pub const MAX_BATCH: usize = 64;
/// One member is about 12 KB; this leaves room and still refuses absurd sizes.
const MAX_MEMBER_BYTES: usize = 64 * 1024;

pub fn encode_batch(members: &[Vec<u8>]) -> Vec<u8> {
    assert!(!members.is_empty() && members.len() <= MAX_BATCH, "1..={MAX_BATCH} members");
    let mut out = Vec::with_capacity(8 + members.iter().map(|m| 4 + m.len()).sum::<usize>() + 32);
    out.extend_from_slice(&BATCH_MAGIC);
    out.extend_from_slice(&BATCH_VERSION.to_le_bytes());
    out.extend_from_slice(&(members.len() as u16).to_le_bytes());
    for m in members {
        out.extend_from_slice(&(m.len() as u32).to_le_bytes());
        out.extend_from_slice(m);
    }
    let sum = blake2b_256(&out);
    out.extend_from_slice(&sum);
    out
}

/// Whether bytes look like a batch rather than a single proof.
pub fn is_batch(b: &[u8]) -> bool {
    b.starts_with(&BATCH_MAGIC)
}

/// The member files, unparsed. Each is then decoded and verified as a proof of its own.
pub fn decode_batch(b: &[u8]) -> Result<Vec<Vec<u8>>, DecodeError> {
    if b.len() < 8 + 32 {
        return Err(DecodeError::TooShort);
    }
    if !is_batch(b) {
        return Err(DecodeError::Body("not a batch: the POFB magic bytes are missing".into()));
    }
    let version = u16::from_le_bytes([b[4], b[5]]);
    if version != BATCH_VERSION {
        return Err(DecodeError::UnknownVersion(version));
    }
    let (body, sum) = b.split_at(b.len() - 32);
    if blake2b_256(body) != sum {
        return Err(DecodeError::Checksum);
    }
    let count = u16::from_le_bytes([b[6], b[7]]) as usize;
    if count == 0 || count > MAX_BATCH {
        return Err(DecodeError::Body(format!("a batch holds 1 to {MAX_BATCH} proofs, not {count}")));
    }
    let mut rest = &body[8..];
    let mut members = Vec::with_capacity(count);
    for _ in 0..count {
        let len = rest.get(..4).map(|l| u32::from_le_bytes(l.try_into().expect("4 bytes")) as usize).ok_or(DecodeError::Body("batch truncated".into()))?;
        if len > MAX_MEMBER_BYTES || len > rest.len() - 4 {
            return Err(DecodeError::Body("a batch member is longer than the file".into()));
        }
        members.push(rest[4..4 + len].to_vec());
        rest = &rest[4 + len..];
    }
    if !rest.is_empty() {
        return Err(DecodeError::Body("trailing bytes after the last batch member".into()));
    }
    Ok(members)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_refuses_damage() {
        let members = vec![vec![1u8; 10], vec![2u8; 3]];
        let b = encode_batch(&members);
        assert!(is_batch(&b));
        assert_eq!(decode_batch(&b).unwrap(), members);
        let mut bad = b.clone();
        bad[12] ^= 1;
        assert_eq!(decode_batch(&bad).unwrap_err(), DecodeError::Checksum);
        assert!(decode_batch(&b[..20]).is_err());
        // a member length that runs past the end, re-sealed like a forger would
        let mut body = b[..b.len() - 32].to_vec();
        body[8..12].copy_from_slice(&1_000u32.to_le_bytes());
        let sum = blake2b_256(&body);
        body.extend_from_slice(&sum);
        assert!(matches!(decode_batch(&body), Err(DecodeError::Body(_))));
    }
}
