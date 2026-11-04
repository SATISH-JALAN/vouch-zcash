//! pof-attest — the one irreducible service.
//!
//! Solana cannot verify a Halo2 proof over Pallas or read Zcash state, so this service runs
//! `pof-verify` (the same code as the CLI and the browser) and signs the verdict with Ed25519
//! for `pof-gate` to check through instruction introspection. It is deliberately boring,
//! stateless apart from its key, and replaceable: anyone can run one, and anyone can re-derive
//! any verdict it signed from the proof and public chain data.
//!
//!   POST /v1/attest       {proof, audience?}   → 200 {attestation} | 422 {verdict}
//!   POST /v1/verify       {proof, audience?}   → 200 VerificationResult (no signature)
//!   GET  /v1/pubkey                            → {pubkey, verifier, demoProver}
//!   GET  /v1/anchor/:h                         → anchor records at height h
//!   POST /v1/demo/prove   {request, bindSolana?} → {proof, revocationSecret, …}   (feature demo-prover)
//!   GET  /health
//!   …and the rail API (exit certificates, deposit matching, batches): see rail.rs.
//!
//! Environment: POF_ATTEST_KEY (hex Ed25519 seed; an ephemeral key is used if unset),
//! POF_ANCHORS (anchor table JSON, required), POF_REVOCATIONS_URL (the site's /api/revocations),
//! POF_REVOCATIONS_FILE (static list), POF_AUDIENCE (default pof-credit:usdc-pool-1),
//! SOLANA_RPC_URL (for the freshness slot), POF_DEMO_WORLD (enables the demo holder), PORT.

use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use ed25519_dalek::{Signer, SigningKey};
use pof_core::{subject_hash, Envelope};
use pof_verify::{verify, verify_batch, AnchorRecord, BatchResult, Context, Policy, Verdict, ZkVerifier};

mod rail;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{Mutex, Semaphore};

pub const DOMAIN: &[u8; 13] = b"POF-ATTEST-v1";
pub const MESSAGE_LEN: usize = 139;
/// A .pof is at most ~17 KiB, ~23 KiB as base64url: nothing legitimate is larger.
const BODY_LIMIT: usize = 64 * 1024;
const REVOCATIONS_TTL: Duration = Duration::from_secs(10);

struct App {
    key: SigningKey,
    zk: ZkVerifier,
    anchors: Vec<AnchorRecord>,
    audience: String,
    revocations_url: Option<String>,
    static_revocations: Vec<String>,
    /// When the URL list was last fetched (successfully or not), and the last list read.
    revocation_cache: Mutex<(Option<Instant>, Vec<String>)>,
    rpc: Option<String>,
    http: reqwest::Client,
    /// Halo2 verification is CPU-bound: at most one per core at a time.
    verifiers: Semaphore,
    #[cfg(feature = "demo-prover")]
    demo: Option<demo::Demo>,
    rail: rail::Rail,
}

pub(crate) fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs()
}

/// The domain-separated message pof-gate checks. Layout (little-endian integers):
/// domain 13 · subject 32 · beneficiary 32 · audience 32 · claim_kind 1 · claim_value 8 ·
/// anchor_height 4 · expires_at 8 · verdict 1 · slot 8 = 139 bytes.
pub fn attestation_message(env: &Envelope, slot: u64) -> [u8; MESSAGE_LEN] {
    let mut m = [0u8; MESSAGE_LEN];
    m[0..13].copy_from_slice(DOMAIN);
    m[13..45].copy_from_slice(&subject_hash(env));
    m[45..77].copy_from_slice(&env.binding);
    m[77..109].copy_from_slice(&env.audience);
    m[109] = env.claim.tag();
    m[110..118].copy_from_slice(&env.claim.zatoshi().to_le_bytes());
    m[118..122].copy_from_slice(&env.anchor.height.to_le_bytes());
    m[122..130].copy_from_slice(&env.expires_at.to_le_bytes());
    m[130] = 0; // Valid: nothing else is ever signed
    m[131..139].copy_from_slice(&slot.to_le_bytes());
    m
}

