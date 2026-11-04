//! Byte-exact encoder and decoder. The encoding is postcard's: unsigned integers as LEB128
//! varints, fixed arrays as raw bytes, vectors as a varint length then elements, enums as a
//! varint tag then fields. Written by hand so the TypeScript mirror (frontend
//! `src/lib/pof/codec.ts`) and this crate can be checked against the same golden vectors.

use crate::{
    hash::blake2b_256, Anchor, Claim, Envelope, Evidence, CIRCUIT_REVEAL, CIRCUIT_THRESHOLD, FORMAT_V1, FORMAT_VERSION, MAGIC_BYTES,
    MAX_PROOF_BYTES, MAX_PUBLIC_INPUTS, MAX_TIMESTAMP, MAX_ZATOSHI,
};

/// Why a file failed to parse. Each variant is a different message in the UI.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("Too short to be a proof. The paste may be truncated.")]
    TooShort,
    #[error("Not a proof file: the POF1 magic bytes are missing.")]
    BadMagic,
    #[error("Unknown format version {0}. This verifier reads versions 1 and 2.")]
    UnknownVersion(u16),
    #[error("Checksum mismatch. The file was truncated or damaged in transit — this is not the same as a forgery.")]
    Checksum,
    #[error("Envelope does not parse: {0}.")]
    Body(String),
    #[error("Input is not base64url text or a .pof file.")]
    NotBase64,
}

// ── writer ────────────────────────────────────────────────────────────────

struct Writer(Vec<u8>);

impl Writer {
    fn varint(&mut self, mut n: u64) {
        loop {
            let byte = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                self.0.push(byte);
                return;
            }
            self.0.push(byte | 0x80);
        }
    }
    fn fixed(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
    }
    fn bytes(&mut self, b: &[u8]) {
        self.varint(b.len() as u64);
        self.fixed(b);
    }
}

fn write_claim(w: &mut Writer, e: &Envelope) {
    w.varint(e.claim.tag() as u64);
    match &e.claim {
        Claim::HoldsAtLeast { zatoshi } | Claim::HoldsExactly { zatoshi } => w.varint(*zatoshi),
        Claim::ReceivedPayment { txid, zatoshi } => {
            w.fixed(txid);
            w.varint(*zatoshi);
        }
        Claim::ReceivedAtLeastSince { zatoshi, from_height } => {
            w.varint(*zatoshi);
            w.varint(*from_height as u64);
        }
    }
}

/// Version 1: claim, audience, binding, height, nc_root, nf_root, issued, expires, revocation.
/// Version 2: circuit, claim, audience, epoch, binding, nc_height, nc_root, height, nf_root,
/// issued, expires, revocation.
fn write_head(w: &mut Writer, e: &Envelope) {
    if e.wire_version() == FORMAT_V1 {
        write_claim(w, e);
        w.fixed(&e.audience);
        w.fixed(&e.binding);
        w.varint(e.anchor.height as u64);
        w.fixed(&e.anchor.nc_root);
        w.fixed(&e.anchor.nf_root);
    } else {
        w.varint(e.circuit as u64);
        write_claim(w, e);
        w.fixed(&e.audience);
        w.varint(e.epoch);
        w.fixed(&e.binding);
        w.varint(e.anchor.nc_height as u64);
        w.fixed(&e.anchor.nc_root);
        w.varint(e.anchor.height as u64);
        w.fixed(&e.anchor.nf_root);
    }
    w.varint(e.issued_at);
    w.varint(e.expires_at);
    w.fixed(&e.revocation);
}

/// The statement: every body field except the evidence, in the envelope's wire version.
pub(crate) fn encode_head(e: &Envelope) -> Vec<u8> {
    let mut w = Writer(Vec::with_capacity(176));
    write_head(&mut w, e);
    w.0
}

fn encode_body(e: &Envelope) -> Vec<u8> {
    let mut w = Writer(Vec::with_capacity(176 + e.evidence.proof.len() + 32 * e.evidence.public_inputs.len()));
    write_head(&mut w, e);
    w.varint(e.evidence.public_inputs.len() as u64);
    for pi in &e.evidence.public_inputs {
        w.fixed(pi);
    }
    w.bytes(&e.evidence.proof);
    w.fixed(&e.evidence.signature);
    w.0
}

pub fn encode(e: &Envelope) -> Vec<u8> {
    let body = encode_body(e);
    let mut out = Vec::with_capacity(4 + 2 + body.len() + 32);
    out.extend_from_slice(&MAGIC_BYTES);
    out.extend_from_slice(&e.wire_version().to_le_bytes());
    out.extend_from_slice(&body);
    out.extend_from_slice(&blake2b_256(&body));
    out
}

// ── reader ────────────────────────────────────────────────────────────────

