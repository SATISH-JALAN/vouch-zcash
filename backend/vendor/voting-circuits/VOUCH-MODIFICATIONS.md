# Vouch modifications to voting-circuits 0.12.1

Vendored from crates.io `voting-circuits` 0.12.1 (Valar Group, MIT OR Apache-2.0).
Licence files and notices are unchanged. Every change is marked `VOUCH MODIFICATION` in the source.

| File | Change |
| --- | --- |
| `src/delegation/circuit.rs` | New public input at offset 14, `min_ballots`. Condition 8 additionally witnesses `excess = num_ballots - min_ballots`, constrains `excess + min_ballots == num_ballots`, and range-checks `excess` to 30 bits. `Instance` gains `min_ballots` (default 0) and `with_min_ballots`. |
| `src/delegation/builder.rs`, `circuit.rs` tests | Shape tripwires updated from 14 to 15 public inputs. |
| `src/delegation/prove.rs` | Added `vouch_threshold` real-proof test. |

With `min_ballots = 0` the statement is identical to upstream. The verifying key differs from upstream
because the constraint system changed; Halo2 over Pasta uses IPA, so there is no trusted setup and the
new key is derived deterministically from the circuit.
| `src/delegation/imt.rs`, `mod.rs` | Added `DenseImtProvider`: the same canonical punctured-range IMT over any number of nullifiers (upstream's provider is a 32-leaf fixture). Test `dense_matches_spaced_fixture`. |

## Exit certificates (Vouch circuit 2), 4 Oct 2026

| File | Change |
| --- | --- |
| `src/delegation/circuit.rs` | `Circuit::synthesize` now calls `synthesize_with(config, layouter, false)`, which is the same body; nothing is added when `reveal` is false, so `Circuit`'s constraint system and verifying key are unchanged. New `RevealCircuit(pub Circuit)`: same `configure` (no new gates), `synthesize_with(.., true)`. With `reveal`, the flag is copied from instance offset 15 and constrained boolean (`reveal * reveal == reveal`, via the existing multiplication chip), and for each slot `reveal * real_nf_i` is constrained to instance offset 16 + i. `synthesize_note_slot` also returns the slot's `real_nf` cell. `Instance` gains `reveal: Option<(flag, [nf; 5])>` (default `None`), `with_reveal`, and `NUM_PUBLIC_INPUTS_REVEAL = 21`; `to_halo2_instance` appends the six values when set. |
| `src/delegation/builder.rs` | `DelegationBundle` gains `real_nullifiers` (each slot's real nullifier; padding slots: their synthetic note's). `PaddingSlot::real_nf` is no longer test-only. |
| `src/delegation/prove.rs`, `mod.rs` | `reveal_cached_keys`, `create_reveal_proof`, `verify_reveal_proof`. Real-proof test `vouch_reveal`: reveal on and off, a forged revealed nullifier, a flag of 2, and that reveal and delegation proofs do not verify as each other. |

Why: a recipient (a swap rail, an exchange) can check that a deposit transaction spends exactly the
notes a proof was made for: every nullifier the deposit reveals on chain must be among the proof's
revealed nullifiers. Padding slots reveal nullifiers of synthetic notes that never appear on chain.
