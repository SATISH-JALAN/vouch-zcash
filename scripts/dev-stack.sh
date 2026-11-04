#!/usr/bin/env bash
# The whole stack on one machine (Linux, macOS or WSL): a Solana test validator with pof-gate and
# pof-credit preloaded, the attestor + demo holder, and the site in LIVE mode. Ctrl-C stops all of it.
#
#   ./scripts/dev-stack.sh            # then open http://localhost:3000/demo
#   SITE=http://localhost:3000 node scripts/e2e.mjs    # in another shell: the full end-to-end check
#
# Needs: solana CLI (solana-test-validator, solana-keygen), cargo, node 22.18+ (runs .ts directly), pnpm.
# The SBF programs must be built once: (cd backend/solana && anchor build).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
RUN=$ROOT/backend/target/dev-stack
KEYS=$ROOT/backend/solana/keys
DEPLOY=$ROOT/backend/solana/target/deploy
RPC=http://127.0.0.1:8899
GATE_ID=A6WmRTgEAHC9GHstaj9oD8woVNRw9jgu31bpKVREXn8C
CREDIT_ID=J6ewFZAzcTkbVsYNBrcZvzdBtTTUK5UrpqCg9jiNyra1
mkdir -p "$RUN" "$KEYS"

for so in pof_gate pof_credit; do
  [ -f "$DEPLOY/$so.so" ] || { echo "missing $DEPLOY/$so.so: run (cd backend/solana && anchor build)"; exit 1; }
done

# Demo wallets and a stable attestor key (all gitignored, never real funds)
for k in admin relayer borrower stranger; do
  [ -f "$KEYS/$k.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/$k.json"
done
[ -f "$KEYS/attestor.hex" ] || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > "$KEYS/attestor.hex"

pids=()
cleanup() { echo; echo "stopping…"; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

wait_for() { # url, name
  for _ in $(seq 1 180); do curl -sf -o /dev/null "$1" -X "${3:-GET}" ${4:+-H 'content-type: application/json' -d "$4"} && return 0; sleep 1; done
  echo "$2 did not come up (logs in $RUN)"; exit 1
}

echo "· validator (logs: $RUN/validator.log)"
solana-test-validator --reset --quiet --ledger "$RUN/ledger" --bind-address 127.0.0.1 --rpc-port 8899 \
  --upgradeable-program "$GATE_ID" "$DEPLOY/pof_gate.so" "$KEYS/admin.json" \
  --bpf-program "$CREDIT_ID" "$DEPLOY/pof_credit.so" > "$RUN/validator.log" 2>&1 &
pids+=($!)
wait_for $RPC validator POST '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
for k in admin relayer borrower stranger; do solana airdrop 10 "$(solana-keygen pubkey "$KEYS/$k.json")" --url $RPC >/dev/null; done

echo "· attestor + demo holder (logs: $RUN/attest.log) — the first build takes a few minutes"
(cd backend && cargo build --release -p pof-attest -q)
POF_ATTEST_KEY=$(cat "$KEYS/attestor.hex") \
POF_ANCHORS=$ROOT/frontend/src/data/anchors.json \
POF_DEMO_WORLD=$ROOT/fixtures/demo-world.json \
POF_REVOCATIONS_URL=http://127.0.0.1:3000/api/revocations \
SOLANA_RPC_URL=$RPC \
  "$ROOT/backend/target/release/pof-attest" > "$RUN/attest.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:8787/health attestor
ATTESTOR=$(curl -s http://127.0.0.1:8787/v1/pubkey | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pubkey))')

echo "· pof-gate allowlist, dUSDC mint and the credit pool"
cd frontend
[ -d node_modules ] || pnpm install --frozen-lockfile
# a plain assignment keeps set -e: inside `eval "$(…)"` the setup's exit status would be lost
setup=$(SOLANA_RPC_URL=$RPC ADMIN_KEYPAIR=$KEYS/admin.json ATTESTORS=$ATTESTOR node --no-warnings scripts/solana-setup.ts)
eval "$setup"
[ -n "${POF_POOL:-}" ] || { echo "solana-setup printed no POF_POOL:"; echo "$setup"; exit 1; }

echo "· site on http://localhost:3000 (LIVE mode)"
export POF_ATTEST_URL=http://127.0.0.1:8787 SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=localnet POF_POOL
export RELAYER_SECRET_KEY=$(cat "$KEYS/relayer.json") BORROWER_SECRET_KEY=$(cat "$KEYS/borrower.json") STRANGER_SECRET_KEY=$(cat "$KEYS/stranger.json")
pnpm dev &
pids+=($!)
wait "${pids[@]}"
