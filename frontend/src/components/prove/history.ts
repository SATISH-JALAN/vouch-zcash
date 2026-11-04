'use client'

// The holder's proof history, kept only in this browser. The CLI keeps its own at
// ~/.vouch/history.json. A revocation secret stored here never leaves the browser until the
// holder presses Revoke.

export interface HistoryEntry {
  /** First 16 hex of the revocation tag. */
  id: string
  claim: string
  audience: string
  network: string
  anchorHeight: number
  createdAt: number
  expiresAt: number
  revocationTag: string
  revocationSecret?: string
  revokedAt?: number
  /** base64url .pof, so it can be handed over again. */
  proof: string
}

const KEY = 'vouch:history:v1'

export function readHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[]
  } catch {
    return []
  }
}

export function writeHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* private mode: history is a convenience, not a requirement */
  }
}

export function upsert(entry: HistoryEntry): HistoryEntry[] {
  const all = readHistory().filter((e) => e.id !== entry.id)
  const next = [entry, ...all].slice(0, 50)
  writeHistory(next)
  return next
}

export async function revoke(secret: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/revocations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret }), signal: AbortSignal.timeout(15_000) })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return res.ok ? { ok: true, message: 'Revoked. Any verifier that checks the list now refuses this proof.' } : { ok: false, message: body.error ?? `HTTP ${res.status}` }
  } catch (err) {
    const e = err as Error
    return { ok: false, message: e.name === 'TimeoutError' ? 'The revocation list did not answer in 15 s. Nothing is known to be revoked yet; try again.' : `Could not reach the revocation list: ${e.message}` }
  }
}

/** The published revocation secrets, or null when the list could not be read: an unreadable list
 *  must not pass for "nothing revoked" (the route answers 503 when its store is down). */
export async function revokedSecrets(): Promise<Set<string> | null> {
  try {
    const r = await fetch('/api/revocations', { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
    const body = (await r.json()) as { secrets?: unknown }
    if (!r.ok || !Array.isArray(body.secrets)) return null
    return new Set(body.secrets as string[])
  } catch {
    return null
  }
}
