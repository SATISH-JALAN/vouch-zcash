//! The Vouch proof format.
//!
//! Owns the vocabulary: claims, the envelope, the wire encoding, and the hashes that bind
//! an envelope to its evidence. No I/O, no network, no clock — everything that crosses a
//! process boundary is an [`Envelope`], and everything here compiles to wasm32.
//!
//! ```text
//!  magic      "POF1"                 4 bytes
//!  version    u16, little-endian     2 bytes
//!  body       postcard(Body)         variable
//!  checksum   blake2b-256(body)      32 bytes
//! ```
//!
//! Version 2 adds the circuit, the verifier's epoch and a second anchor height: the note
//! commitments are taken at `nc_height`, the spent set at `height`, so a proof can say "in the
//! chain at block H₀ and unmoved since". Version 1 files still decode, and re-encode byte for byte.

mod batch;
mod codec;
mod hash;

pub use batch::{decode_batch, encode_batch, is_batch, BATCH_MAGIC, MAX_BATCH};
pub use codec::{decode, encode, from_base64url, to_base64url, DecodeError};
pub use hash::{audience_hash, intent_binding, revocation_tag, scope_id, signing_message, statement_hash, subject_hash};

use serde::{Deserialize, Serialize};

/// Latest wire format version. The header owns it; the body never repeats it.
pub const FORMAT_VERSION: u16 = 2;

/// The first format: one anchor height, the round id derived from the statement.
pub const FORMAT_V1: u16 = 1;

/// The threshold circuit: voting-circuits' delegation proof plus `min_ballots`.
pub const CIRCUIT_THRESHOLD: u8 = 1;

/// The threshold circuit plus a reveal flag and the five revealed nullifiers (exit certificates).
pub const CIRCUIT_REVEAL: u8 = 2;

/// "POF1".
pub const MAGIC_BYTES: [u8; 4] = *b"POF1";

/// 1 ballot = 0.125 ZEC. Threshold claims are proven in these units.
pub const ZAT_PER_UNIT: u64 = 12_500_000;

/// Hard cap on public inputs a verifier will read. Threshold evidence carries 9, reveal evidence 15.
pub const MAX_PUBLIC_INPUTS: usize = 24;

/// Hard cap on proof bytes, so a hostile file cannot make a verifier allocate freely.
pub const MAX_PROOF_BYTES: usize = 16 * 1024;

/// Total supply bound, in zatoshi. No claim may exceed it.
pub const MAX_ZATOSHI: u64 = 21_000_000 * 100_000_000;

/// Latest issue or expiry time, in unix seconds: 2^53 − 1, the largest integer that a
/// JavaScript number, JSON and the gate's i64 all carry exactly.
pub const MAX_TIMESTAMP: u64 = (1 << 53) - 1;

/// The single statement a proof asserts. Tags are wire-stable.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Claim {
    /// tag 0 · "holds at least `zatoshi`". The balance itself is never revealed.
    HoldsAtLeast { zatoshi: u64 },
    /// tag 1 · reserved; not produced or accepted by v1 verifiers.
    HoldsExactly { zatoshi: u64 },
    /// tag 2 · "received `zatoshi` in `txid`".
    ReceivedPayment {
        #[serde(with = "hex32")]
        txid: [u8; 32],
        zatoshi: u64,
    },
    /// tag 3 · reserved; not produced or accepted by v1 verifiers.
    ReceivedAtLeastSince {
        zatoshi: u64,
        #[serde(rename = "fromHeight")]
        from_height: u32,
    },
}

impl Claim {
    pub fn tag(&self) -> u8 {
        match self {
            Claim::HoldsAtLeast { .. } => 0,
            Claim::HoldsExactly { .. } => 1,
            Claim::ReceivedPayment { .. } => 2,
            Claim::ReceivedAtLeastSince { .. } => 3,
        }
    }

    pub fn zatoshi(&self) -> u64 {
        match self {
            Claim::HoldsAtLeast { zatoshi }
            | Claim::HoldsExactly { zatoshi }
            | Claim::ReceivedPayment { zatoshi, .. }
            | Claim::ReceivedAtLeastSince { zatoshi, .. } => *zatoshi,
        }
    }

    /// Minimum ballot units a `HoldsAtLeast` proof must clear. `None` when the amount is
    /// not a whole number of units, which v1 treats as malformed.
    pub fn min_units(&self) -> Option<u64> {
        match self {
            Claim::HoldsAtLeast { zatoshi } if zatoshi % ZAT_PER_UNIT == 0 => Some(zatoshi / ZAT_PER_UNIT),
            _ => None,
        }
    }
}

