// What this deployment has configured. /demo and /prove label themselves LIVE or SIMULATED
// from this answer. Nothing secret is returned.
import type { ServiceStatus } from '@/lib/data/types'
import { attestorUrl, upstreamFailure } from '@/lib/server/http'
import { CREDIT_ID, GATE_ID } from '@/lib/server/solana'
import { poolLeft } from '@/lib/server/demo-pool'
import { durable } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const upstream = attestorUrl()
  let attestor: ServiceStatus['attestor'] = { ok: false, message: 'attestor not configured (POF_ATTEST_URL is unset)' }
  let demoProver = false
  if (upstream) {
    try {
      const res = await fetch(`${upstream}/v1/pubkey`, { signal: AbortSignal.timeout(4_000), cache: 'no-store' })
      if (res.ok) {
        const body = (await res.json()) as { pubkey?: string; demoProver?: boolean }
        attestor = { ok: true, pubkey: body.pubkey }
        demoProver = Boolean(body.demoProver)
      } else {
        // a host that is starting up answers 502–504 before the attestor is listening
        attestor = { ok: false, message: `attestor answered HTTP ${res.status}`, waking: res.status >= 502 && res.status <= 504 }
      }
    } catch (err) {
      // a sleeping free instance holds the request while it boots; this request is what wakes it
      attestor = { ok: false, message: `attestor unreachable: ${upstreamFailure(err)}`, waking: true }
    }
  }
  const { SOLANA_RPC_URL, POF_POOL, RELAYER_SECRET_KEY, BORROWER_SECRET_KEY } = process.env
  const solana =
    // the same rule as /api/relay: no relayer on serverless without the shared store
    SOLANA_RPC_URL && POF_POOL && RELAYER_SECRET_KEY && BORROWER_SECRET_KEY && (durable || !process.env.VERCEL)
      ? { cluster: process.env.SOLANA_CLUSTER ?? 'devnet', gate: GATE_ID.toBase58(), credit: CREDIT_ID.toBase58(), pool: POF_POOL }
      : null
  const demoPool = !demoProver && attestor.ok && solana !== null && (await poolLeft().catch(() => 0)) > 0
  const status: ServiceStatus = { attestor, demoProver, demoPool, solana, durable }
  return Response.json(status, { headers: { 'cache-control': 'no-store' } })
}
