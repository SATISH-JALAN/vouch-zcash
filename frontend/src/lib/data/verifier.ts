// The browser verifier: pof-verify compiled to WebAssembly (backend/crates/pof-wasm), built by
// scripts/build-wasm.sh into public/wasm. It runs in a module worker (public/wasm/worker.js), so
// loading the verifying key and checking a proof never freeze the page. Loaded lazily, never in
// the root layout. The anchor table and the revocation list are fetched here and passed in as
// data; the WASM itself never touches the network.

import type { AnchorRecord, BatchResult, Envelope, Policy, VerificationResult } from './types.ts'
import { fromBase64Url, fromHex } from '../pof/bytes.ts'

/** The verifier in its worker: loaded, warm, and answering. */
interface Verifier {
  version: string
  /** The result JSON, and how long the check itself took inside the worker. */
  verify: (bytes: Uint8Array, audience: string, nowSec: number, anchors: string, revoked: string, extra?: Extra) => Promise<{ json: string; ms: number }>
}

type Reply = { id: number; ok: true; version?: string; json?: string; ms?: number } | { id: number; ok: false; error: string }

/** JSON policy and reuse registry for the WASM call, and whether the bytes are a reserves batch. */
interface Extra {
  policy?: string
  seen?: string
  batch?: boolean
}

const WORKER_JS = '/wasm/worker.js'
/** ~4.5 MB of WASM: generous on a slow line, but never an endless spinner. */
const WASM_TIMEOUT_MS = 45_000
/** One check takes ~0.1 s (a few on a slow phone); a worker silent for this long is gone. */
const CHECK_TIMEOUT_MS = 30_000
const FETCH_TIMEOUT_MS = 12_000
let mod: Promise<Verifier> | null = null

