//! `pof-verify`, compiled to WebAssembly for the browser verifier.
//!
//! Bytes in, verdict out. Chain data (the anchor table) and the revocation list are passed in
//! from JavaScript as JSON; nothing here fetches. The verifying key is derived once, on the
//! first call, and kept for the life of the page.

use std::cell::OnceCell;

use pof_verify::{verify as run, verify_batch as run_batch, AnchorRecord, Context, Policy, ZkVerifier};
use wasm_bindgen::prelude::*;

thread_local! {
    static ZK: OnceCell<Result<ZkVerifier, String>> = const { OnceCell::new() };
}

fn with_zk<T>(f: impl FnOnce(&ZkVerifier) -> T) -> Result<T, String> {
    ZK.with(|cell| match cell.get_or_init(|| ZkVerifier::new().map_err(|e| e.to_string())) {
        Ok(zk) => Ok(f(zk)),
        Err(e) => Err(e.clone()),
    })
}

/// Derive the verifying key now (a few hundred ms) so the first verification is instant.
#[wasm_bindgen]
pub fn warm() -> Result<(), JsError> {
    with_zk(|_| ()).map_err(|e| JsError::new(&e))
}

/// Verify a proof. `bytes` is the binary `.pof` or its base64url text.
/// `anchors_json`: `[{network,height,ncRoot,nfRoot}]`; `revoked_json`: `["hex secret", …]`;
/// `policy_json` (optional): `{tipHeight?, maxAnchorAge?, dormantSince?, epoch?}`;
/// `seen_json` (optional): `["hex tag", …]`, the tags already accepted in that epoch.
/// Returns the JSON projection of `VerificationResult`.
#[wasm_bindgen]
pub fn verify(
    bytes: &[u8],
    audience: &str,
    now_sec: u64,
    anchors_json: &str,
    revoked_json: &str,
    policy_json: Option<String>,
    seen_json: Option<String>,
) -> Result<String, JsError> {
    let (anchors, revoked, policy, seen) = inputs(anchors_json, revoked_json, policy_json, seen_json)?;
    let result = with_zk(|zk| run(bytes, &Context { audience, anchors: &anchors, revoked_secrets: &revoked, now: now_sec, zk, policy, seen: &seen }))
        .map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Verify a reserves batch (.pofb bytes or base64url text). Same inputs as `verify`; returns the
/// JSON projection of `BatchResult`. The browser checks the members' proofs one at a time.
#[wasm_bindgen(js_name = verifyBatch)]
pub fn verify_batch(
    bytes: &[u8],
    audience: &str,
    now_sec: u64,
    anchors_json: &str,
    revoked_json: &str,
    policy_json: Option<String>,
    seen_json: Option<String>,
) -> Result<String, JsError> {
    let (anchors, revoked, policy, seen) = inputs(anchors_json, revoked_json, policy_json, seen_json)?;
    let result = with_zk(|zk| run_batch(bytes, &Context { audience, anchors: &anchors, revoked_secrets: &revoked, now: now_sec, zk, policy, seen: &seen }))
        .map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

type Inputs = (Vec<AnchorRecord>, Vec<String>, Policy, Vec<String>);

fn inputs(anchors_json: &str, revoked_json: &str, policy_json: Option<String>, seen_json: Option<String>) -> Result<Inputs, JsError> {
    let anchors = serde_json::from_str(anchors_json).map_err(|e| JsError::new(&format!("anchor table: {e}")))?;
    let revoked = serde_json::from_str(revoked_json).map_err(|e| JsError::new(&format!("revocation list: {e}")))?;
    let policy = match policy_json.as_deref() {
        Some(p) if !p.trim().is_empty() => serde_json::from_str(p).map_err(|e| JsError::new(&format!("policy: {e}")))?,
        _ => Policy::default(),
    };
    let seen = match seen_json.as_deref() {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).map_err(|e| JsError::new(&format!("seen tags: {e}")))?,
        _ => vec![],
    };
    Ok((anchors, revoked, policy, seen))
}

#[wasm_bindgen]
pub fn version() -> String {
    pof_verify::VERIFIER_VERSION.to_string()
}