impl App {
    async fn revoked(&self) -> Vec<String> {
        let mut out = self.static_revocations.clone();
        let Some(url) = &self.revocations_url else { return out };
        // Held across the fetch so concurrent requests share one fetch. A failure stamps the time
        // too, so an unreachable list costs at most one timeout per TTL, not one per request.
        let mut cache = self.revocation_cache.lock().await;
        if cache.0.is_none_or(|t| t.elapsed() > REVOCATIONS_TTL) {
            cache.0 = Some(Instant::now());
            match fetch_revocations(&self.http, url).await {
                Ok(secrets) => cache.1 = secrets,
                // Fail closed would stop the demo on a network blip; fail open keeps the last list
                // read and is logged. The on-chain consumer can re-check revocation before acting.
                Err(e) => tracing::warn!("revocation list unavailable, keeping the last one read: {e}"),
            }
        }
        out.extend(cache.1.iter().cloned());
        out
    }

    /// The current confirmed slot, for pof-gate's freshness check. Errors are logged without the
    /// URL and answered without detail: the RPC URL may carry an API key.
    pub(crate) async fn slot(&self) -> Result<u64, Refusal> {
        let Some(rpc) = &self.rpc else {
            return Err(Refusal(StatusCode::SERVICE_UNAVAILABLE, "this attestor has no SOLANA_RPC_URL, so it cannot sign a fresh attestation"));
        };
        rpc_slot(&self.http, rpc).await.map_err(|e| {
            tracing::warn!("could not read the Solana slot: {e:#}");
            Refusal(StatusCode::BAD_GATEWAY, "could not read the Solana slot")
        })
    }

    async fn check(&self, proof: &str, audience: Option<&str>) -> Result<pof_verify::VerificationResult, Refusal> {
        self.check_with(proof.as_bytes(), audience.unwrap_or(&self.audience), Policy::default(), &[]).await
    }

    /// One proof, with a verifier's own policy and reuse registry (the rail API).
    pub(crate) async fn check_with(&self, proof: &[u8], audience: &str, policy: Policy, seen: &[String]) -> Result<pof_verify::VerificationResult, Refusal> {
        let revoked = self.revoked().await;
        let _permit = tokio::time::timeout(Duration::from_secs(5), self.verifiers.acquire()).await.map_err(|_| BUSY)?.map_err(|_| BUSY)?;
        let ctx = Context { audience, anchors: &self.anchors, revoked_secrets: &revoked, now: now(), zk: &self.zk, policy, seen };
        // CPU-bound: keep it off the async workers so /health and the rest stay responsive.
        Ok(tokio::task::block_in_place(|| verify(proof, &ctx)))
    }

    /// A reserves batch: one permit, since its proofs are checked together.
    pub(crate) async fn check_batch(&self, batch: &[u8], audience: &str, policy: Policy) -> Result<BatchResult, Refusal> {
        let revoked = self.revoked().await;
        let _permit = tokio::time::timeout(Duration::from_secs(10), self.verifiers.acquire()).await.map_err(|_| BUSY)?.map_err(|_| BUSY)?;
        let ctx = Context { audience, anchors: &self.anchors, revoked_secrets: &revoked, now: now(), zk: &self.zk, policy, seen: &[] };
        Ok(tokio::task::block_in_place(|| verify_batch(batch, &ctx)))
    }
}

/// The site's published revocation secrets. As with [`rpc_slot`], the error never contains `url`:
/// it is logged, and a list URL may carry an access token.
async fn fetch_revocations(http: &reqwest::Client, url: &str) -> reqwest::Result<Vec<String>> {
    #[derive(Deserialize)]
    struct List {
        secrets: Vec<String>,
    }
    let fetched = async { http.get(url).timeout(Duration::from_secs(4)).send().await?.error_for_status()?.json::<List>().await }.await;
    Ok(fetched.map_err(reqwest::Error::without_url)?.secrets)
}

/// `getSlot` at confirmed commitment. The error never contains `rpc`: reqwest's own errors name
/// the URL they failed on (with any `?api-key=` in it), and this one is logged.
async fn rpc_slot(http: &reqwest::Client, rpc: &str) -> anyhow::Result<u64> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSlot", "params": [{ "commitment": "confirmed" }] });
    let r = async { http.post(rpc).json(&body).timeout(Duration::from_secs(5)).send().await?.error_for_status()?.json::<serde_json::Value>().await }
        .await
        .map_err(reqwest::Error::without_url)?;
    r["result"].as_u64().ok_or_else(|| anyhow::anyhow!("getSlot returned no slot: {r}"))
}

#[derive(Deserialize)]
struct ProofBody {
    proof: String,
    audience: Option<String>,
}

