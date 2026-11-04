//! The rail API: exit certificates in, matched deposits out.
//!
//! A rail (a swap service, an exchange, a desk) asks a holder for an exit certificate: "at least X,
//! in notes unmoved since block H, and these are the notes I am sending you". It posts the
//! certificate here; the service verifies it with the rail's own policy (its period, its block)
//! against the rail's reuse registry, and answers pre-cleared or why not. When the deposit lands,
//! the rail posts its txid: the service reads the transaction's Ironwood nullifiers from
//! lightwalletd and answers matched (every note it spends was certified) or mismatch. The rail
//! decides what to release; this service never moves money.
//!
//!   POST /v1/certificates            {certificate, audience, epoch?, dormantSince?, intent?}
//!   GET  /v1/certificates?audience=  the rail's certificates, newest first
//!   GET  /v1/certificates/{id}
//!   POST /v1/certificates/{id}/match {txid, network?} | {nullifiers: [hex]}
//!   POST /v1/batch                   {batch, audience}  → BatchResult
//!
//! The store holds ids, tags, revealed nullifiers, verdicts and times — never proof bytes. Set
//! POF_STORE to persist it (a JSON file, written atomically), POF_RAIL_TOKEN to require
//! `Authorization: Bearer <token>` on every call that writes, and POF_WEBHOOK_URL with
//! POF_WEBHOOK_SECRET to receive events signed `X-Vouch-Signature: sha256=<hmac>`.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use hmac::{Hmac, Mac};
use pof_verify::{ExitMatch, Policy, Verdict};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use tokio::sync::Mutex;

use crate::{err, now, App};

#[derive(Default, Serialize, Deserialize)]
pub struct Store {
    certificates: BTreeMap<String, Certificate>,
    /// Per rail (audience): every tag it has accepted. Tags are scoped, so tags of different
    /// periods never collide; one set per rail is enough.
    seen: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Certificate {
    pub id: String,
    pub audience: String,
    pub scope: String,
    pub intent: Option<String>,
    pub network: String,
    pub claim_zatoshi: u64,
    pub anchor_height: u32,
    pub dormant_since: Option<u32>,
    pub expires_at: u64,
    pub revealed: Vec<String>,
    pub tags: Vec<String>,
    /// "pre-cleared", then "matched" or "mismatch" once a deposit is checked.
    pub status: String,
    pub created_at: u64,
    pub deposit: Option<Deposit>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deposit {
    pub txid: Option<String>,
    pub height: Option<u32>,
    pub nullifiers: Vec<String>,
    pub result: ExitMatch,
    pub checked_at: u64,
}

pub struct Rail {
    store: Mutex<Store>,
    path: Option<PathBuf>,
    token: Option<String>,
    webhook: Option<(String, Vec<u8>)>,
}

impl Rail {
    pub fn from_env() -> anyhow::Result<Self> {
        let path = std::env::var("POF_STORE").ok().map(PathBuf::from);
        let store = match &path {
            Some(p) if p.exists() => serde_json::from_slice(&std::fs::read(p)?).map_err(|e| anyhow::anyhow!("{}: {e}", p.display()))?,
            _ => Store::default(),
        };
        if path.is_none() {
            tracing::warn!("POF_STORE unset: rail certificates and the reuse registry live in memory and are lost on restart");
        }
        let webhook = match (std::env::var("POF_WEBHOOK_URL"), std::env::var("POF_WEBHOOK_SECRET")) {
            (Ok(u), Ok(s)) => Some((u, s.into_bytes())),
            (Ok(_), Err(_)) => anyhow::bail!("POF_WEBHOOK_URL needs POF_WEBHOOK_SECRET to sign events"),
            _ => None,
        };
        Ok(Rail { store: Mutex::new(store), path, token: std::env::var("POF_RAIL_TOKEN").ok().filter(|t| !t.is_empty()), webhook })
    }

    fn authorised(&self, headers: &HeaderMap) -> bool {
        let Some(token) = &self.token else { return true };
        headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).is_some_and(|t| constant_eq(t.as_bytes(), token.as_bytes()))
    }

    async fn save(&self, store: &Store) {
        let Some(path) = &self.path else { return };
        // temp file, then rename: a failed write never leaves a truncated store
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(store).expect("the store serialises");
        if let Err(e) = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path)) {
            tracing::error!("could not save the rail store: {e}");
        }
    }

    /// Fire and forget: a rail that is down must not slow the answer.
    fn notify(&self, http: &reqwest::Client, event: &str, cert: &Certificate) {
        let Some((url, secret)) = self.webhook.clone() else { return };
        let body = serde_json::to_vec(&json!({ "event": event, "certificate": cert, "at": now() })).expect("serialises");
        let mut mac = Hmac::<Sha256>::new_from_slice(&secret).expect("HMAC takes any key length");
        mac.update(&body);
        let signature = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
        let http = http.clone();
        tokio::spawn(async move {
            let sent = http
                .post(&url)
                .header("content-type", "application/json")
                .header("x-vouch-signature", signature)
                .body(body)
                .timeout(Duration::from_secs(5))
                .send()
                .await;
            if let Err(e) = sent.and_then(|r| r.error_for_status()) {
                tracing::warn!("webhook not delivered: {}", e.without_url());
            }
        });
    }
}

