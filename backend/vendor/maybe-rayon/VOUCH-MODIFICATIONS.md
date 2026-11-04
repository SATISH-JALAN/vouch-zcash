# Vouch modifications to maybe-rayon 0.1.1

Vendored from crates.io `maybe-rayon` 0.1.1 (MIT). Licence file unchanged.

The serial fallback (used on `wasm32-unknown-unknown` without atomics) lacks helpers that
`zakura-pasta-curves` 1.2.0 calls when its `multicore` feature is on: `current_num_threads`,
`par_iter`, `par_chunks`, `par_chunks_mut`, `par_chunks_exact_mut`. Each is added as a serial
shim, marked `VOUCH` in `src/lib.rs`. On native targets with `threads`, the crate still
re-exports real `rayon`, so native builds are unaffected.