/** Rejects after `ms` with a message a person can read. The work itself is not cancelled. */
function within<T>(p: Promise<T>, ms: number, what: string, verb = 'load'): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${what} did not ${verb} within ${ms / 1000}s`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(t))
}

/** fetch with a deadline; a timeout reads as one. */
async function fetchWithin(url: string, what: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (e) {
    const name = (e as Error).name
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `${what}: no answer in ${FETCH_TIMEOUT_MS / 1000}s` : `${what}: network error`)
  }
}

function startWorker(): Promise<Verifier> {
  const worker = new Worker(WORKER_JS, { type: 'module', name: 'pof-verify' })
  const waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  let next = 0
  const call = (msg: object) =>
    new Promise<Reply>((resolve, reject) => {
      const id = next++
      waiting.set(id, { resolve, reject })
      worker.postMessage({ id, ...msg })
    })
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    waiting.get(data.id)?.resolve(data)
    waiting.delete(data.id)
  }
  // A worker that fails to load, crashes, or goes silent is dropped whole: everything waiting on it
  // fails, it stops (no half-loaded worker left running beside a retry), and the next check starts
  // a fresh one.
  let dead = false
  const drop = (e: Error) => {
    if (dead) return
    dead = true
    for (const w of waiting.values()) w.reject(e)
    waiting.clear()
    worker.terminate()
    if (mod === me) mod = null
  }
  worker.onerror = (e) => {
    e.preventDefault()
    drop(new Error(e.message || 'the verifier worker stopped'))
  }
  const guard = <T,>(p: Promise<T>, ms: number, what: string, verb?: string) =>
    within(p, ms, what, verb).catch((e: Error) => {
      drop(e)
      throw e
    })
  const me: Promise<Verifier> = guard(call({}), WASM_TIMEOUT_MS, 'the verifier (WASM)').then((r) => {
    if (!r.ok) {
      const e = new Error(r.error)
      drop(e)
      throw e
    }
    return {
      version: r.version ?? 'pof-verify',
      verify: async (bytes, audience, now, anchors, revoked, extra = {}) => {
        if (dead) throw new Error('the verifier stopped; check again to restart it')
        const out = await guard(call({ bytes, audience, now, anchors, revoked, ...extra }), CHECK_TIMEOUT_MS, 'the verifier', 'answer')
        if (!out.ok) throw new Error(`the verifier failed: ${out.error}`)
        return { json: out.json!, ms: out.ms ?? 0 }
      },
    }
  })
  return me
}

/** The running verifier, started on first use; a failed one clears itself, so the next call retries. */
export function loadVerifier(): Promise<Verifier> {
  try {
    mod ??= startWorker()
  } catch (e) {
    // no module workers in this browser: say so rather than throw past the caller's .catch
    return Promise.reject(new Error(`this browser cannot run the verifier: ${(e as Error).message}`))
  }
  return mod
}

let anchors: Promise<AnchorRecord[]> | null = null
export function loadAnchors(): Promise<AnchorRecord[]> {
  anchors ??= fetchWithin('/api/anchors', 'anchor table')
    .then((r) => {
      if (!r.ok) throw new Error(`anchor table: HTTP ${r.status}`)
      return r.json() as Promise<AnchorRecord[]>
    })
    .catch((e: unknown) => {
      anchors = null
      throw e
    })
  return anchors
}

/** Fetched fresh each time: a revocation must take effect on the next check. */
export async function loadRevocations(): Promise<string[]> {
  const r = await fetchWithin('/api/revocations', 'revocation list', { cache: 'no-store' })
  const body = (await r.json().catch(() => null)) as { secrets?: unknown; error?: string } | null
  if (!r.ok) throw new Error(`revocation list: ${body?.error ?? `HTTP ${r.status}`}`)
  if (!Array.isArray(body?.secrets)) throw new Error('revocation list: unreadable answer')
  return body.secrets as string[]
}

type RawEnvelope = Omit<Envelope, 'evidence'> & { evidence: Omit<Envelope['evidence'], 'proof'> & { proof: string } }
type RawResult = Omit<VerificationResult, 'envelope' | 'elapsedMs'> & { envelope: RawEnvelope | null }

export function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input !== 'string') return input
  return fromBase64Url(input) ?? new TextEncoder().encode(input)
}

/**
 * `count` adds the verdict to the public /api/stats counter: for checks a person asked for, not the
 * site's own. `policy` is what this verifier additionally requires (freshness, "unmoved since").
 */
export async function verify(
  input: string | Uint8Array,
  audience: string,
  { count = false, policy, seen }: { count?: boolean; policy?: Policy; seen?: string[] } = {},
): Promise<VerificationResult> {
  const [wasm, table, revoked] = await Promise.all([loadVerifier(), loadAnchors(), loadRevocations()])
  const bytes = toBytes(input)
  const now = Math.floor(Date.now() / 1000)
  const { json, ms: elapsedMs } = await wasm.verify(bytes, audience, now, JSON.stringify(table), JSON.stringify(revoked), extra(policy, seen))
  const raw = JSON.parse(json) as RawResult
  if (count) void recordVerdict(raw.verdict.kind)
  return withProof(raw, elapsedMs)
}

/** A reserves batch (.pofb): every member checked, one scope and anchor, no note twice, summed. */
export async function verifyBatch(bytes: Uint8Array, audience: string, { policy, seen }: { policy?: Policy; seen?: string[] } = {}): Promise<BatchResult> {
  const [wasm, table, revoked] = await Promise.all([loadVerifier(), loadAnchors(), loadRevocations()])
  const now = Math.floor(Date.now() / 1000)
  const { json, ms: elapsedMs } = await wasm.verify(bytes, audience, now, JSON.stringify(table), JSON.stringify(revoked), { ...extra(policy, seen), batch: true })
  const raw = JSON.parse(json) as Omit<BatchResult, 'members' | 'elapsedMs'> & { members: RawResult[] }
  return { ...raw, elapsedMs, members: raw.members.map((m) => withProof(m, 0)) }
}

/** True for the POFB magic: a reserves batch rather than one proof. */
export const isBatch = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x42

function extra(policy?: Policy, seen?: string[]): Extra {
  return {
    policy: policy && Object.values(policy).some((v) => v !== undefined) ? JSON.stringify(policy) : undefined,
    seen: seen?.length ? JSON.stringify(seen) : undefined,
  }
}

function withProof(raw: RawResult, elapsedMs: number): VerificationResult {
  return {
    ...raw,
    elapsedMs,
    envelope: raw.envelope ? { ...raw.envelope, evidence: { ...raw.envelope.evidence, proof: fromHex(raw.envelope.evidence.proof) } } : null,
  }
}

/** Increment-only public counter: verdict kind only, never bytes, never who. */
async function recordVerdict(kind: string) {
  try {
    await fetch('/api/stats', { method: 'POST', body: JSON.stringify({ kind }), keepalive: true })
  } catch {
    /* counting is best-effort */
  }
}

export async function fetchPreset(file: string): Promise<Uint8Array> {
  const r = await fetchWithin(`/proofs/${file}`, `test vector ${file}`)
  if (!r.ok) throw new Error(`test vector ${file}: HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