/// Equal-length, constant-time comparison for the bearer token.
fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn unauthorised() -> Response {
    err(StatusCode::UNAUTHORIZED, "this rail API needs its bearer token")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateBody {
    certificate: String,
    /// The rail's own identifier: the certificate's audience.
    audience: String,
    /// The period the rail asked for. Required: without it, reuse could never show.
    epoch: u64,
    dormant_since: Option<u32>,
    intent: Option<String>,
}

pub async fn submit(State(app): State<Arc<App>>, headers: HeaderMap, Json(b): Json<CertificateBody>) -> Response {
    let rail = &app.rail;
    if !rail.authorised(&headers) {
        return unauthorised();
    }
    let audience = b.audience.trim().to_lowercase();
    if audience.is_empty() || audience.len() > 200 {
        return err(StatusCode::BAD_REQUEST, "name the rail (audience) the certificate is for");
    }
    let seen: Vec<String> = rail.store.lock().await.seen.get(&audience).map(|s| s.iter().cloned().collect()).unwrap_or_default();
    let policy = Policy { epoch: Some(b.epoch), dormant_since: b.dormant_since, ..Policy::default() };
    let r = match app.check_with(b.certificate.as_bytes(), &audience, policy, &seen).await {
        Ok(r) => r,
        Err(busy) => return busy.into_response(),
    };
    let (Verdict::Valid { claim, anchor_height, dormant_since }, Some(view)) = (&r.verdict, &r.envelope) else {
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "status": "refused", "result": r }))).into_response();
    };
    if r.revealed.is_empty() {
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "status": "refused", "reason": "a valid proof, but not an exit certificate: it names no notes", "result": r }))).into_response();
    }
    if let Some(intent) = &b.intent {
        if view.envelope.binding != pof_core::intent_binding(intent) {
            return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "status": "refused", "reason": "the certificate is bound to another deposit intent", "result": r }))).into_response();
        }
    }
    let cert = Certificate {
        id: hex::encode(pof_core::subject_hash(&view.envelope))[..16].to_string(),
        audience: audience.clone(),
        scope: r.scope.clone().unwrap_or_default(),
        intent: b.intent.clone(),
        network: r.anchor.as_ref().map_or("?".into(), |a| a.network.clone()),
        claim_zatoshi: claim.zatoshi(),
        anchor_height: *anchor_height,
        dormant_since: *dormant_since,
        expires_at: view.envelope.expires_at,
        revealed: r.revealed.clone(),
        tags: r.tags.clone(),
        status: "pre-cleared".into(),
        created_at: now(),
        deposit: None,
    };
    let mut store = rail.store.lock().await;
    // The same certificate twice is not reuse: answer as before. Other notes in the registry
    // already made the verifier answer AlreadyUsed above.
    if let Some(existing) = store.certificates.get(&cert.id) {
        return Json(json!({ "status": existing.status, "certificate": existing, "result": r })).into_response();
    }
    store.seen.entry(audience).or_default().extend(cert.tags.iter().cloned());
    store.certificates.insert(cert.id.clone(), cert.clone());
    rail.save(&store).await;
    drop(store);
    tracing::info!(id = %cert.id, "certificate pre-cleared");
    rail.notify(&app.http, "certificate.precleared", &cert);
    Json(json!({ "status": "pre-cleared", "certificate": cert, "result": r })).into_response()
}

#[derive(Deserialize)]
pub struct ListQuery {
    audience: Option<String>,
}