/// A refusal with a fixed message: small to return, turned into a response at the edge.
pub(crate) struct Refusal(StatusCode, &'static str);

const BUSY: Refusal = Refusal(StatusCode::TOO_MANY_REQUESTS, "the attestor is busy; try again in a few seconds");

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        err(self.0, self.1)
    }
}

pub(crate) fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

async fn attest(State(app): State<Arc<App>>, Json(b): Json<ProofBody>) -> Response {
    let started = Instant::now();
    let r = match app.check(&b.proof, b.audience.as_deref()).await {
        Ok(r) => r,
        Err(busy) => return busy.into_response(),
    };
    let (Verdict::Valid { .. }, Some(view)) = (&r.verdict, r.envelope) else {
        tracing::info!(verdict = ?r.verdict, ms = started.elapsed().as_millis() as u64, "refused");
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "verdict": r.verdict }))).into_response();
    };
    let env = view.envelope;
    if env.binding == [0; 32] {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "verdict": { "kind": "Malformed", "reason": "An on-chain attestation needs a proof bound to a Solana account; this one is unbound." } })),
        )
            .into_response();
    }
    let slot = match app.slot().await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let msg = attestation_message(&env, slot);
    let sig = app.key.sign(&msg);
    tracing::info!(slot, ms = started.elapsed().as_millis() as u64, "signed");
    Json(json!({
        "attestation": {
            "domain": "POF-ATTEST-v1",
            "subject": hex::encode(subject_hash(&env)),
            "beneficiary": bs58::encode(env.binding).into_string(),
            "claimKind": env.claim.tag(),
            "claimValue": env.claim.zatoshi(),
            "anchorHeight": env.anchor.height,
            "expiresAt": env.expires_at,
            "verdict": 0,
            "slot": slot,
            "message": hex::encode(msg),
            "signature": hex::encode(sig.to_bytes()),
            "attestor": bs58::encode(app.key.verifying_key().to_bytes()).into_string(),
        }
    }))
    .into_response()
}

async fn verify_only(State(app): State<Arc<App>>, Json(b): Json<ProofBody>) -> Response {
    match app.check(&b.proof, b.audience.as_deref()).await {
        Ok(r) => Json(r).into_response(),
        Err(busy) => busy.into_response(),
    }
}

async fn pubkey(State(app): State<Arc<App>>) -> Response {
    #[cfg(feature = "demo-prover")]
    let demo = app.demo.is_some();
    #[cfg(not(feature = "demo-prover"))]
    let demo = false;
    Json(json!({
        "pubkey": bs58::encode(app.key.verifying_key().to_bytes()).into_string(),
        "verifier": pof_verify::VERIFIER_VERSION,
        "vkFingerprint": app.zk.fingerprint(),
        "audience": app.audience,
        "demoProver": demo,
    }))
    .into_response()
}

async fn anchor(State(app): State<Arc<App>>, Path(h): Path<u32>) -> Response {
    let rs: Vec<_> = app.anchors.iter().filter(|a| a.height == h).cloned().collect();
    if rs.is_empty() {
        return err(StatusCode::NOT_FOUND, format!("no anchor at height {h}"));
    }
    Json(rs).into_response()
}

#[cfg(feature = "demo-prover")]
mod demo {
    use super::*;
    use pof_prove::{envelope_for, world::DemoWorld, ProofRequest, Snapshot};

    pub struct Demo {
        pub world: DemoWorld,
        pub snap: Snapshot,
        /// Proving takes seconds of CPU: at most two at a time, the rest are told to retry.
        pub provers: Semaphore,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ProveBody {
        request: ProofRequest,
        bind_solana: Option<String>,
    }

