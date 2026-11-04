#!/usr/bin/env bash
# Copy what the Rust side produced into the site: real proofs (public/proofs), the anchor table
# and the demo revocation list (src/data). Run after `pof-prove demo fixtures` or `pof-anchor`.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p frontend/public/proofs frontend/src/data
rm -f frontend/public/proofs/*.pof frontend/public/proofs/*.pofb # a vector dropped from fixtures/ must not linger on the site
cp fixtures/proofs/*.pof fixtures/proofs/*.pofb frontend/public/proofs/
cp fixtures/exit-deposits.json frontend/public/proofs/
[ -f fixtures/testnet-exit-deposits.json ] && cp fixtures/testnet-exit-deposits.json frontend/public/proofs/
cp fixtures/testnet-exit-first-attempt.json frontend/public/proofs/
node -e '
const fs = require("fs")
const read = (p) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : []
const all = [...read("fixtures/anchors.mainnet.json"), ...read("fixtures/anchors.testnet.json"), ...read("fixtures/anchors.demo.json")]
fs.writeFileSync("frontend/src/data/anchors.json", JSON.stringify(all, null, 2) + "\n")
fs.copyFileSync("fixtures/revocations.demo.json", "frontend/src/data/revocations.demo.json")
// single-use proofs for /demo when the attestor has no prover (pof-prove demo pool); server-only
if (fs.existsSync("fixtures/demo-pool.json")) fs.copyFileSync("fixtures/demo-pool.json", "frontend/src/data/demo-pool.json")
console.log(`anchors: ${all.length} records · proofs: ${fs.readdirSync("frontend/public/proofs").length}`)
'
