// The revocation list is a hash lock, not a signed list: a proof's tag is
// blake2b("vouch-revoke-v1", secret)[..16], and the holder revokes by publishing `secret`.
// Only the holder knows it, so this server can lose or delay entries but cannot forge one.
import demo from '@/data/revocations.demo.json'
import { readJson } from '@/lib/server/http'
import { clientKey, durable, rateLimit, reserve, setAdd, setHas, setMembers, setSize } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

// Anyone may publish, so the list is bounded: every verifier downloads all of it.
const MAX_SECRETS = 50_000
// A holder revokes a handful of proofs. Once the list is full no real holder can revoke, and at
// 20 a minute alone one client could fill it in under two days.
const PER_CLIENT_PER_DAY = 50
const DAY = 86_400_000
const ALL_PER_HOUR = 300
const HOUR = 3_600_000

const unavailable = () => Response.json({ error: 'the revocation store is unavailable; try again shortly' }, { status: 503, headers: { 'cache-control': 'no-store' } })

export async function GET() {
  let published: string[]
  try {
    published = await setMembers('revocations')
  } catch (err) {
    // Fail closed, with a reason: "could not read the list" must never look like "nothing revoked".
    console.error('revocations: store read failed:', (err as Error).name)
    return unavailable()
  }
  const secrets = [...new Set([...demo.secrets, ...published])]
  return Response.json({ secrets, durable }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: Request) {
  // On serverless the file fallback is one instance's /tmp: a 201 there would be a lie.
  if (process.env.VERCEL && !durable) return Response.json({ error: 'revocation store not configured' }, { status: 503 })
  const client = clientKey(req)
  if (await rateLimit(`revoke:${client}`, 20, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  const body = await readJson<{ secret?: unknown }>(req)
  if (body instanceof Response) return body
  const secret = typeof body?.secret === 'string' ? body.secret.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(secret)) return Response.json({ error: 'secret must be 32 bytes of hex' }, { status: 400 })
  try {
    // already listed: nothing to add, and nothing counted against anyone
    if (await setHas('revocations', secret)) return Response.json({ ok: true, added: false }, { status: 200 })
    if ((await setSize('revocations')) >= MAX_SECRETS) return Response.json({ error: 'revocation list is full' }, { status: 503 })
    // Allowances are taken only for well-formed new secrets, and handed back when nothing is added,
    // so a typo, a retry or a refusal never uses up a holder's day. One for everyone together, so
    // rotating addresses cannot fill the list quickly either: at this rate filling it takes about a
    // week, and a burst delays revocations by an hour at most.
    const all = await reserve('revoke-all', ALL_PER_HOUR, HOUR)
    if (!all) return Response.json({ error: 'the revocation list is taking unusually many new entries; try again within the hour' }, { status: 429 })
    const mine = await reserve(`revoke-day:${client}`, PER_CLIENT_PER_DAY, DAY)
    if (!mine) {
      await all()
      return Response.json({ error: 'too many revocations from this address today' }, { status: 429 })
    }
    const added = await setAdd('revocations', secret).catch(async (e: unknown) => {
      await Promise.all([all(), mine()])
      throw e
    })
    if (!added) await Promise.all([all(), mine()]) // someone listed it a moment ago
    return Response.json({ ok: true, added }, { status: added ? 201 : 200 })
  } catch (err) {
    console.error('revocations: store write failed:', (err as Error).name)
    return unavailable()
  }
}