    pub async fn prove(State(app): State<Arc<App>>, Json(b): Json<ProveBody>) -> Response {
        let Some(demo) = &app.demo else { return err(StatusCode::SERVICE_UNAVAILABLE, "the demo holder is not enabled (POF_DEMO_WORLD is unset)") };
        if let Err(e) = b.request.validate() {
            return err(StatusCode::BAD_REQUEST, e.to_string());
        }
        let binding = match (&b.request.bind, &b.bind_solana) {
            (_, Some(k)) => match bs58::decode(k.trim()).into_vec().ok().and_then(|v| <[u8; 32]>::try_from(v).ok()) {
                Some(k) => k,
                None => return err(StatusCode::BAD_REQUEST, "bindSolana is not a base58 Solana public key"),
            },
            (Some(_), None) => return err(StatusCode::BAD_REQUEST, "this request must be bound to a Solana account: send bindSolana"),
            (None, None) => [0u8; 32],
        };
        let Ok(_permit) = demo.provers.try_acquire() else { return err(StatusCode::TOO_MANY_REQUESTS, "the demo holder is busy; try again in a few seconds") };
        let mut secret = [0u8; 32];
        getrandom::getrandom(&mut secret).expect("OS randomness");
        let mut env = envelope_for(&b.request, demo.snap.anchor(), now(), binding, &secret);
        let started = Instant::now();
        let notes = match demo.world.notes() {
            Ok(n) => n,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };
        let sk = match demo.world.spending_key() {
            Ok(k) => k,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };
        // Proving is CPU-bound: keep it off the async workers.
        let snap = &demo.snap;
        let result = tokio::task::block_in_place(|| pof_prove::prove(&sk, &notes, snap, &mut env));
        match result {
            Ok(n) => {
                let ms = started.elapsed().as_millis() as u64;
                tracing::info!(ms, notes = n, "demo proof");
                Json(json!({
                    "proof": pof_core::to_base64url(&pof_core::encode(&env)),
                    "revocationSecret": hex::encode(secret),
                    "notesUsed": n,
                    "provingMs": ms,
                }))
                .into_response()
            }
            Err(e) => err(StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
        }
    }
}

fn load_key() -> SigningKey {
    match std::env::var("POF_ATTEST_KEY") {
        Ok(h) => {
            let b: [u8; 32] = hex::decode(h.trim()).ok().and_then(|v| v.try_into().ok()).expect("POF_ATTEST_KEY must be 32 bytes of hex");
            SigningKey::from_bytes(&b)
        }
        Err(_) => {
            // The seed is never printed: logs are retained. Make a lasting key with
            // `openssl rand -hex 32` and pass it as POF_ATTEST_KEY.
            tracing::warn!("POF_ATTEST_KEY unset: signing with an ephemeral key that changes on every restart");
            let mut seed = [0u8; 32];
            getrandom::getrandom(&mut seed).expect("OS randomness");
            SigningKey::from_bytes(&seed)
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let anchors_path = std::env::var("POF_ANCHORS").map_err(|_| anyhow::anyhow!("set POF_ANCHORS to the anchor table to trust (e.g. frontend/src/data/anchors.json)"))?;
    let anchors: Vec<AnchorRecord> = serde_json::from_slice(&std::fs::read(&anchors_path).map_err(|e| anyhow::anyhow!("{anchors_path}: {e}"))?)?;
    if anchors.iter().any(|a| a.network == "demo") {
        tracing::warn!("the anchor table includes the demo ledger: this key signs demo proofs, so only demo deployments may trust it");
    }
    if anchors.iter().any(|a| a.network == "testnet") {
        // The 139-byte attestation carries the anchor height, not its network.
        tracing::warn!("the anchor table includes Zcash testnet: this key signs testnet proofs (TAZ has no value), so only demo deployments may trust it");
    }
    let static_revocations = match std::env::var("POF_REVOCATIONS_FILE") {
        Ok(p) => {
            #[derive(Deserialize)]
            struct List {
                secrets: Vec<String>,
            }
            let bytes = std::fs::read(&p).map_err(|e| anyhow::anyhow!("{p}: {e}"))?;
            serde_json::from_slice::<List>(&bytes).map_err(|e| anyhow::anyhow!("{p}: {e}"))?.secrets
        }
        Err(_) => vec![],
    };
    #[cfg(feature = "demo-prover")]
    let demo = match std::env::var("POF_DEMO_WORLD") {
        Ok(p) => {
            let world: pof_prove::world::DemoWorld = serde_json::from_slice(&std::fs::read(&p)?)?;
            let snap = world.snapshot()?;
            tracing::info!(leaves = snap.tree.size(), "demo holder enabled");
            Some(demo::Demo { world, snap, provers: Semaphore::new(2) })
        }
        Err(_) => None,
    };
    let app = Arc::new(App {
        key: load_key(),
        zk: ZkVerifier::new().map_err(|e| anyhow::anyhow!(e))?,
        anchors,
        audience: std::env::var("POF_AUDIENCE").unwrap_or_else(|_| "pof-credit:usdc-pool-1".into()),
        revocations_url: std::env::var("POF_REVOCATIONS_URL").ok(),
        static_revocations,
        revocation_cache: Mutex::new((None, vec![])),
        rpc: std::env::var("SOLANA_RPC_URL").ok(),
        http: reqwest::Client::new(),
        verifiers: Semaphore::new(std::thread::available_parallelism().map_or(2, |n| n.get())),
        #[cfg(feature = "demo-prover")]
        demo,
        rail: rail::Rail::from_env()?,
    });
    if app.rpc.is_none() {
        tracing::warn!("SOLANA_RPC_URL unset: /v1/attest will refuse to sign (it has no slot for freshness)");
    }
    tracing::info!(pubkey = %bs58::encode(app.key.verifying_key().to_bytes()).into_string(), anchors = app.anchors.len(), "pof-attest ready");

    let router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/pubkey", get(pubkey))
        .route("/v1/anchor/{h}", get(anchor))
        .route("/v1/attest", post(attest))
        .route("/v1/verify", post(verify_only))
        .route("/v1/certificates", post(rail::submit).get(rail::list))
        .route("/v1/certificates/{id}", get(rail::get_one))
        .route("/v1/certificates/{id}/match", post(rail::match_deposit))
        // a batch of up to 64 proofs is ~1 MB as base64url
        .route("/v1/batch", post(rail::batch).layer(DefaultBodyLimit::max(2 * 1024 * 1024)));
    #[cfg(feature = "demo-prover")]
    let router = router.route("/v1/demo/prove", post(demo::prove));
    let router = router.layer(DefaultBodyLimit::max(BODY_LIMIT)).with_state(app);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8787".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    tracing::info!("listening on :{port}");
    axum::serve(listener, router).with_graceful_shutdown(shutdown()).await?;
    Ok(())
}

/// Ctrl-C, or SIGTERM from `docker stop` and the platform (the binary is PID 1 in the image).
async fn shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("installing the SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use pof_core::decode;

    #[test]
    fn message_layout_is_139_bytes_and_domain_separated() {
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../fixtures/proofs/valid.pof")).unwrap();
        let (env, _) = decode(&bytes).unwrap();
        let m = attestation_message(&env, 42);
        assert_eq!(m.len(), 139);
        assert_eq!(&m[..13], b"POF-ATTEST-v1");
        assert_eq!(u64::from_le_bytes(m[110..118].try_into().unwrap()), 50_000_000_000);
        assert_eq!(u64::from_le_bytes(m[131..139].try_into().unwrap()), 42);
        assert_eq!(&m[77..109], &env.audience);
    }

    /// A one-shot HTTP server on 127.0.0.1 answering `status` with `body`. Returns its port.
    fn serve_once(status: &'static str, body: &'static str) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let _ = s.read(&mut [0u8; 8192]);
            let _ = write!(s, "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
        });
        port
    }

    fn url(port: u16) -> String {
        format!("http://127.0.0.1:{port}/SECRET-PATH?api-key=SECRET-KEY")
    }

    /// Every failure is logged: none may carry the URL, which can hold an API key.
    #[tokio::test]
    async fn fetch_errors_never_name_the_url() {
        let http = reqwest::Client::new();
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let mut errors = vec![
            format!("{:#}", rpc_slot(&http, &url(closed)).await.unwrap_err()),
            format!("{:#}", rpc_slot(&http, &url(serve_once("500 Internal Server Error", "{}"))).await.unwrap_err()),
            format!("{:#}", rpc_slot(&http, &url(serve_once("200 OK", "not json"))).await.unwrap_err()),
            format!("{:#}", rpc_slot(&http, &url(serve_once("200 OK", r#"{"error":"x"}"#))).await.unwrap_err()),
        ];
        for (status, body) in [("503 Service Unavailable", "{}"), ("200 OK", "[1]")] {
            errors.push(format!("{:#}", anyhow::Error::from(fetch_revocations(&http, &url(serve_once(status, body))).await.unwrap_err())));
        }
        for e in errors {
            assert!(!e.contains("SECRET"), "{e}");
        }
        assert_eq!(rpc_slot(&http, &url(serve_once("200 OK", r#"{"jsonrpc":"2.0","result":42,"id":1}"#))).await.unwrap(), 42);
        assert_eq!(fetch_revocations(&http, &url(serve_once("200 OK", r#"{"secrets":["ab"]}"#))).await.unwrap(), ["ab"]);
    }
}