pub async fn list(State(app): State<Arc<App>>, headers: HeaderMap, Query(q): Query<ListQuery>) -> Response {
    if !app.rail.authorised(&headers) {
        return unauthorised();
    }
    let store = app.rail.store.lock().await;
    let want = q.audience.map(|a| a.trim().to_lowercase());
    let mut certs: Vec<&Certificate> = store.certificates.values().filter(|c| want.as_ref().is_none_or(|a| &c.audience == a)).collect();
    certs.sort_by_key(|c| std::cmp::Reverse(c.created_at));
    Json(json!({ "certificates": certs })).into_response()
}

pub async fn get_one(State(app): State<Arc<App>>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    if !app.rail.authorised(&headers) {
        return unauthorised();
    }
    match app.rail.store.lock().await.certificates.get(&id) {
        Some(c) => Json(c).into_response(),
        None => err(StatusCode::NOT_FOUND, "no such certificate"),
    }
}

#[derive(Deserialize)]
pub struct MatchBody {
    txid: Option<String>,
    /// mainnet or testnet; default: the certificate's anchor network.
    network: Option<String>,
    /// For the demo ledger, which has no transactions: the deposit's nullifiers directly.
    nullifiers: Option<Vec<String>>,
}

pub async fn match_deposit(State(app): State<Arc<App>>, headers: HeaderMap, Path(id): Path<String>, Json(b): Json<MatchBody>) -> Response {
    let rail = &app.rail;
    if !rail.authorised(&headers) {
        return unauthorised();
    }
    let Some(cert) = rail.store.lock().await.certificates.get(&id).cloned() else {
        return err(StatusCode::NOT_FOUND, "no such certificate");
    };
    let (height, nullifiers) = match (&b.nullifiers, &b.txid) {
        (Some(nfs), _) => (None, nfs.iter().map(|n| n.trim().to_lowercase()).collect::<Vec<_>>()),
        (None, Some(txid)) => {
            let network = b.network.clone().unwrap_or_else(|| cert.network.clone());
            match fetch_nullifiers(&network, txid).await {
                Ok((h, nfs)) => (Some(h), nfs),
                Err(e) => {
                    tracing::info!("deposit lookup failed: {e:#}");
                    return err(StatusCode::BAD_GATEWAY, format!("could not read transaction {txid} on {network}: it may not be mined yet"));
                }
            }
        }
        (None, None) => return err(StatusCode::BAD_REQUEST, "give the deposit's txid (or, on the demo ledger, its nullifiers)"),
    };
    if nullifiers.iter().any(|n| n.len() != 64 || !n.bytes().all(|c| c.is_ascii_hexdigit())) {
        return err(StatusCode::BAD_REQUEST, "nullifiers are 32 bytes of hex");
    }
    let result = if nullifiers.is_empty() {
        ExitMatch::NoShieldedSpend
    } else {
        let not_certified: Vec<String> = nullifiers.iter().filter(|n| !cert.revealed.contains(n)).cloned().collect();
        if not_certified.is_empty() {
            ExitMatch::Matched { spent: nullifiers.iter().collect::<BTreeSet<_>>().len() }
        } else {
            ExitMatch::Mismatch { not_certified }
        }
    };
    let status = if matches!(result, ExitMatch::Matched { .. }) { "matched" } else { "mismatch" };
    let deposit = Deposit { txid: b.txid.clone(), height, nullifiers, result, checked_at: now() };
    let mut store = rail.store.lock().await;
    let Some(c) = store.certificates.get_mut(&id) else { return err(StatusCode::NOT_FOUND, "no such certificate") };
    c.status = status.into();
    c.deposit = Some(deposit);
    let cert = c.clone();
    rail.save(&store).await;
    drop(store);
    tracing::info!(id = %cert.id, status, "deposit checked");
    rail.notify(&app.http, &format!("deposit.{status}"), &cert);
    Json(json!({ "status": status, "certificate": cert })).into_response()
}

#[cfg(feature = "rail")]
async fn fetch_nullifiers(network: &str, txid: &str) -> anyhow::Result<(u32, Vec<String>)> {
    let net = pof_anchor::Network::parse(network).ok_or_else(|| anyhow::anyhow!("deposits are read on mainnet or testnet, not {network}"))?;
    let server = std::env::var(format!("POF_LIGHTWALLETD_{}", network.to_uppercase())).unwrap_or_else(|_| net.default_server().into());
    let mut lwd = pof_anchor::client::Lightwalletd::connect(&server).await?;
    lwd.ensure_chain(net).await?;
    let (h, nfs) = lwd.transaction_nullifiers(txid).await?;
    Ok((h, nfs.iter().map(hex::encode).collect()))
}

