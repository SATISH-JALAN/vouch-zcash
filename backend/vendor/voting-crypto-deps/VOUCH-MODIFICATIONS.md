# Vouch modifications to voting-crypto-deps 0.2.3

Vendored from crates.io `voting-crypto-deps` 0.2.3 (Valar Group, MIT OR Apache-2.0). Licence unchanged.

`zakura-orchard` was depended on with its default features, which include `multicore`, which turns on
`zakura-pasta-curves/multicore`. That code needs real rayon and does not build for
`wasm32-unknown-unknown`. The orchard dependency now uses `default-features = false` with `circuit`
and `std`, and a new `multicore` feature (part of `default`) restores threading. Native builds are
unchanged; the WASM verifier builds without `multicore`.
