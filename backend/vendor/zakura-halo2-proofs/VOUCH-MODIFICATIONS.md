# Vouch modifications to zakura-halo2-proofs 1.2.0

Vendored from crates.io `zakura-halo2-proofs` 1.2.0 (MIT OR Apache-2.0). Licence unchanged.

`keygen_vk` spends almost all of its time on multi-scalar multiplications for the fixed and
permutation commitments: about 0.5 s natively and about 18 s in single-threaded WebAssembly. A browser
verifier cannot make every visitor wait that long.

| File | Change |
| --- | --- |
| `src/plonk/keygen.rs` | Added `vk_commitments(&vk)` (exports the key's point data) and `keygen_vk_from_commitments(params, circuit, fixed, permutation)` (same synthesis as `keygen_vk`, commitments supplied instead of computed). |
| `src/plonk/permutation.rs` | `VerifyingKey::commitments()` no longer behind `unstable-verifier-fingerprint`; added `from_commitments`. |

`pof-zk` embeds the exported commitments and checks them against a freshly computed key in a native
test (`embedded_vk_matches_keygen`). Nothing in proving or verification logic is changed.
