// Forwards a proof request to the demo holder inside pof-attest, which proves it against the
// demo ledger with the demo key. For visitors without ZEC; real holders run pof-prove locally.
// An attestor without the demo holder (Render's free tier) still serves /demo: its one request
// is answered from a pool of real single-use proofs made ahead of time (lib/server/demo-pool).
import { proxyToAttestor, readJson } from '@/lib/server/http'
import { attestorProves, poolServes, takeFromPool } from '@/lib/server/demo-pool'
import { clientKey, rateLimit } from '@/lib/server/store'

export const maxDuration = 60

type Body = { request?: { claim?: string; zatoshi?: string; audience?: string }; bindSolana?: string }

export async function POST(req: Request) {
  if (!(await attestorProves())) {
    const body = await readJson<Body>(req.clone())
    if (body instanceof Response) return body
    if (poolServes(body?.request, body?.bindSolana)) {
      if (await rateLimit(`prove:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: 'too many proofs in a minute; try again shortly' }, { status: 429 })
      const proof = await takeFromPool()
      if (proof) return Response.json(proof)
      return Response.json({ error: 'every pre-made demo proof has been used; run pof-prove demo pool for more' }, { status: 503 })
    }
  }
  return proxyToAttestor(req, {
    path: '/v1/demo/prove',
    limit: ['prove', 10],
    timeoutMs: 55_000,
    unconfigured: 'the demo holder is not configured on this deployment (POF_ATTEST_URL is unset)',
    slowDown: 'too many proofs in a minute; try again shortly',
    unreachable: 'demo holder unreachable',
  })
}
