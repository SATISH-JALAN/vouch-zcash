// An increment-only count of verifications by verdict kind. Never proof bytes, never who.
import { readJson } from '@/lib/server/http'
import { clientKey, counters, incr, rateLimit } from '@/lib/server/store'

export const dynamic = 'force-dynamic'
const KINDS = new Set(['Valid', 'Expired', 'Revoked', 'WrongAudience', 'AnchorNotFound', 'AnchorTooOld', 'NotDormantLongEnough', 'WrongScope', 'AlreadyUsed', 'ProofInvalid', 'Malformed'])

export async function GET() {
  try {
    const c = await counters('verdicts')
    const total = Object.values(c).reduce((a, b) => a + b, 0)
    return Response.json({ total, byVerdict: c }, { headers: { 'cache-control': 'public, max-age=30' } })
  } catch (err) {
    console.error('stats: store read failed:', (err as Error).name)
    return Response.json({ error: 'the counter store is unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}

export async function POST(req: Request) {
  if (await rateLimit(`stats:${clientKey(req)}`, 60, 60_000)) return new Response(null, { status: 204 })
  const body = await readJson<{ kind?: string }>(req)
  if (body instanceof Response) return body
  try {
    if (body?.kind && KINDS.has(body.kind)) await incr('verdicts', body.kind)
  } catch (err) {
    // counting is best-effort; the verdict the visitor saw does not depend on it
    console.error('stats: store write failed:', (err as Error).name)
  }
  return new Response(null, { status: 204 })
}