#[cfg(not(feature = "rail"))]
async fn fetch_nullifiers(_network: &str, _txid: &str) -> anyhow::Result<(u32, Vec<String>)> {
    anyhow::bail!("this build reads no transactions (feature rail is off): post the nullifiers instead")
}

#[derive(Deserialize)]
pub struct BatchBody {
    batch: String,
    audience: String,
    epoch: Option<u64>,
    /// Also sign the verdict for pof-reserve's feed (needs SOLANA_RPC_URL for the slot).
    #[serde(default)]
    attest: bool,
}

/// pof-reserve's message, little-endian: domain 14 · scope 32 · audience 32 · total_zatoshi 8 ·
/// members 2 · anchor_height 4 · nc_height 4 · expires_at 8 · slot 8 = 112 bytes.
pub const RESERVE_DOMAIN: &[u8; 14] = b"POF-RESERVE-v1";
pub const RESERVE_MESSAGE_LEN: usize = 112;

#[allow(clippy::too_many_arguments)]
pub fn reserve_message(scope: &[u8; 32], audience: &[u8; 32], total: u64, members: u16, anchor_height: u32, nc_height: u32, expires_at: u64, slot: u64) -> [u8; RESERVE_MESSAGE_LEN] {
    let mut m = [0u8; RESERVE_MESSAGE_LEN];
    m[0..14].copy_from_slice(RESERVE_DOMAIN);
    m[14..46].copy_from_slice(scope);
    m[46..78].copy_from_slice(audience);
    m[78..86].copy_from_slice(&total.to_le_bytes());
    m[86..88].copy_from_slice(&members.to_le_bytes());
    m[88..92].copy_from_slice(&anchor_height.to_le_bytes());
    m[92..96].copy_from_slice(&nc_height.to_le_bytes());
    m[96..104].copy_from_slice(&expires_at.to_le_bytes());
    m[104..112].copy_from_slice(&slot.to_le_bytes());
    m
}

pub async fn batch(State(app): State<Arc<App>>, Json(b): Json<BatchBody>) -> Response {
    use ed25519_dalek::Signer;
    let policy = Policy { epoch: b.epoch, ..Policy::default() };
    let r = match app.check_batch(b.batch.as_bytes(), b.audience.trim(), policy).await {
        Ok(r) => r,
        Err(busy) => return busy.into_response(),
    };
    let pof_verify::BatchVerdict::Valid { total_zatoshi, members, anchor_height, dormant_since, scope } = &r.verdict else {
        let status = if b.attest { StatusCode::UNPROCESSABLE_ENTITY } else { StatusCode::OK };
        return (status, Json(r)).into_response();
    };
    if !b.attest {
        return Json(r).into_response();
    }
    let slot = match app.slot().await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    // Every member has passed the expiry check; the feed holds until the first of them expires.
    let expires_at = r.members.iter().filter_map(|m| m.envelope.as_ref().map(|e| e.envelope.expires_at)).min().unwrap_or(0);
    let audience = pof_core::audience_hash(b.audience.trim());
    let scope: [u8; 32] = hex::decode(scope).ok().and_then(|v| v.try_into().ok()).unwrap_or([0; 32]);
    let msg = reserve_message(&scope, &audience, *total_zatoshi, *members as u16, *anchor_height, dormant_since.unwrap_or(*anchor_height), expires_at, slot);
    let sig = app.key.sign(&msg);
    Json(json!({
        "result": r,
        "attestation": {
            "domain": "POF-RESERVE-v1",
            "totalZatoshi": total_zatoshi,
            "members": members,
            "anchorHeight": anchor_height,
            "expiresAt": expires_at,
            "slot": slot,
            "message": hex::encode(msg),
            "signature": hex::encode(sig.to_bytes()),
            "attestor": bs58::encode(app.key.verifying_key().to_bytes()).into_string(),
        }
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve_message_layout_matches_pof_reserve() {
        let m = reserve_message(&[1; 32], &[2; 32], 401_812_500_000, 3, 3_491_040, 3_481_000, 1_798_761_600, 400_000_000);
        assert_eq!(m.len(), 112);
        assert_eq!(&m[0..14], b"POF-RESERVE-v1");
        assert_eq!(u64::from_le_bytes(m[78..86].try_into().unwrap()), 401_812_500_000);
        assert_eq!(u16::from_le_bytes([m[86], m[87]]), 3);
        assert_eq!(u32::from_le_bytes(m[92..96].try_into().unwrap()), 3_481_000);
        assert_eq!(u64::from_le_bytes(m[104..112].try_into().unwrap()), 400_000_000);
    }
}
