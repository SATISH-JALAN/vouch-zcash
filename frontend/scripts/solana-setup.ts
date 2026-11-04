// One-time setup on a cluster (devnet, or a local test validator): pof-gate's attestor
// allowlist, a demo USDC mint, the pof-credit pool that asks for ≥ 500 ZEC, and a funded vault.
// Idempotent: anything that already exists is reused, and an existing pool must have exactly these
// terms. The mint's keypair is kept (gitignored) so every rerun, on any cluster, finds the same mint
// and pool. The first run must be by pof-gate's upgrade authority (the deployer): only it can
// initialize. Prints the env lines the site needs.
//
//   SOLANA_RPC_URL=… ADMIN_KEYPAIR=~/.config/solana/id.json ATTESTORS=<b58,…> [THRESHOLD=1] \
//   [MINT=<b58> | MINT_KEYPAIR=<path, default backend/solana/keys/mint.json>] node --no-warnings scripts/solana-setup.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createMint, getAccount, getMint, mintTo } from '@solana/spl-token'
import { blake2b } from '../src/lib/pof/blake2b.ts'
import { utf8 } from '../src/lib/pof/bytes.ts'
import { configPda, connection, decodePool, initializeIx, initPoolIx, poolPda, send, setAttestorsIx, vaultPda } from '../src/lib/server/solana.ts'

const expand = (p: string) => p.replace(/^~(?=$|[\/])/, os.homedir())
const readKeypair = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8')) as number[]))
const admin = readKeypair(expand(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json'))
const attestors = (process.env.ATTESTORS ?? '').split(',').filter(Boolean).map((k) => new PublicKey(k.trim()))
if (!attestors.length) throw new Error('ATTESTORS is required (comma-separated base58 attestor pubkeys)')
const threshold = Number(process.env.THRESHOLD ?? 1)
const maxAge = Number(process.env.MAX_AGE_SLOTS ?? 300)
const conn = connection()

console.error(`admin ${admin.publicKey.toBase58()} · ${(await conn.getBalance(admin.publicKey)) / 1e9} SOL`)

if (await conn.getAccountInfo(configPda())) {
  await send(conn, [setAttestorsIx(admin.publicKey, attestors, threshold, maxAge)], [admin])
  console.error(`pof-gate config updated: ${attestors.length} attestor(s), threshold ${threshold}`)
} else {
  await send(conn, [initializeIx(admin.publicKey, attestors, threshold, maxAge)], [admin])
  console.error(`pof-gate initialised: ${attestors.length} attestor(s), threshold ${threshold}`)
}

const mint = process.env.MINT ? new PublicKey(process.env.MINT) : await keptMint()
if (!(await getMint(conn, mint)).mintAuthority?.equals(admin.publicKey)) throw new Error(`the admin is not the mint authority of ${mint.toBase58()}`)

const audience = Buffer.from(blake2b(utf8('pof-audience:pof-credit:usdc-pool-1')))
const [required, lineLimit] = [50_000_000_000n, 25_000_000_000n]
const pool = poolPda(mint)
const existing = await conn.getAccountInfo(pool)
if (!existing) {
  await send(conn, [initPoolIx(admin.publicKey, mint, audience, required, lineLimit)], [admin])
  console.error('pof-credit pool created: ≥ 500 ZEC → 25,000 dUSDC lines')
} else {
  // never fund a pool on terms other than these
  const p = decodePool(existing.data)
  if (!p.authority.equals(admin.publicKey) || !p.audience.equals(audience) || p.requiredZatoshi !== required || p.lineLimit !== lineLimit) {
    throw new Error(`pool ${pool.toBase58()} exists with another authority or other terms; refusing to fund it`)
  }
}
const vault = vaultPda(pool)
const balance = (await getAccount(conn, vault)).amount
if (balance < 1_000_000_000_000n) {
  await mintTo(conn, admin, mint, vault, admin, 10_000_000_000_000n)
  console.error('vault funded with 10,000,000 dUSDC')
}

console.log(`POF_POOL=${pool.toBase58()}`)
console.log(`POF_MINT=${mint.toBase58()}`)

/** The dUSDC mint lives at a kept keypair's address: created on first use, reused after. */
async function keptMint() {
  const path = expand(process.env.MINT_KEYPAIR ?? fileURLToPath(new URL('../../backend/solana/keys/mint.json', import.meta.url)))
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600, flag: 'wx' })
  const kp = readKeypair(path)
  if (await conn.getAccountInfo(kp.publicKey)) return kp.publicKey
  console.error(`creating the dUSDC mint ${kp.publicKey.toBase58()}`)
  return createMint(conn, admin, admin.publicKey, null, 6, kp)
}
