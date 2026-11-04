#!/usr/bin/env bash
# Build pof-wasm and emit the web bindings the site serves (frontend/public/wasm, committed).
# Always run before `pnpm build` in frontend: a stale verifier is the classic phantom bug.
set -euo pipefail
cd "$(dirname "$0")/.."
# cargo picks the toolchain from the working directory: build from backend/ so rust-toolchain.toml applies
(cd backend && cargo build --locked --release --target wasm32-unknown-unknown -p pof-wasm)
wasm-bindgen "${CARGO_TARGET_DIR:-backend/target}/wasm32-unknown-unknown/release/pof_wasm.wasm" --target web --out-dir frontend/public/wasm --no-typescript
ls -la frontend/public/wasm