struct Reader<'a> {
    b: &'a [u8],
    o: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Result<u8, String> {
        let x = *self.b.get(self.o).ok_or("unexpected end of body")?;
        self.o += 1;
        Ok(x)
    }
    fn varint(&mut self) -> Result<u64, String> {
        let mut n: u64 = 0;
        for i in 0..10 {
            let byte = self.u8()?;
            let chunk = (byte & 0x7f) as u64;
            if i == 9 && chunk > 1 {
                return Err("varint overflows u64".into());
            }
            n |= chunk << (7 * i);
            if byte & 0x80 == 0 {
                // A zero last group pads a shorter encoding of the same value. Refused so that
                // decoding is injective: one proof, one byte string, one checksum.
                if byte == 0 && i > 0 {
                    return Err("non-canonical varint".into());
                }
                return Ok(n);
            }
        }
        Err("varint too long".into())
    }
    fn u32(&mut self) -> Result<u32, String> {
        u32::try_from(self.varint()?).map_err(|_| "value overflows u32".into())
    }
    fn fixed<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let end = self.o.checked_add(N).filter(|&e| e <= self.b.len()).ok_or("unexpected end of body")?;
        let mut out = [0u8; N];
        out.copy_from_slice(&self.b[self.o..end]);
        self.o = end;
        Ok(out)
    }
    /// A length prefix, bounded in u64 before narrowing: on wasm32 `as usize` would wrap 2^32 + k to k.
    fn len(&mut self, max: usize, too_long: impl FnOnce(u64) -> String) -> Result<usize, String> {
        let n = self.varint()?;
        if n > max as u64 {
            return Err(too_long(n));
        }
        Ok(n as usize)
    }
    fn bytes(&mut self, max: usize) -> Result<Vec<u8>, String> {
        let n = self.len(max, |n| format!("field of {n} bytes exceeds the {max}-byte limit"))?;
        let end = self.o.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("unexpected end of body")?;
        let out = self.b[self.o..end].to_vec();
        self.o = end;
        Ok(out)
    }
}

fn amount(z: u64) -> Result<u64, String> {
    if z > MAX_ZATOSHI {
        Err("amount exceeds the 21M ZEC supply".into())
    } else {
        Ok(z)
    }
}

fn read_claim(r: &mut Reader) -> Result<Claim, String> {
    Ok(match r.varint()? {
        0 => Claim::HoldsAtLeast { zatoshi: amount(r.varint()?)? },
        1 => Claim::HoldsExactly { zatoshi: amount(r.varint()?)? },
        2 => {
            let txid = r.fixed::<32>()?;
            Claim::ReceivedPayment { txid, zatoshi: amount(r.varint()?)? }
        }
        3 => {
            let zatoshi = amount(r.varint()?)?;
            Claim::ReceivedAtLeastSince { zatoshi, from_height: r.u32()? }
        }
        t => return Err(format!("unknown claim tag {t}")),
    })
}

fn read_body(body: &[u8], version: u16) -> Result<Envelope, String> {
    let mut r = Reader { b: body, o: 0 };
    let (circuit, claim, audience, epoch, binding, anchor);
    if version == FORMAT_V1 {
        circuit = CIRCUIT_THRESHOLD;
        claim = read_claim(&mut r)?;
        audience = r.fixed::<32>()?;
        epoch = 0;
        binding = r.fixed::<32>()?;
        let height = r.u32()?;
        anchor = Anchor::at(height, r.fixed::<32>()?, r.fixed::<32>()?);
    } else {
        circuit = match r.varint()? {
            1 => CIRCUIT_THRESHOLD,
            2 => CIRCUIT_REVEAL,
            c => return Err(format!("unknown circuit {c}")),
        };
        claim = read_claim(&mut r)?;
        audience = r.fixed::<32>()?;
        epoch = r.varint()?;
        if epoch > MAX_TIMESTAMP {
            return Err("epoch exceeds 2^53 - 1".into());
        }
        binding = r.fixed::<32>()?;
        let nc_height = r.u32()?;
        let nc_root = r.fixed::<32>()?;
        let height = r.u32()?;
        let nf_root = r.fixed::<32>()?;
        if nc_height > height {
            return Err("the note-commitment block is after the spent-set block".into());
        }
        anchor = Anchor { height, nc_root, nf_root, nc_height };
    }
    let issued_at = r.varint()?;
    let expires_at = r.varint()?;
    if issued_at.max(expires_at) > MAX_TIMESTAMP {
        return Err("timestamp exceeds 2^53 - 1".into());
    }
    if issued_at > expires_at {
        return Err("issued after it expires".into());
    }
    let revocation = r.fixed::<16>()?;
    let n = r.len(MAX_PUBLIC_INPUTS, |_| "too many public inputs".into())?;
    let mut public_inputs = Vec::with_capacity(n);
    for _ in 0..n {
        public_inputs.push(r.fixed::<32>()?);
    }
    let proof = r.bytes(MAX_PROOF_BYTES)?;
    let signature = r.fixed::<64>()?;
    if r.o != body.len() {
        return Err("trailing bytes after the envelope".into());
    }
    Ok(Envelope {
        version,
        circuit,
        claim,
        audience,
        epoch,
        binding,
        anchor,
        issued_at,
        expires_at,
        revocation,
        evidence: Evidence { public_inputs, proof, signature },
    })
}

