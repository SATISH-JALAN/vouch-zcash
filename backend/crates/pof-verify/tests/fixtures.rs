//! Every committed vector produces its recorded verdict. The WASM build runs the same list
//! (`scripts/verify-fixtures-wasm.mjs`, `pnpm test:wasm`), so the two verifiers cannot drift apart.

use pof_verify::{verify, verify_batch, AnchorRecord, Context, Policy, ZkVerifier};
use serde_json::Value;
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures")
}

/// The anchor table the site and the attestor ship: every network's records, merged as
/// scripts/sync-fixtures.sh does.
fn all_anchors(dir: &std::path::Path) -> Vec<AnchorRecord> {
    let mut all = vec![];
    for net in ["mainnet", "testnet", "demo"] {
        if let Ok(b) = std::fs::read(dir.join(format!("anchors.{net}.json"))) {
            all.extend(serde_json::from_slice::<Vec<AnchorRecord>>(&b).unwrap());
        }
    }
    all
}

#[test]
fn every_vector_matches_expected() {
    let dir = fixtures();
    let all = all_anchors(&dir);
    let anchors: Vec<AnchorRecord> = serde_json::from_slice(&std::fs::read(dir.join("anchors.demo.json")).unwrap()).unwrap();
    let revoked: Value = serde_json::from_slice(&std::fs::read(dir.join("revocations.demo.json")).unwrap()).unwrap();
    let revoked: Vec<String> = revoked["secrets"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect();
    let meta: Value = serde_json::from_slice(&std::fs::read(dir.join("expected.json")).unwrap()).unwrap();
    let now = meta["evaluatedAt"].as_u64().unwrap();
    let zk = ZkVerifier::new().unwrap();
    let mut failures = vec![];
    // expected.json: the demo vectors (rewritten by `pof-prove demo fixtures`). expected.testnet.json:
    // real Zcash testnet proofs, kept by hand. Each is checked against the merged table.
    let mut sets = vec![meta.clone()];
    if let Ok(b) = std::fs::read(dir.join("expected.testnet.json")) {
        sets.push(serde_json::from_slice(&b).unwrap());
    }
    for set in &sets {
        let now = set["evaluatedAt"].as_u64().unwrap();
        for (name, want) in set["expected"].as_object().unwrap() {
            let file = std::fs::read(dir.join("proofs").join(format!("{name}.pof"))).unwrap();
            let audience = want["audience"].as_str().unwrap();
            // A vector may name what its verifier requires (freshness, dormancy); none by default.
            let policy: Policy = want.get("policy").map(|p| serde_json::from_value(p.clone()).unwrap()).unwrap_or_default();
            // ...and which tags its reuse registry already holds.
            let seen: Vec<String> = want.get("seen").map(|p| serde_json::from_value(p.clone()).unwrap()).unwrap_or_default();
            let r = verify(&file, &Context { audience, anchors: &all, revoked_secrets: &revoked, now, zk: &zk, policy, seen: &seen });
            let got = serde_json::to_value(&r.verdict).unwrap()["kind"].as_str().unwrap().to_string();
            println!("{name:<18} {got}");
            if got != want["verdict"].as_str().unwrap() {
                failures.push(format!("{name}: got {got}, want {}", want["verdict"]));
            }
            if let Some(net) = want.get("network").and_then(Value::as_str) {
                let got = r.anchor.as_ref().map(|a| a.network.as_str());
                if got != Some(net) {
                    failures.push(format!("{name}: anchor network {got:?}, want {net}"));
                }
            }
        }
    }
    // Reserves batches: the summed verdict, and which member is at fault when there is one.
    for set in &sets {
        let now = set["evaluatedAt"].as_u64().unwrap();
        for (name, want) in set.get("batches").and_then(Value::as_object).into_iter().flatten() {
            let file = std::fs::read(dir.join("proofs").join(format!("{name}.pofb"))).unwrap();
            let audience = want["audience"].as_str().unwrap();
            let r = verify_batch(&file, &Context { audience, anchors: &all, revoked_secrets: &revoked, now, zk: &zk, policy: Default::default(), seen: &[] });
            let got = serde_json::to_value(&r.verdict).unwrap();
            println!("{name:<18} {} {}", got["kind"], got.get("totalZatoshi").or(got.get("member")).unwrap_or(&Value::Null));
            for key in ["kind", "totalZatoshi", "member"] {
                if want.get(key).is_some() && got.get(key) != want.get(key) {
                    failures.push(format!("{name}: {key} is {:?}, want {:?}", got.get(key), want.get(key)));
                }
            }
        }
    }

    // base64url text input and garbage
    let valid = std::fs::read(dir.join("proofs/valid.pof")).unwrap();
    let text = pof_core::to_base64url(&valid);
    let r = verify(text.as_bytes(), &Context { audience: "pof-credit:usdc-pool-1", anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk, policy: Default::default(), seen: &[] });
    assert_eq!(serde_json::to_value(&r.verdict).unwrap()["kind"], "Valid");
    let r = verify(&text.as_bytes()[..900], &Context { audience: "x", anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk, policy: Default::default(), seen: &[] });
    assert_eq!(serde_json::to_value(&r.verdict).unwrap()["kind"], "Malformed");
    // expiry is exclusive: at expires_at the proof is already expired, as pof-gate and pof-credit hold
    let expires = pof_core::decode(&valid).unwrap().0.expires_at;
    for (now, want) in [(expires - 1, "Valid"), (expires, "Expired")] {
        let r = verify(&valid, &Context { audience: "pof-credit:usdc-pool-1", anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk, policy: Default::default(), seen: &[] });
        assert_eq!(serde_json::to_value(&r.verdict).unwrap()["kind"], want, "now = expires_at - {}", expires - now);
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
