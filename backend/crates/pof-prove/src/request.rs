//! A proof request lives entirely in a URL: base64url(JSON). Mirrors `frontend/src/lib/request.ts`.

use serde::{Deserialize, Serialize};

/// Largest `respond_by` both sides represent exactly: JavaScript's `Number.MAX_SAFE_INTEGER`.
pub const MAX_RESPOND_BY: u64 = (1 << 53) - 1;

/// Unknown fields are refused, and an explicit JSON `null` in an optional field reads as
/// absent, exactly as on the web.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofRequest {
    pub v: u8,
    /// Random request id, 16 lowercase hex. Lets a verifier match a response to its request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub claim: String,
    /// Zatoshi as a decimal string, so large values survive JSON.
    #[serde(with = "dec")]
    pub zatoshi: u64,
    pub audience: String,
    pub expiry_days: u32,
    /// Unix seconds the verifier wants an answer by.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub respond_by: Option<u64>,
    /// "solana" when the proof must be bound to the holder's Solana account (on-chain audiences).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    /// "proof" (the default), "exit" (a certificate for coins about to be sent) or "reserves" (a
    /// batch summing every usable note).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// The verifier's period. When set, the proof is made in that scope, so the verifier sees the
    /// same notes used twice in it. When absent, the proof gets a scope of its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<u64>,
    /// The block the notes must be unmoved since (a checkpoint, a multiple of 1,000).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dormant_since: Option<u32>,
}

mod dec {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    /// ASCII digits only: `u64::from_str` alone would also take a leading `+`.
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let s = String::deserialize(d)?;
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(D::Error::custom("zatoshi must be a decimal string"));
        }
        s.parse().map_err(D::Error::custom)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    #[error("the request is not valid base64url")]
    Encoding,
    #[error("the request does not parse: {0}")]
    Json(String),
    #[error("{0}")]
    Invalid(&'static str),
}

/// The problem with an audience identifier, if any. Printable ASCII only, so trimming and
/// lower-casing (inside the audience hash) mean exactly the same thing here and in JavaScript.
pub fn audience_problem(id: &str) -> Option<&'static str> {
    if !id.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        return Some("the audience may use only printable ASCII: letters, digits, spaces and punctuation");
    }
    id.trim().is_empty().then_some("the request names no audience")
}

