# Backend

The Rust side of Vouch: the proof format, the circuit glue, the verifier (native and WASM), the prover, the anchor indexer, the attestor, and the Solana programs. It is one Cargo workspace, pinned by `rust-toolchain.toml`; `solana/` is a separate workspace built with Anchor.

## Crates

| Crate | Role | Network? |
| --- | --- | --- |
| `pof-core` | The `.pof` format: types, encoder and decoder, checksum, statement and signing hashes, audience and revocation hashes. | none |
| `pof-zk` | Glue to the delegation circuit: the embedded verifying key, `verify_holding`, the note tree. With `--features prove`: `prove_holding`. | none |
| `pof-verify` | The verifier (`verify(bytes, Context) → VerificationResult`) and the `pof-verify` CLI. | none |
| `pof-wasm` | `pof-verify` for the browser: `warm`, `verify`, `version`. | none |
| `pof-prove` | The prover library and the `pof-prove` CLI: requests, the demo ledger, wallet note discovery, history, revocation. | library: none, enforced by a test · CLI: `revoke` posts the secret |
| `pof-anchor` | Snapshot format and root rebuild. The `pof-anchor` CLI scans lightwalletd. | lightwalletd (gRPC) |
| `pof-attest` | HTTP attestor: verifies, then signs a 139-byte Ed25519 attestation. Also hosts the demo holder. | Solana RPC (slot), revocation list |

Vendored crates are in `vendor/`, and every change is listed in `../THIRD-PARTY.md` and each crate's `VOUCH-MODIFICATIONS.md`.

## Build and test

```bash
cargo test --release --workspace                                    # fast suite
cargo test --release -p pof-zk --features prove --test roundtrip -- --ignored   # real proofs + tampering
cargo test --release -p pof-prove --test wallet -- --ignored         # seed → proof → Valid
cargo test --release -p voting-circuits --lib vouch_threshold -- --ignored   # the circuit change
../scripts/build-wasm.sh                                            # → frontend/public/wasm
node ../scripts/verify-fixtures-wasm.mjs                            # frontend/public/wasm ≡ native on every vector
```

If the circuit changes, regenerate the embedded keys with `cargo test --release -p pof-zk --lib write_embedded_keys -- --ignored`. The test `embedded_vk_matches_keygen` then keeps them honest.

## CLIs

```bash
# Verify
cargo run --release -p pof-verify -- check proof.pof --audience <id> --anchors anchors.json [--revocations r.json] [--json]
# exit: 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run (usage, unreadable file, bad JSON; error on stderr)

# Anchors: scan lightwalletd, write a snapshot, merge the record into the anchor table
cargo run --release -p pof-anchor -- scan    # → target/snapshots/mainnet-<h>.vsnp, merged into ../fixtures/anchors.mainnet.json
cargo run --release -p pof-anchor -- check --snapshot target/snapshots/mainnet-3493000.vsnp
cargo run --release -p pof-anchor -- scan --network testnet   # testnet.zec.rocks, from 4,134,000 → testnet-<h>.vsnp + ../fixtures/anchors.testnet.json
../scripts/sync-fixtures.sh                                          # publish anchors + proofs to the site; then redeploy site and attestor

# Prove (your wallet). The seed file holds a BIP 39 mnemonic or a hex seed; the network (coin type 133 / 1) comes from the snapshot
cargo run --release -p pof-prove -- prove --request '<link>' --snapshot target/snapshots/mainnet-<h>.vsnp --seed-file <file> --out proof.pof [--bind-solana <b58>]
cargo run --release -p pof-prove -- history [--secrets]
cargo run --release -p pof-prove -- revoke <proof id> --endpoint https://<site>/api/revocations

# Demo ledger
cargo run --release -p pof-prove -- demo prove --world ../fixtures/demo-world.json --request '<link>' --out proof.pof
cargo run --release -p pof-prove -- demo fixtures --world ../fixtures/demo-world.json --out ../fixtures [--borrower <b58>]
```

## Attestor

```bash
POF_ANCHORS=../frontend/src/data/anchors.json POF_DEMO_WORLD=../fixtures/demo-world.json \
POF_ATTEST_KEY=<32-byte hex> SOLANA_RPC_URL=http://127.0.0.1:8899 cargo run --release -p pof-attest
```

| Route | |
| --- | --- |
| `GET /health` | liveness |
| `GET /v1/pubkey` | attestor pubkey, audience, verifier version, VK fingerprint |
| `GET /v1/anchor/{height}` | the anchor record it trusts at that height |
| `POST /v1/verify` | `{proof}` → the verifier's full result |
| `POST /v1/attest` | `{proof}` → signed attestation; 422 unless `Valid` and bound to a Solana account |
| `POST /v1/demo/prove` | `{request, bindSolana}` → a demo-ledger proof (feature `demo-prover`, on by default) |

| Variable | Default | |
| --- | --- | --- |
| `POF_ATTEST_KEY` | ephemeral | Ed25519 seed, hex (`openssl rand -hex 32`). Set it, or the pubkey changes on restart. |
| `POF_ANCHORS` | required | Anchor table the attestor trusts |
| `POF_AUDIENCE` | `pof-credit:usdc-pool-1` | The only audience it attests for |
| `POF_REVOCATIONS_URL`, `POF_REVOCATIONS_FILE` | — | Revocation sources (the URL is cached briefly) |
| `SOLANA_RPC_URL` | — | Slot for attestation freshness; `/v1/attest` answers 503 without it |
| `POF_DEMO_WORLD` | — | Enables the demo holder |
| `PORT` | `8787` | |

Container: `docker build -f backend/Dockerfile -t pof-attest .` from the repo root. `fly.toml` holds the Fly.io deploy. For Render's free plan, `Dockerfile.render` builds it without the demo holder (`--no-default-features --features rail`) and `render.yaml` at the repo root deploys it.

## Solana

```bash
cd solana
anchor build                       # target/deploy/*.so, target/idl/*.json
cargo test -p pof-solana-tests     # LiteSVM (needs OpenSSL headers; Linux/macOS/WSL)
```

`pof-gate` verifies attestations through Ed25519 instruction introspection. Every offset must point into the same instruction, and each distinct allowlisted signer counts once towards k. The gate records a receipt per proof, bound to the holder's wallet. `pof-credit` opens one line per receipt and marks it consumed through `mark_consumed`, which only a consumer program's PDA can sign. The line's rent comes from a separate `payer` signer (the demo relayer), so the borrower only signs. After changing an instruction, copy the IDLs to `../frontend/src/data/idl/`. Program-id keypairs live in `solana/keys/` (gitignored); `../scripts/deploy-devnet.sh` uses them.