/// Parse a `.pof` file. On success also returns the hex checksum.
pub fn decode(file: &[u8]) -> Result<(Envelope, [u8; 32]), DecodeError> {
    if file.len() < 4 + 2 + 32 + 1 {
        return Err(DecodeError::TooShort);
    }
    if file[..4] != MAGIC_BYTES {
        return Err(DecodeError::BadMagic);
    }
    let version = u16::from_le_bytes([file[4], file[5]]);
    if version != FORMAT_V1 && version != FORMAT_VERSION {
        return Err(DecodeError::UnknownVersion(version));
    }
    let body = &file[6..file.len() - 32];
    let mut checksum = [0u8; 32];
    checksum.copy_from_slice(&file[file.len() - 32..]);
    if blake2b_256(body) != checksum {
        return Err(DecodeError::Checksum);
    }
    let env = read_body(body, version).map_err(DecodeError::Body)?;
    Ok((env, checksum))
}

// ── base64url (RFC 4648 §5, no padding; standard base64 is accepted on input) ──

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn to_base64url(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
    for chunk in b.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        s.push(B64[(n >> 18) as usize & 63] as char);
        s.push(B64[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            s.push(B64[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            s.push(B64[n as usize & 63] as char);
        }
    }
    s
}

pub fn from_base64url(s: &str) -> Result<Vec<u8>, DecodeError> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for ch in s.trim().trim_end_matches('=').bytes() {
        if ch.is_ascii_whitespace() {
            continue;
        }
        let ch = match ch {
            b'+' => b'-',
            b'/' => b'_',
            c => c,
        };
        let v = B64.iter().position(|&c| c == ch).ok_or(DecodeError::NotBase64)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;

    pub(crate) fn sample(claim: Claim) -> Envelope {
        Envelope {
            version: FORMAT_V1,
            circuit: CIRCUIT_THRESHOLD,
            claim,
            audience: audience_hash("pof-credit:usdc-pool-1"),
            epoch: 0,
            binding: [7u8; 32],
            anchor: Anchor::at(3_491_040, [1; 32], [2; 32]),
            issued_at: 1_790_035_200,
            expires_at: 1_790_640_000,
            revocation: [9; 16],
            evidence: Evidence { public_inputs: vec![[3; 32]; 9], proof: vec![0xab; 2_208], signature: [5; 64] },
        }
    }

    #[test]
    fn round_trip_every_claim() {
        for claim in [
            Claim::HoldsAtLeast { zatoshi: 50_000_000_000 },
            Claim::HoldsExactly { zatoshi: 1 },
            Claim::ReceivedPayment { txid: [0xcd; 32], zatoshi: 1_200_000_000 },
            Claim::ReceivedAtLeastSince { zatoshi: 5, from_height: 3_000_000 },
        ] {
            let e = sample(claim);
            let f = encode(&e);
            let (d, _) = decode(&f).unwrap();
            assert_eq!(d, e);
            assert_eq!(from_base64url(&to_base64url(&f)).unwrap(), f);
        }
    }

    /// A version 2 envelope: dormant since 3,480,000, as of 3,491,040, in epoch 2026-10.
    pub(crate) fn sample_v2(claim: Claim) -> Envelope {
        let mut e = sample(claim);
        e.version = FORMAT_VERSION;
        e.epoch = 202_610;
        e.anchor = Anchor { height: 3_491_040, nc_root: [1; 32], nf_root: [2; 32], nc_height: 3_480_000 };
        e
    }

    #[test]
    fn version_2_round_trips_and_says_dormant_since() {
        for circuit in [CIRCUIT_THRESHOLD, CIRCUIT_REVEAL] {
            let mut e = sample_v2(Claim::HoldsAtLeast { zatoshi: 50_000_000_000 });
            e.circuit = circuit;
            let f = encode(&e);
            assert_eq!(u16::from_le_bytes([f[4], f[5]]), 2);
            let (d, _) = decode(&f).unwrap();
            assert_eq!(d, e);
            assert_eq!(d.dormant_since(), Some(3_480_000));
        }
        // A version 2 envelope with one height and no epoch stays version 2: the version decides
        // how the round id is derived, so it is never inferred from the fields.
        let mut plain = sample_v2(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        (plain.epoch, plain.anchor.nc_height) = (0, plain.anchor.height);
        assert_eq!(decode(&encode(&plain)).unwrap().0.version, 2);
    }

    #[test]
    fn version_1_is_written_only_when_nothing_would_be_lost() {
        let v1 = sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        let f = encode(&v1);
        assert_eq!(u16::from_le_bytes([f[4], f[5]]), 1);
        assert_eq!(decode(&f).unwrap().0, v1);
        let mut grown = v1.clone();
        grown.epoch = 1;
        assert_eq!(grown.wire_version(), FORMAT_VERSION);
        assert_ne!(statement_hash(&grown), statement_hash(&v1));
        assert_eq!(decode(&encode(&grown)).unwrap().0.epoch, 1);
    }

    #[test]
    fn version_2_field_rules() {
        let mut e = sample_v2(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        e.anchor.nc_height = e.anchor.height + 1;
        assert_eq!(body_err(&e), DecodeError::Body("the note-commitment block is after the spent-set block".into()));
        let mut e = sample_v2(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        e.epoch = MAX_TIMESTAMP + 1;
        assert_eq!(body_err(&e), DecodeError::Body("epoch exceeds 2^53 - 1".into()));
        let mut e = sample_v2(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        e.circuit = 3;
        assert_eq!(body_err(&e), DecodeError::Body("unknown circuit 3".into()));
    }

    #[test]
    fn distinct_errors() {
        let f = encode(&sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 }));
        assert_eq!(decode(&f[..20]).unwrap_err(), DecodeError::TooShort);
        let mut bad = f.clone();
        bad[0] = b'X';
        assert_eq!(decode(&bad).unwrap_err(), DecodeError::BadMagic);
        let mut bad = f.clone();
        bad[4] = 3;
        assert_eq!(decode(&bad).unwrap_err(), DecodeError::UnknownVersion(3));
        let mut bad = f.clone();
        bad[100] ^= 1;
        assert_eq!(decode(&bad).unwrap_err(), DecodeError::Checksum);
    }

    fn body_err(e: &Envelope) -> DecodeError {
        decode(&encode(e)).unwrap_err()
    }

    #[test]
    fn varints_are_canonical() {
        let read = |b: &[u8]| Reader { b, o: 0 }.varint();
        assert_eq!(read(&[0x00]), Ok(0));
        assert_eq!(read(&[0x80, 0x01]), Ok(128));
        for padded in [&[0x80, 0x00][..], &[0x81, 0x00], &[0xff, 0x80, 0x00]] {
            assert_eq!(read(padded), Err("non-canonical varint".into()), "{padded:02x?}");
        }
        for n in [0, 1, 127, 128, 300, u32::MAX as u64, u64::MAX] {
            let mut w = Writer(vec![]);
            w.varint(n);
            assert_eq!(read(&w.0), Ok(n));
        }

        // The same proof with its claim tag padded to two bytes is refused, not a second valid file.
        let f = encode(&sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 }));
        let body = [&[0x80u8, 0x00][..], &f[7..f.len() - 32]].concat();
        let padded = [&f[..6], &body[..], &blake2b_256(&body)[..]].concat();
        assert_eq!(decode(&padded).unwrap_err(), DecodeError::Body("non-canonical varint".into()));
    }

    #[test]
    fn lengths_are_bounded_before_narrowing() {
        let mut w = Writer(vec![]);
        w.varint((1 << 32) + 5);
        assert!(Reader { b: &w.0, o: 0 }.len(16, |n| n.to_string()).is_err());
        let mut e = sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        e.evidence.public_inputs = vec![[0; 32]; MAX_PUBLIC_INPUTS + 1];
        assert_eq!(body_err(&e), DecodeError::Body("too many public inputs".into()));
    }

    #[test]
    fn timestamps_are_bounded_and_ordered() {
        let e = sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        let mut late = e.clone();
        late.expires_at = MAX_TIMESTAMP + 1;
        assert_eq!(body_err(&late), DecodeError::Body("timestamp exceeds 2^53 - 1".into()));
        let mut backwards = e.clone();
        backwards.issued_at = e.expires_at + 1;
        assert_eq!(body_err(&backwards), DecodeError::Body("issued after it expires".into()));
        let mut edge = e;
        (edge.issued_at, edge.expires_at) = (MAX_TIMESTAMP, MAX_TIMESTAMP);
        assert_eq!(decode(&encode(&edge)).unwrap().0, edge);
    }

    #[test]
    fn statement_excludes_evidence() {
        let a = sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        let mut b = a.clone();
        b.evidence.proof[0] ^= 1;
        assert_eq!(statement_hash(&a), statement_hash(&b));
        b.expires_at += 1;
        assert_ne!(statement_hash(&a), statement_hash(&b));
    }
}
