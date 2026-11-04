// Thin proxy to pof-attest so the browser has one origin. No logic lives here.
// If POF_ATTEST_URL is unset, say so plainly; /demo then runs its SIMULATED path, labelled.
import { proxyToAttestor } from '@/lib/server/http'

export const maxDuration = 60

export function POST(req: Request) {
  return proxyToAttestor(req, {
    path: '/v1/attest',
    limit: ['attest', 30],
    timeoutMs: 10_000,
    unconfigured: 'attestor not configured (POF_ATTEST_URL is unset)',
    slowDown: 'slow down',
    unreachable: 'upstream unreachable',
  })
}
