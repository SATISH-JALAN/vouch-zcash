// Client for the few things that need a server: the attestor (signs verdicts for Solana), the
// demo holder (proves on request, for visitors without ZEC), and the devnet relayer (pays for
// and sends demo transactions). /api/status says which are configured; every surface that
// uses them labels itself LIVE or SIMULATED from that answer, never from a guess.

import type { AttestOutcome, CreditLine, GateTransaction, ProofRequest, ServiceStatus, SubmitOutcome, Verdict } from './types.ts'

const TIMEOUT_MS = 12_000

async function post<T>(path: string, body: unknown, timeout = TIMEOUT_MS): Promise<{ status: number; body: T | null; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
  } catch (err) {
    const e = err as Error
    return { status: 0, body: null, error: e.name === 'TimeoutError' ? `no answer in ${timeout / 1000}s` : e.message }
  }
}

let statusCache: Promise<ServiceStatus> | null = null
export function serviceStatus(): Promise<ServiceStatus> {
  // A failed answer is not cached: the next caller asks again instead of staying SIMULATED.
  // /api/status waits at most 4 s on the attestor itself; this bounds the rest.
  statusCache ??= fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<ServiceStatus>
    })
    .catch(() => {
      statusCache = null
      return { attestor: { ok: false, message: 'status route unreachable' }, demoProver: false, demoPool: false, solana: null, durable: false }
    })
  return statusCache
}

const WAKE_MS = 90_000
const WAKE_POLL_MS = 5_000

/**
 * Like serviceStatus, but waits out an attestor that is waking (the hosted one sleeps when idle and
 * takes up to a minute to boot). Every ask is a request to it, which is what wakes it. onWaking hears
 * each waking answer; after WAKE_MS the last answer is returned as it is, and the page labels itself
 * from that.
 */
export async function serviceStatusAwake(onWaking?: (st: ServiceStatus) => void, signal?: AbortSignal): Promise<ServiceStatus> {
  const start = Date.now()
  for (;;) {
    const st = await serviceStatus()
    if (st.attestor.ok || !st.attestor.waking || signal?.aborted || Date.now() - start > WAKE_MS) return st
    onWaking?.(st)
    statusCache = null
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS))
  }
}

export async function attest(proofB64: string): Promise<AttestOutcome> {
  const r = await post<{ attestation?: AttestOutcome extends { ok: true; attestation: infer A } ? A : never; verdict?: Verdict; error?: string }>('/api/attest', { proof: proofB64 })
  if (r.status === 422 && r.body?.verdict) {
    return { ok: false, reason: 'refused', verdict: r.body.verdict, message: `The attestor ran pof-verify, got ${r.body.verdict.kind}, and refused to sign.` }
  }
  if (r.status !== 200 || !r.body?.attestation) {
    return { ok: false, reason: 'unreachable', message: `Attestor unreachable: ${r.error ?? `HTTP ${r.status}`}${r.body?.error ? ` — ${r.body.error}` : ''}.` }
  }
  return { ok: true, attestation: r.body.attestation }
}

export interface DemoProof {
  /** base64url .pof */
  proof: string
  /** The demo holder's revocation secret for this proof. Returned because the demo holder is us. */
  revocationSecret: string
  notesUsed: number
  provingMs: number
}

export async function demoProve(request: ProofRequest, bindSolana?: string): Promise<{ ok: true; proof: DemoProof } | { ok: false; message: string }> {
  const r = await post<DemoProof & { error?: string }>('/api/demo-prove', { request, bindSolana }, 60_000)
  if (r.status !== 200 || !r.body?.proof) return { ok: false, message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
  return { ok: true, proof: r.body }
}

export type RelayAction =
  | { action: 'submit'; attestation: { message: string; signature: string; attestor: string }; tamper?: boolean; wallet?: 'borrower' | 'stranger' }
  | { action: 'open-line'; receipt: string; wallet?: 'borrower' | 'stranger' }
  | { action: 'draw'; line: string }
  | { action: 'borrower' }

export async function relaySubmit(a: Extract<RelayAction, { action: 'submit' }>): Promise<SubmitOutcome> {
  const r = await post<{ tx?: GateTransaction; error?: string; failedAt?: string }>('/api/relay', a, 45_000)
  if (r.status === 200 && r.body?.tx) return { ok: true, tx: r.body.tx }
  return { ok: false, failedAt: r.body?.failedAt ?? 'relayer', message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
}

export async function relayOpenLine(a: Extract<RelayAction, { action: 'open-line' }>): Promise<{ ok: true; line: CreditLine } | { ok: false; message: string; failedAt: string }> {
  const r = await post<{ line?: CreditLine; error?: string; failedAt?: string }>('/api/relay', a, 45_000)
  if (r.status === 200 && r.body?.line) return { ok: true, line: r.body.line }
  return { ok: false, failedAt: r.body?.failedAt ?? 'relayer', message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
}

export async function relayDraw(a: Extract<RelayAction, { action: 'draw' }>): Promise<{ ok: true; amount: string; drawn: string; explorer?: string } | { ok: false; message: string; failedAt: string }> {
  const r = await post<{ amount?: string; drawn?: string; explorer?: string; error?: string; failedAt?: string }>('/api/relay', a, 45_000)
  if (r.status === 200 && r.body?.drawn && r.body.amount) return { ok: true, amount: r.body.amount, drawn: r.body.drawn, explorer: r.body.explorer }
  return { ok: false, failedAt: r.body?.failedAt ?? 'relayer', message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
}

export async function relayBorrower(): Promise<string | null> {
  const r = await post<{ borrower?: string }>('/api/relay', { action: 'borrower' })
  return r.body?.borrower ?? null
}