/// The two ledger roots a proof is checked against, and the blocks they were taken at.
///
/// `height` is the block the proof is "as of": the spent-nullifier set there does not contain
/// the notes. `nc_height` is the block whose note-commitment tree contains them. In version 1 the
/// two are always equal; when `nc_height < height` the notes existed at `nc_height` and have not
/// moved since.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub height: u32,
    /// Ironwood note-commitment tree root at `nc_height`.
    #[serde(with = "hex32")]
    pub nc_root: [u8; 32],
    /// Spent-nullifier indexed Merkle tree root at `height`.
    #[serde(with = "hex32")]
    pub nf_root: [u8; 32],
    pub nc_height: u32,
}

impl Anchor {
    /// One block for both roots: the version 1 shape, and a plain proof of funds.
    pub fn at(height: u32, nc_root: [u8; 32], nf_root: [u8; 32]) -> Self {
        Anchor { height, nc_root, nf_root, nc_height: height }
    }
}

/// Proof bytes plus the public inputs a verifier cannot derive on its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    #[serde(with = "hexvec32")]
    pub public_inputs: Vec<[u8; 32]>,
    #[serde(with = "hexbytes")]
    pub proof: Vec<u8>,
    /// Spend-authorisation signature (RedPallas) over [`signing_message`].
    #[serde(with = "hex64")]
    pub signature: [u8; 64],
}

/// Everything a proof says. On the wire `version` lives in the file header, not the body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    /// The format version this envelope is written in. It decides how the round id is derived,
    /// so it is part of what was proven, not a detail of the encoding.
    pub version: u16,
    /// Which circuit the evidence is for ([`CIRCUIT_THRESHOLD`] or [`CIRCUIT_REVEAL`]).
    pub circuit: u8,
    pub claim: Claim,
    /// blake2b-256 of the verifier identifier. Never the plaintext name.
    #[serde(with = "hex32")]
    pub audience: [u8; 32],
    /// The verifier's period (version 2). With the circuit and the audience it fixes the scope:
    /// inside one scope the same note always yields the same tag, so reuse is visible to that
    /// verifier and to no one else. Zero in version 1.
    pub epoch: u64,
    /// Context the proof is bound to: all zero, or e.g. the borrower's Solana pubkey.
    #[serde(with = "hex32")]
    pub binding: [u8; 32],
    pub anchor: Anchor,
    /// Unix seconds.
    pub issued_at: u64,
    /// Unix seconds, absolute.
    pub expires_at: u64,
    /// Opaque 16-byte tag: the first half of blake2b(secret). The holder revokes by publishing the secret.
    #[serde(with = "hex16")]
    pub revocation: [u8; 16],
    pub evidence: Evidence,
}

impl Envelope {
    /// Whether this envelope says nothing version 1 cannot: the threshold circuit, no epoch,
    /// one anchor height.
    pub fn fits_v1(&self) -> bool {
        self.circuit == CIRCUIT_THRESHOLD && self.epoch == 0 && self.anchor.nc_height == self.anchor.height
    }

    /// The version actually written. A version 1 envelope that grew version 2 fields is written,
    /// hashed and proven as version 2, so no field is ever silently dropped.
    pub fn wire_version(&self) -> u16 {
        if self.version == FORMAT_V1 && self.fits_v1() {
            FORMAT_V1
        } else {
            FORMAT_VERSION
        }
    }

    /// The block since which the notes have not moved, when the proof says more than "as of".
    pub fn dormant_since(&self) -> Option<u32> {
        (self.anchor.nc_height < self.anchor.height).then_some(self.anchor.nc_height)
    }
}

macro_rules! hex_array {
    ($name:ident, $n:expr) => {
        mod $name {
            use serde::{de::Error, Deserialize, Deserializer, Serializer};
            pub fn serialize<S: Serializer>(v: &[u8; $n], s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(&hex::encode(v))
            }
            pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; $n], D::Error> {
                let s = String::deserialize(d)?;
                let v = hex::decode(s).map_err(D::Error::custom)?;
                v.try_into().map_err(|_| D::Error::custom(concat!("expected ", stringify!($n), " bytes")))
            }
        }
    };
}
hex_array!(hex16, 16);
hex_array!(hex32, 32);
hex_array!(hex64, 64);

mod hexbytes {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(v))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        hex::decode(String::deserialize(d)?).map_err(D::Error::custom)
    }
}

mod hexvec32 {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[[u8; 32]], s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(v.iter().map(hex::encode))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<[u8; 32]>, D::Error> {
        Vec::<String>::deserialize(d)?
            .into_iter()
            .map(|s| {
                let v = hex::decode(s).map_err(D::Error::custom)?;
                v.try_into().map_err(|_| D::Error::custom("expected 32 bytes"))
            })
            .collect()
    }
}
