import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Two tiny shared lists: published revocation secrets and verdict counters, plus the rate
// limit windows. With Upstash Redis (or Vercel KV) configured they are durable and shared
// across instances; without it they live in a JSON file in the OS temp dir and in memory —
// fine for one server, and /api/status reports which (`durable`).

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const durable = Boolean(URL_ && TOKEN)

async function redis<T>(...cmd: (string | number)[]): Promise<T> {
  const res = await fetch(URL_!, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
  })
  if (!res.ok) throw new Error(`kv: HTTP ${res.status}`)
  return ((await res.json()) as { result: T }).result
}

const FILE = path.join(os.tmpdir(), 'vouch-store.json')
type FileState = { sets: Record<string, string[]>; counters: Record<string, Record<string, number>> }

// Only a missing file is an empty store. Anything else (a parse error included) is thrown:
// treating it as empty would let the next write replace every revocation with nothing.
async function readFile(): Promise<FileState> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as FileState
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { sets: {}, counters: {} }
    throw err
  }
}
let chain: Promise<unknown> = Promise.resolve()
function mutate(f: (s: FileState) => void) {
  const next = chain.then(async () => {
    const s = await readFile()
    f(s)
    // Write aside and rename over: readers see the old file or the new one, never a torn one.
    const tmp = `${FILE}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(s))
    await fs.rename(tmp, FILE)
  })
  chain = next.catch(() => {})
  return next
}

export async function setAdd(key: string, member: string): Promise<boolean> {
  if (durable) return (await redis<number>('SADD', `vouch:${key}`, member)) === 1
  let added = false
  await mutate((s) => {
    const set = (s.sets[key] ??= [])
    if (!set.includes(member)) {
      set.push(member)
      added = true
    }
  })
  return added
}

export async function setMembers(key: string): Promise<string[]> {
  if (durable) return redis<string[]>('SMEMBERS', `vouch:${key}`)
  return (await readFile()).sets[key] ?? []
}

export async function setHas(key: string, member: string): Promise<boolean> {
  if (durable) return (await redis<number>('SISMEMBER', `vouch:${key}`, member)) === 1
  return ((await readFile()).sets[key] ?? []).includes(member)
}

export async function setSize(key: string): Promise<number> {
  if (durable) return redis<number>('SCARD', `vouch:${key}`)
  return (await readFile()).sets[key]?.length ?? 0
}

export async function incr(hash: string, field: string): Promise<void> {
  if (durable) {
    await redis('HINCRBY', `vouch:${hash}`, field, 1)
    return
  }
  await mutate((s) => {
    const h = (s.counters[hash] ??= {})
    h[field] = (h[field] ?? 0) + 1
  })
}

export async function counters(hash: string): Promise<Record<string, number>> {
  if (durable) {
    const flat = await redis<string[]>('HGETALL', `vouch:${hash}`)
    const out: Record<string, number> = {}
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]!] = Number(flat[i + 1])
    return out
  }
  return (await readFile()).counters[hash] ?? {}
}

/**
 * Fixed-window rate limit per key: shared through Redis when it is configured, else per
 * instance in memory. A Redis failure falls back to memory rather than refusing everyone.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (durable) {
    // One key per window, so a lost EXPIRE only leaks a key; it never locks a client out.
    const k = `vouch:rl:${key}:${Math.floor(Date.now() / windowMs)}`
    try {
      const n = await redis<number>('INCR', k)
      if (n === 1) await redis('EXPIRE', k, Math.ceil(windowMs / 1000))
      return n > max
    } catch {
      /* fall through to the per-instance window */
    }
  }
  return limited(key, max, windowMs)
}

/**
 * A spending budget for things that cost the relayer SOL. `reserve` takes one unit *before* the
 * spending it guards (an atomic INCR, backed out when that crosses the cap), so parallel requests
 * cannot all pass a check and then all spend. It returns a `release` for a unit that turned out not
 * to be spent (a transaction the chain refused), or null when the budget is used up. Shared through
 * Redis when it is configured, else per instance, like `rateLimit`.
 */
export async function reserve(key: string, max: number, windowMs: number): Promise<(() => Promise<void>) | null> {
  if (durable) {
    const k = `vouch:budget:${key}:${Math.floor(Date.now() / windowMs)}`
    try {
      const n = await redis<number>('INCR', k)
      if (n === 1) await redis('EXPIRE', k, Math.ceil(windowMs / 1000))
      const back = async () => void (await redis('DECR', k).catch(() => {}))
      if (n > max) {
        await back()
        return null
      }
      return back
    } catch {
      /* fall through to the per-instance count */
    }
  }
  const now = Date.now()
  if (spent.size > MAX_TRACKED) for (const [k, h] of spent) if (h.reset < now) spent.delete(k)
  let h = spent.get(key)
  if (!h || h.reset < now) spent.set(key, (h = { n: 0, reset: now + windowMs }))
  if (h.n >= max) return null
  h.n++
  const mine = h
  return async () => void (mine.n = Math.max(0, mine.n - 1))
}
const spent = new Map<string, { n: number; reset: number }>()

const hits = new Map<string, { n: number; reset: number }>()
const MAX_TRACKED = 10_000
/** The per-instance window behind `rateLimit`. */
export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  if (hits.size > MAX_TRACKED) for (const [k, h] of hits) if (h.reset < now) hits.delete(k)
  const h = hits.get(key)
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs })
    return false
  }
  h.n++
  return h.n > max
}

/**
 * Who a request is from, for rate limiting. On Vercel the platform overwrites
 * x-forwarded-for with the client address, so its first entry is trusted. Elsewhere any
 * entry left of the last may be client-written, so only the last is used: the address the
 * one hop in front of us saw (the reverse proxy, or Next itself, which fills the header from
 * the socket when the client sent none). A server exposed with no proxy in front therefore
 * cannot stop a client choosing its own key; put one in front. IPv6 is bucketed by /64,
 * since one host is routinely handed a whole /64.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  const ip = (process.env.VERCEL ? xff[0] : xff.at(-1)) ?? req.headers.get('x-real-ip') ?? ''
  return ip ? bucket(ip) : 'unknown'
}

function bucket(ip: string): string {
  const addr = ip.replace(/^\[|\](:\d+)?$/g, '').replace(/%.*$/, '')
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr)
  if (v4) return v4[1]!
  if (!addr.includes(':')) return addr
  const [head = '', tail = ''] = addr.toLowerCase().split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = addr.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}
