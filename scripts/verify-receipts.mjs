// Every receipt vector through the site's own receipt checker (frontend/src/lib/vouch-receipt.ts),
// with the native verifier (pof-verify check --json) standing in for the browser's WASM one.
//
//   cargo build --release -p pof-verify --manifest-path backend/Cargo.toml
//   node --no-warnings scripts/verify-receipts.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const { checkReceipt } = await import(new URL('frontend/src/lib/vouch-receipt.ts', root))
const exe = fileURLToPath(new URL(`backend/target/release/pof-verify${process.platform === 'win32' ? '.exe' : ''}`, root))
if (!existsSync(exe)) throw new Error(`build the verifier first: ${exe}`)

const dir = mkdtempSync(join(tmpdir(), 'vouch-receipts-'))
const anchors = join(dir, 'anchors.json')
const table = ['mainnet', 'testnet', 'demo'].flatMap((n) => {
  const f = new URL(`fixtures/anchors.${n}.json`, root)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []
})
writeFileSync(anchors, JSON.stringify(table))

/** The WASM verifier's contract, served by the CLI. The CLI has no period flag, so the period is checked here. */
async function verify(bytes, audience, { policy, now }) {
  const file = join(dir, 'cert.pof')
  writeFileSync(file, bytes)
  const args = ['check', file, '--audience', audience, '--anchors', anchors, '--json', ...(now ? ['--now', String(now)] : [])]
  let out
  try {
    out = execFileSync(exe, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    out = e.stdout // a refused proof exits non-zero, with its JSON on stdout
  }
  const r = JSON.parse(out)
  if (r.verdict.kind === 'Valid' && policy.epoch !== undefined && r.envelope?.epoch !== policy.epoch) {
    r.verdict = { kind: 'WrongScope', epoch: r.envelope.epoch, required: policy.epoch }
  }
  return { ...r, revealed: r.revealed ?? [], elapsedMs: 0 }
}

const want = {
  'testnet-paid': 'Valid',
  'demo-paid': 'Valid',
  'testnet-wrong-order': 'WrongOrder',
  'demo-not-certified': 'NotPaidByCertifiedNotes',
}
let fail = 0
for (const [name, kind] of Object.entries(want)) {
  const receipt = JSON.parse(readFileSync(new URL(`fixtures/receipts/${name}.json`, root), 'utf8'))
  const r = await checkReceipt(receipt, verify)
  const ok = r.verdict.kind === kind
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} ${r.verdict.kind}${ok ? '' : ` (want ${kind})`}`)
  if (!ok) for (const c of r.checks) console.log(`       ${c.id.padEnd(12)} ${c.status.padEnd(8)} ${c.detail}`)
}
process.exit(fail ? 1 : 0)
