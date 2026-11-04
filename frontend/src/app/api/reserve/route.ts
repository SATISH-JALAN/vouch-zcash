// The demo reserves feed on Solana: read it, publish a reserves batch to it (the attestor signs
// the batch verdict, the demo relayer submits it), and Secure-Mint the feed's demo wrapped ZEC,
// which pof-reserve allows only within the proven reserves and only while the feed is fresh.
import { PublicKey } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token'
import { connection, ed25519Ix, explain, explorer, keypairFrom, refusedByChain, send } from '@/lib/server/solana'
import { decodeFeed, feedMintPda, feedPda, publishIx, RESERVE_ID, RESERVES_AUDIENCE, secureMintIx } from '@/lib/server/reserve'
import { readJson } from '@/lib/server/http'
import { clientKey, durable, rateLimit, reserve } from '@/lib/server/store'
import { audienceHash } from '@/lib/pof/hash'
import { fromHex } from '@/lib/pof/bytes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = { action: 'publish'; batch: string } | { action: 'mint'; amount: string }

const HOUR = 3_600_000
const audience = () => Buffer.from(fromHex(audienceHash(RESERVES_AUDIENCE)))

function configured() {
  const { SOLANA_RPC_URL, RELAYER_SECRET_KEY } = process.env
  return Boolean(SOLANA_RPC_URL && RELAYER_SECRET_KEY) && (durable || !process.env.VERCEL)
}

export async function GET() {
  if (!process.env.SOLANA_RPC_URL) return Response.json({ configured: false })
  try {
    const conn = connection()
    const feed = feedPda(audience())
    const [acc, slot] = await Promise.all([conn.getAccountInfo(feed), conn.getSlot('confirmed')])
    if (!acc || !acc.owner.equals(RESERVE_ID)) return Response.json({ configured: false })
    const f = decodeFeed(acc.data)
    const supply = (await getMint(conn, new PublicKey(f.mint))).supply.toString()
    const stale = f.publishes === 0 || slot - f.updatedSlot > f.heartbeatSlots || f.expiresAt * 1000 <= Date.now()
    return Response.json({ configured: true, relayer: configured(), feed: f, supply, slot, stale, explorer: { feed: explorer('address', feed.toBase58()), mint: explorer('address', f.mint) } })
  } catch (err) {
    // The page reads this on every visit: an unreachable RPC means "not available", not a broken page.
    return Response.json({ configured: false, error: explain(err) })
  }
}

export async function POST(req: Request) {
  if (!configured()) return Response.json({ error: 'the reserves relayer is not configured on this deployment' }, { status: 503 })
  const client = clientKey(req)
  if (await rateLimit(`reserve:${client}`, 10, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  const body = await readJson<Body>(req)
  if (body instanceof Response) return body
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad request' }, { status: 400 })
  const budget = await reserve('reserve:all', 60, HOUR)
  if (!budget) return Response.json({ error: 'the demo relayer has spent its hourly budget; try again later' }, { status: 429 })

  let relayer
  try {
    relayer = keypairFrom(process.env.RELAYER_SECRET_KEY, 'RELAYER_SECRET_KEY')
  } catch (err) {
    console.error((err as Error).message)
    await budget()
    return Response.json({ error: 'the reserves relayer is misconfigured' }, { status: 503 })
  }
  const conn = connection()
  const aud = audience()
  try {
    if (body.action === 'publish') {
      if (typeof body.batch !== 'string' || body.batch.length > 1_500_000) {
        await budget()
        return Response.json({ error: 'publish needs a reserves batch (base64url)' }, { status: 400 })
      }
      const base = process.env.POF_ATTEST_URL
      if (!base) {
        await budget()
        return Response.json({ error: 'no attestor is configured to sign the batch' }, { status: 503 })
      }
      const r = await fetch(`${base.replace(/\/$/, '')}/v1/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ batch: body.batch, audience: RESERVES_AUDIENCE, attest: true }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null)
      const out = (await r?.json().catch(() => null)) as { attestation?: { message: string; signature: string; attestor: string }; verdict?: unknown; error?: string } | null
      if (!r || !out?.attestation) {
        await budget()
        return Response.json({ error: out?.error ?? 'the attestor refused the batch', verdict: out?.verdict ?? null }, { status: r?.ok === false ? 422 : 502 })
      }
      const a = out.attestation
      const message = Buffer.from(a.message, 'hex')
      const sig = await send(conn, [ed25519Ix(new PublicKey(a.attestor), message, Buffer.from(a.signature, 'hex')), publishIx(aud, message)], [relayer])
      return Response.json({ signature: sig, explorer: explorer('tx', sig) })
    }
    if (body.action === 'mint') {
      if (typeof body.amount !== 'string' || !/^[1-9][0-9]{0,15}$/.test(body.amount)) {
        await budget()
        return Response.json({ error: 'mint needs an amount in zatoshi' }, { status: 400 })
      }
      const mint = feedMintPda(feedPda(aud))
      const to = getAssociatedTokenAddressSync(mint, relayer.publicKey)
      const sig = await send(
        conn,
        [createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, to, relayer.publicKey, mint), secureMintIx(aud, to, relayer.publicKey, BigInt(body.amount))],
        [relayer],
      )
      return Response.json({ signature: sig, explorer: explorer('tx', sig) })
    }
    await budget()
    return Response.json({ error: 'unknown action' }, { status: 400 })
  } catch (err) {
    // a refusal by the program (over the reserves, a stale feed) cost nothing: give the unit back
    if (refusedByChain(err)) await budget()
    return Response.json({ error: explain(err) }, { status: refusedByChain(err) ? 422 : 502 })
  }
}
