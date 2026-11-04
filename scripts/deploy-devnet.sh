#!/usr/bin/env bash
# Deploy pof-gate, pof-credit and pof-reserve to Solana devnet under their fixed program ids, then allowlist the
# attestor, create the dUSDC mint and the ≥ 500 ZEC credit pool, the demo reserves feed (issuer: the
# relayer), and fund the demo relayer.
# Prints the site's public environment, and writes the whole of it, demo keypairs included, to
# backend/solana/keys/vercel.env (owner-only, gitignored): secret keys are never printed.
#
#   POF_ATTEST_URL=https://<attestor> [ATTESTORS=<attestor pubkey b58>[,…]] ./scripts/deploy-devnet.sh
#
# ATTESTORS defaults to GET $POF_ATTEST_URL/v1/pubkey. The deployer is backend/solana/keys/admin.json:
# it becomes the programs' upgrade authority, the only key that can initialize pof-gate, and needs
# ~7 devnet SOL (three programs ≈ 5.1 SOL of rent, plus setup): https://faucet.solana.com
# Safe to rerun: the programs are rebuilt and upgraded in place, and setup reuses the kept dUSDC mint
# (keys/mint.json) and its pool.
# Needs: solana CLI, anchor, node 22.6+ (runs .ts directly; the flag below covers 22.6–22.17), pnpm, curl.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
KEYS=$ROOT/backend/solana/keys
DEPLOY=$ROOT/backend/solana/target/deploy
URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}
ADMIN=$KEYS/admin.json
: "${POF_ATTEST_URL:?set POF_ATTEST_URL to the public URL of the attestor (the site needs it too)}"
POF_ATTEST_URL=${POF_ATTEST_URL%/}
if [ -z "${ATTESTORS:-}" ]; then
  ATTESTORS=$(curl -sf "$POF_ATTEST_URL/v1/pubkey" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).pubkey))') \
    || { echo "could not read the attestor pubkey from $POF_ATTEST_URL/v1/pubkey; set ATTESTORS"; exit 1; }
fi

[ -f "$ADMIN" ] || { echo "missing $ADMIN (the deployer and pof-gate admin)"; exit 1; }
for p in pof_gate pof_credit pof_reserve; do
  [ -f "$KEYS/program-$p.json" ] || { echo "missing $KEYS/program-$p.json (the program id keypair)"; exit 1; }
done
# Always rebuild, so a stale .so or IDL is never deployed; the site encodes from the IDLs.
mkdir -p "$DEPLOY"
cp "$KEYS/program-pof_gate.json" "$DEPLOY/pof_gate-keypair.json"
cp "$KEYS/program-pof_credit.json" "$DEPLOY/pof_credit-keypair.json"
cp "$KEYS/program-pof_reserve.json" "$DEPLOY/pof_reserve-keypair.json"
(cd backend/solana && anchor build)
cp backend/solana/target/idl/pof_gate.json backend/solana/target/idl/pof_credit.json backend/solana/target/idl/pof_reserve.json frontend/src/data/idl/

echo "deployer $(solana-keygen pubkey "$ADMIN") · $(solana balance "$(solana-keygen pubkey "$ADMIN")" --url "$URL")"
for p in pof_gate pof_credit pof_reserve; do
  echo "· deploying $p → $(solana-keygen pubkey "$KEYS/program-$p.json")"
  solana program deploy "$DEPLOY/$p.so" --program-id "$KEYS/program-$p.json" \
    --keypair "$ADMIN" --upgrade-authority "$ADMIN" --url "$URL" --with-compute-unit-price 10000
done

for k in relayer borrower stranger; do
  [ -f "$KEYS/$k.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/$k.json"
done
echo "· funding the relayer (pays fees for the demo's transactions)"
solana transfer "$(solana-keygen pubkey "$KEYS/relayer.json")" 0.5 --allow-unfunded-recipient \
  --keypair "$ADMIN" --url "$URL" >/dev/null

echo "· pof-gate allowlist, dUSDC mint and the credit pool"
cd frontend
[ -d node_modules ] || pnpm install --frozen-lockfile
OUT=$(SOLANA_RPC_URL=$URL ADMIN_KEYPAIR=$ADMIN ATTESTORS=$ATTESTORS MINT_KEYPAIR=$KEYS/mint.json node --experimental-strip-types --no-warnings scripts/solana-setup.ts)
echo "· pof-reserve allowlist and the demo reserves feed"
OUT="$OUT
$(SOLANA_RPC_URL=$URL ADMIN_KEYPAIR=$ADMIN ATTESTORS=$ATTESTORS ISSUER=$(solana-keygen pubkey "$KEYS/relayer.json") node --experimental-strip-types --no-warnings scripts/reserve-setup.ts)"

# The public env goes to stdout. The three demo keypairs are secrets: they go only into a file under
# the gitignored keys/, owner-only, and are never printed (terminal scrollback and CI logs are kept).
PUBLIC_ENV="SOLANA_RPC_URL=$URL
SOLANA_CLUSTER=devnet
POF_ATTEST_URL=$POF_ATTEST_URL
$OUT"
ENV_FILE=$KEYS/vercel.env
(
  umask 077
  rm -f "$ENV_FILE"
  {
    echo "# Vouch site environment for Vercel, written by scripts/deploy-devnet.sh. Contains secret keys: never commit or share."
    echo "$PUBLIC_ENV"
    printf 'RELAYER_SECRET_KEY=%s\n' "$(tr -d ' \r\n' < "$KEYS/relayer.json")"
    printf 'BORROWER_SECRET_KEY=%s\n' "$(tr -d ' \r\n' < "$KEYS/borrower.json")"
    printf 'STRANGER_SECRET_KEY=%s\n' "$(tr -d ' \r\n' < "$KEYS/stranger.json")"
  } > "$ENV_FILE"
)
chmod 600 "$ENV_FILE"

cat <<EOF

Done. Site environment (Vercel → Settings → Environment Variables):

$PUBLIC_ENV

plus RELAYER_SECRET_KEY, BORROWER_SECRET_KEY and STRANGER_SECRET_KEY, which are not printed.
The complete env, secrets included, is in $ENV_FILE (owner-only, gitignored):
Vercel's environment-variable form accepts the file's contents pasted in one go.

And on the attestor: SOLANA_RPC_URL=$URL
EOF
