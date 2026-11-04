//! Invariant: the prover cannot broadcast. The library links no network client and no
//! transaction sender, and no source file names one. If this test fails, someone wired up a
//! send path.
//!
//! The dependency check covers the library build (`--no-default-features`). The `cli`
//! feature adds `ureq` for exactly one call: `pof-prove revoke` posting a revocation secret
//! to the endpoint the holder names. Nothing else in the CLI touches the network.

use std::process::Command;

#[test]
fn prover_links_no_network_client() {
    let out = Command::new(env!("CARGO"))
        .args(["tree", "-p", "pof-prove", "--no-default-features", "-e", "normal", "--prefix", "none"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("cargo tree");
    let tree = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    for banned in ["zakura-client-backend", "tonic ", "hyper", "reqwest", "ureq", "zcash_client_sqlite", "zakura-client-sqlite"] {
        assert!(!tree.contains(banned), "the prover library links {banned}");
    }
}

#[test]
fn no_source_file_sends_a_transaction() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut stack = vec![dir];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let s = std::fs::read_to_string(&p).unwrap();
                for banned in ["send_transaction", "SendTransaction", "broadcast_tx", "sendrawtransaction"] {
                    assert!(!s.contains(banned), "{} mentions {banned}", p.display());
                }
            }
        }
    }
}
