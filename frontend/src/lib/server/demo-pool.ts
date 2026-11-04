// The demo holder without a proving server. Render's free instance has 0.1 CPU, where one proof
// takes about two minutes, so the attestor there runs without its demo holder. In its place:
// real proofs made ahead of time by `pof-prove demo pool` (≥ 500 ZEC for the demo credit pool,
// bound to the demo borrower, each with its own proof id). A proof opens one receipt, so each
// is handed out once: claimed in the store, and skipped when its receipt is already on chain
// (a local run against the same devnet, or a store that was reset).
import pool from '@/data/demo-pool.json'
import type { DemoProof } from '@/lib/data/services'
import { DEMO_AUDIENCE, DEMO_THRESHOLD_ZAT } from '@/lib/data/chain'
import { attestorUrl } from '@/lib/server/http'
import { connection, receiptPda } from '@/lib/server/solana'
import { setAdd, setMembers } from '@/lib/server/store'

type Pooled = { subject: string; proof: string; revocationSecret: string; notesUsed?: number }
const POOL = pool as { borrower: string; proofs: Pooled[] }
const USED = 'demo-pool:used'

/** The one request the pool can answer: the /demo credit pool's, for the demo borrower. */
export function poolServes(request: { claim?: string; zatoshi?: string | number; audience?: string } | undefined, bindSolana: string | undefined) {
  return (
    POOL.proofs.length > 0 &&
    bindSolana === POOL.borrower &&
    request?.claim === 'HoldsAtLeast' &&
    String(request.zatoshi) === String(DEMO_THRESHOLD_ZAT) &&
    request.audience === DEMO_AUDIENCE.id
  )
}

let prover: { at: number; on: boolean } | null = null
/** Whether the attestor proves on request (asked once a minute). */
export async function attestorProves(): Promise<boolean> {
  if (prover && Date.now() - prover.at < 60_000) return prover.on
  let on = false
  const upstream = attestorUrl()
  if (upstream) {
    try {
      const res = await fetch(`${upstream}/v1/pubkey`, { signal: AbortSignal.timeout(4_000), cache: 'no-store' })
      on = res.ok && Boolean(((await res.json()) as { demoProver?: boolean }).demoProver)
    } catch {
      return false // unreachable: don't remember it, the next call asks again
    }
  }
  prover = { at: Date.now(), on }
  return on
}

/** The next unused pooled proof, or null when every one has been handed out. */
export async function takeFromPool(): Promise<DemoProof | null> {
  const used = new Set(await setMembers(USED))
  const fresh = POOL.proofs.filter((p) => !used.has(p.subject))
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100)
    let onChain: unknown[] = []
    try {
      onChain = await connection().getMultipleAccountsInfo(chunk.map((p) => receiptPda(Buffer.from(p.subject, 'hex'))))
    } catch {
      // RPC down: the store alone decides; a used proof is refused by pof-gate, not misused
    }
    for (const [j, p] of chunk.entries()) {
      const claimed = await setAdd(USED, p.subject)
      if (claimed && !onChain[j]) return { proof: p.proof, revocationSecret: p.revocationSecret, notesUsed: p.notesUsed ?? 1, provingMs: 0 }
    }
  }
  return null
}

export const poolLeft = async () => POOL.proofs.length - (await setMembers(USED)).length
