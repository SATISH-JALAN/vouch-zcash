// One-time setup of pof-reserve on a cluster: the attestor allowlist and the demo reserves feed
// (audience "reserves:wzec-demo", with its own demo wrapped-ZEC mint). The feed's issuer — the
// only key that may Secure-Mint — is the demo relayer, so the site can mint within the proven
// reserves. Idempotent. The first run must be by pof-reserve's upgrade authority (the deployer).
//
//   SOLANA_RPC_URL=… ADMIN_KEYPAIR=… ATTESTORS=<b58,…> ISSUER=<relayer b58> [HEARTBEAT_SLOTS=9000] \
//   node --no-warnings scripts/reserve-setup.ts
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { Keypair, PublicKey } from '@solana/web3.js'
import { blake2b } from '../src/lib/pof/blake2b.ts'
import { utf8 } from '../src/lib/pof/bytes.ts'
import { connection, send } from '../src/lib/server/solana.ts'
import { decodeFeed, feedMintPda, feedPda, initFeedIx, RESERVES_AUDIENCE, reserveConfigPda, reserveInitializeIx } from '../src/lib/server/reserve.ts'

const expand = (p: string) => p.replace(/^~(?=$|[\/])/, os.homedir())
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expand(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json'), 'utf8')) as number[]))
const attestors = (process.env.ATTESTORS ?? '').split(',').filter(Boolean).map((k) => new PublicKey(k.trim()))
if (!attestors.length) throw new Error('ATTESTORS is required (comma-separated base58 attestor pubkeys)')
if (!process.env.ISSUER) throw new Error('ISSUER is required (the demo relayer, base58): it is the only key that may mint')
const issuer = new PublicKey(process.env.ISSUER)
const heartbeat = Number(process.env.HEARTBEAT_SLOTS ?? 9_000) // ~1 hour of devnet slots
const conn = connection()

if (!(await conn.getAccountInfo(reserveConfigPda()))) {
  await send(conn, [reserveInitializeIx(admin.publicKey, attestors, Number(process.env.THRESHOLD ?? 1), Number(process.env.MAX_AGE_SLOTS ?? 300))], [admin])
  console.error(`pof-reserve initialised: ${attestors.length} attestor(s)`)
} else {
  console.error('pof-reserve config exists (change attestors with set_attestors if needed)')
}

const audience = Buffer.from(blake2b(utf8(`pof-audience:${RESERVES_AUDIENCE}`)))
const feed = feedPda(audience)
const existing = await conn.getAccountInfo(feed)
if (!existing) {
  await send(conn, [initFeedIx(admin.publicKey, audience, heartbeat, issuer)], [admin])
  console.error(`reserves feed created for ${RESERVES_AUDIENCE}, heartbeat ${heartbeat} slots`)
} else if (decodeFeed(existing.data).issuer !== issuer.toBase58()) {
  throw new Error(`feed ${feed.toBase58()} exists with another issuer; refusing to use it`)
}

console.log(`POF_RESERVE_FEED=${feed.toBase58()}`)
console.log(`POF_RESERVE_MINT=${feedMintPda(feed).toBase58()}`)