impl ProofRequest {
    /// The `r=` value of a request link. Accepts exactly what `decodeRequestDetailed` in
    /// `frontend/src/lib/request.ts` accepts; `fixtures/requests.json` holds the cases.
    pub fn decode(encoded: &str) -> Result<Self, RequestError> {
        // Links wrapped by mail clients pick up whitespace; anything else outside base64url is damage.
        let clean: String = encoded.chars().filter(|c| !c.is_ascii_whitespace()).collect();
        if !clean.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            return Err(RequestError::Encoding);
        }
        let bytes = pof_core::from_base64url(&clean).map_err(|_| RequestError::Encoding)?;
        // Through a Value, so duplicate keys resolve last-wins as in JSON.parse, and only an
        // object is a request (serde would also build the struct from an array).
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| RequestError::Json(e.to_string()))?;
        if !value.is_object() {
            return Err(RequestError::Json("a request is a JSON object".into()));
        }
        let r: ProofRequest = serde_json::from_value(value).map_err(|e| RequestError::Json(e.to_string()))?;
        r.validate()?;
        Ok(r)
    }

    pub fn validate(&self) -> Result<(), RequestError> {
        if self.v != 1 {
            return Err(RequestError::Invalid("unknown request version"));
        }
        if self.claim != "HoldsAtLeast" {
            return Err(RequestError::Invalid("this prover answers HoldsAtLeast requests"));
        }
        if self.zatoshi == 0 || self.zatoshi > pof_core::MAX_ZATOSHI {
            return Err(RequestError::Invalid("the threshold is out of range"));
        }
        if !self.zatoshi.is_multiple_of(pof_core::ZAT_PER_UNIT) {
            return Err(RequestError::Invalid("the threshold must be a multiple of 0.125 ZEC"));
        }
        if let Some(p) = audience_problem(&self.audience) {
            return Err(RequestError::Invalid(p));
        }
        if !(1..=365).contains(&self.expiry_days) {
            return Err(RequestError::Invalid("expiry must be 1–365 days"));
        }
        if self.id.as_ref().is_some_and(|id| id.len() != 16 || !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))) {
            return Err(RequestError::Invalid("malformed request id"));
        }
        if self.respond_by.is_some_and(|t| !(1..=MAX_RESPOND_BY).contains(&t)) {
            return Err(RequestError::Invalid("malformed response deadline"));
        }
        if self.bind.as_deref().is_some_and(|b| b != "solana") {
            return Err(RequestError::Invalid("unknown binding"));
        }
        if self.kind.as_deref().is_some_and(|k| !matches!(k, "proof" | "exit" | "reserves")) {
            return Err(RequestError::Invalid("unknown request kind"));
        }
        if self.epoch.is_some_and(|e| e > MAX_RESPOND_BY) {
            return Err(RequestError::Invalid("malformed period"));
        }
        if self.dormant_since.is_some_and(|h| h == 0 || !h.is_multiple_of(1_000)) {
            return Err(RequestError::Invalid("the unmoved-since block must be a multiple of 1,000"));
        }
        Ok(())
    }

    /// The claim as an English sentence, identical to the web review screen.
    pub fn sentence(&self) -> String {
        let what = match self.kind.as_deref() {
            Some("reserves") => format!("prove your reserves total at least {} ZEC", zec(self.zatoshi)),
            Some("exit") => format!("certify the at least {} ZEC you are about to send them", zec(self.zatoshi)),
            _ => format!("prove you hold at least {} ZEC", zec(self.zatoshi)),
        };
        let since = self.dormant_since.map(|h| format!(", in notes unmoved since block {}", zec_int(h as u64))).unwrap_or_default();
        let period = if self.epoch.is_some() { " They will see if you use the same coins with them again in this period." } else { "" };
        format!(
            "{} asks you to {what}{since}. Valid {} day{} after you generate it.{period}",
            self.audience.trim(),
            self.expiry_days,
            if self.expiry_days == 1 { "" } else { "s" }
        )
    }
}

/// A whole number with thousands separators.
fn zec_int(n: u64) -> String {
    zec(n * 100_000_000)
}

pub fn zec(z: u64) -> String {
    let whole = z / 100_000_000;
    let frac = format!("{:08}", z % 100_000_000);
    let frac = frac.trim_end_matches('0');
    let mut w = String::new();
    let s = whole.to_string();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            w.push(',');
        }
        w.push(c);
    }
    if frac.is_empty() {
        w
    } else {
        format!("{w}.{frac}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same links `frontend/scripts/verify-fixtures.ts` checks: both sides must agree.
    #[test]
    fn shared_request_vectors() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../fixtures/requests.json");
        let file: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let cases = file["cases"].as_array().unwrap();
        assert!(cases.len() > 50);
        for c in cases {
            let (name, r, ok) = (c["name"].as_str().unwrap(), c["r"].as_str().unwrap(), c["ok"].as_bool().unwrap());
            if let Some(json) = c["json"].as_str() {
                assert_eq!(pof_core::from_base64url(r).unwrap(), json.as_bytes(), "{name}: json and r disagree");
            }
            let got = ProofRequest::decode(r);
            assert_eq!(got.is_ok(), ok, "{name}: {got:?}");
        }
    }

    #[test]
    fn serialises_without_absent_fields() {
        let r = ProofRequest {
            v: 1,
            id: None,
            claim: "HoldsAtLeast".into(),
            zatoshi: 12_500_000,
            audience: "acme".into(),
            expiry_days: 7,
            respond_by: None,
            bind: None,
            kind: None,
            epoch: None,
            dormant_since: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"v":1,"claim":"HoldsAtLeast","zatoshi":"12500000","audience":"acme","expiryDays":7}"#);
        assert_eq!(ProofRequest::decode(&pof_core::to_base64url(json.as_bytes())).unwrap(), r);
    }
}
