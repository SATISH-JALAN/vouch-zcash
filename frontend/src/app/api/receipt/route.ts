// Thin proxy to pof-attest's receipt check, which re-reads the payment from lightwalletd. No logic
// lives here; the browser runs the same rules itself and uses this only for the chain read.
import { proxyToAttestor } from '@/lib/server/http'

export const maxDuration = 60

export function POST(req: Request) {
  return proxyToAttestor(req, {
    path: '/v1/receipts/verify',
    limit: ['receipt', 20],
    timeoutMs: 30_000,
    unconfigured: 'attestor not configured (POF_ATTEST_URL is unset)',
    slowDown: 'slow down',
    unreachable: 'upstream unreachable',
  })
}
