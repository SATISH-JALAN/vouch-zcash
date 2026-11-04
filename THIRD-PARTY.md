# Third-party code

Vouch is built on open-source Zcash and Solana work. This file lists what we depend on, what each piece does for us, and exactly where we changed anything. Vouch itself is MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`).

## What we built on

| Crate / package | Licence | Author | What it does for Vouch |
| --- | --- | --- | --- |
| `voting-circuits` 0.12.1 | MIT OR Apache-2.0 | Valar Group | **The engine.** The delegation circuit (ZKP #1) proves that up to five Ironwood notes are in the tree, unspent and under the prover's keys, and commits to their total. **Vendored and modified** (see below). |
| `voting-crypto-deps` 0.2.3 | MIT OR Apache-2.0 | Valar Group | Facade selecting the Zakura cryptography crates. **Vendored and modified** (see below). |
| `zcash_voting` 5.1 (approach only) | MIT OR Apache-2.0 | Chainapsis / Valar Group | How to drive the delegation circuit: witnesses at a snapshot, IMT non-membership, the keystone note. We follow its approach and do not link it. |
| `zakura-orchard`, `zakura-halo2-*`, `zakura-pasta-curves`, `zakura-sinsemilla`, `zakura-reddsa`, `zakura-keys`, `zakura-primitives` 1.2.0 | MIT OR Apache-2.0 | Zakura project | Ironwood notes and keys, note encryption, the Sinsemilla tree, Halo2 (IPA over Pasta), RedPallas. `zakura-halo2-proofs` is **vendored and modified** (see below). |
| `zakura-client-backend` 0.1.0-rc5 | MIT OR Apache-2.0 | Zakura project | The lightwalletd gRPC types and client used by `pof-anchor`. |
| `zcash_note_encryption` 0.4.2, `zip32` 0.2.1, `incrementalmerkletree` 0.8.2 | MIT OR Apache-2.0 | Electric Coin Co. / Zcash community | Compact trial decryption, ZIP 32 key derivation, tree hashing traits. |
| `maybe-rayon` 0.1.1 | MIT | — | Serial/parallel shim used by the curve library. **Vendored and modified** (see below). |
| `anchor-lang`, `anchor-spl` 1.2.0 | Apache-2.0 | Anchor contributors | The Solana programs `pof-gate` and `pof-credit`. |
| `litesvm` 0.16 | Apache-2.0 | LiteSVM contributors | Program tests. |
| `ed25519-dalek` 2 | BSD-3-Clause | dalek-cryptography | The attestor's signatures. |
| `axum`, `tokio`, `tonic`, `reqwest` | MIT | tokio-rs and others | The attestor service and the lightwalletd client. |
| `bip39` 2 | CC0-1.0 | rust-bitcoin | Mnemonic → seed in the prover. |
| `wasm-bindgen` 0.2.128 | MIT OR Apache-2.0 | rustwasm | The browser verifier's bindings. |
| `@solana/web3.js` 1.x, `@solana/spl-token` 0.4 | Apache-2.0 | Solana Labs / Anza | The demo relayer and the on-chain setup script. |
| Next.js, React, Tailwind CSS, GSAP, Lenis, zustand | MIT (GSAP: Webflow's free licence) | — | The site. |
| Switzer (Fontshare) | ITF Free Font Licence | Indian Type Foundry | Body type. |

## Vendored and modified

Each vendored crate keeps its original licence files and notices. The crates.io package of `voting-crypto-deps` ships no licence text, so its `LICENSE-MIT` and `LICENSE-APACHE` are the ones at the root of its upstream repository, `valargroup/voting-circuits`. Every change is marked `VOUCH MODIFICATION` or `VOUCH` in the source and listed in the crate's `VOUCH-MODIFICATIONS.md`.

| Vendored crate | Change | Why |
| --- | --- | --- |
| `backend/vendor/voting-circuits` | A 15th public input, `min_ballots`, and the constraint `num_ballots − min_ballots ∈ [0, 2³⁰)`. Added `DenseImtProvider`, an IMT of any size built with the crate's own hashing. Shape tests updated from 14 to 15 inputs; new real-proof tests. | Threshold claims ("at least X") without revealing the sum. An IMT over the real mainnet nullifier set (the upstream provider is a 32-leaf fixture). With `min_ballots = 0` the statement is identical to upstream. |
| `backend/vendor/voting-circuits` (exit certificates) | `RevealCircuit`: the same circuit and gates plus a boolean `reveal` (public input 15) and `reveal × real_nf` per slot (16–20), with its own verifying key; `Circuit`'s constraint system and key are unchanged. `DelegationBundle` exposes each slot's real nullifier. Real-proof test `vouch_reveal`. | A recipient can check that a deposit spends exactly the notes a certificate proved. With `reveal = 0` the revealed inputs are forced to zero. |
| `backend/vendor/voting-crypto-deps` | The `zakura-orchard` dependency uses `default-features = false`; `multicore` became its own (default) feature. | The browser verifier (wasm32) must build without threads. |
| `backend/vendor/zakura-halo2-proofs` | Added `vk_commitments` and `keygen_vk_from_commitments`. | Loading a precomputed verifying key: browser warm-up drops from ~18 s to ~0.3 s. A native test checks the embedded key against `keygen_vk`. |
| `backend/vendor/maybe-rayon` | Serial shims for `current_num_threads`, `par_iter`, `par_chunks`, `par_chunks_mut`. | Needed for wasm32 builds; native builds re-export real rayon. |

## Not code, but credited

- ZIP 311 (Zcash payment disclosures) and the Zally shielded-voting specification inform the design.
- Chain data comes from public lightwalletd servers (`zec.rocks`) and Solana RPC.
