'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchPreset } from '@/lib/data/verifier'
import { toBase64Url } from '@/lib/pof/bytes'
import { formatInt, formatZecExact } from '@/lib/format'
import { Chip, Panel } from '@/components/ui/primitives'
import { BtnLabel } from '@/components/motion/BtnLabel'

interface FeedStatus {
  configured: boolean
  relayer?: boolean
  error?: string
  feed?: { totalZatoshi: string; members: number; anchorHeight: number; ncHeight: number; heartbeatSlots: number; updatedSlot: number; publishes: number; mint: string }
  supply?: string
  slot?: number
  stale?: boolean
  explorer?: { feed: string; mint: string }
}

interface Outcome {
  ok: boolean
  text: string
  link?: string
}

/**
 * The reserves feed on Solana devnet (pof-reserve): publish the demo batch to it, and Secure-Mint
 * its demo wrapped ZEC, which the program refuses past the proven reserves or on a stale feed.
 */
export function ReserveFeedPanel() {
  const [status, setStatus] = useState<FeedStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/reserve', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      setStatus((await r.json()) as FeedStatus)
    } catch {
      setStatus({ configured: false, error: 'the feed could not be read' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (label: string, body: object) => {
    setBusy(label)
    setOutcome(null)
    try {
      const r = await fetch('/api/reserve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      const out = (await r.json()) as { explorer?: string; error?: string }
      setOutcome(r.ok ? { ok: true, text: `${label}: landed.`, link: out.explorer } : { ok: false, text: `${label}: refused — ${out.error ?? `HTTP ${r.status}`}` })
      await load()
    } catch (e) {
      setOutcome({ ok: false, text: `${label}: ${(e as Error).message}` })
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => act('Publish the demo batch', { action: 'publish', batch: toBase64Url(await fetchPreset('reserves.pofb')) })
  const f = status?.feed
  const room = f && status?.supply !== undefined ? BigInt(f.totalZatoshi) - BigInt(status.supply) : null
  const live = Boolean(status?.configured && status.relayer)

  return (
    <Panel label="On Solana · pof-reserve" chip={<Chip status={status?.configured ? (status.stale ? 'expired' : 'valid') : 'neutral'}>{status?.configured ? (status.stale ? 'FEED STALE' : 'DEVNET · FRESH') : 'NOT DEPLOYED'}</Chip>}>
      <div className="space-y-4 p-5 sm:p-6">
        {!status?.configured ? (
          <p className="t-data text-ink-3">
            The reserves feed is not deployed on this site yet. When it is, a reserves batch is published here as an on-chain feed (signed by the
            attestor, checked by the program), and a demo wrapped-ZEC token mints only within the proven total and only while the feed is fresh.
          </p>
        ) : (
          f && (
            <>
              <p className="t-body text-ink">
                Feed total <span className="font-mono text-seal">{formatZecExact(f.totalZatoshi)} ZEC</span> across {f.members} proofs, as of block{' '}
                <span className="font-mono">{formatInt(f.anchorHeight)}</span> · {f.publishes} publish{f.publishes === 1 ? '' : 'es'} · wZEC supply{' '}
                <span className="font-mono">{formatZecExact(status.supply ?? '0')}</span>
                {room !== null && ` · room to mint ${formatZecExact(room > 0n ? room : 0n)}`}.
              </p>
              <p className="t-data-sm text-ink-3">
                Heartbeat {formatInt(f.heartbeatSlots)} slots; last update at slot {formatInt(f.updatedSlot)}, now {formatInt(status.slot ?? 0)}.{' '}
                {status.explorer && (
                  <>
                    <a className="underline underline-offset-4" href={status.explorer.feed} target="_blank" rel="noreferrer">
                      feed ↗
                    </a>{' '}
                    ·{' '}
                    <a className="underline underline-offset-4" href={status.explorer.mint} target="_blank" rel="noreferrer">
                      mint ↗
                    </a>
                  </>
                )}
              </p>
            </>
          )
        )}
        {live && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => void publish()}>
              <BtnLabel>{busy === 'Publish the demo batch' ? 'Publishing…' : 'Publish the demo batch'}</BtnLabel>
            </button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy !== null} onClick={() => void act('Mint 100 wZEC', { action: 'mint', amount: '10000000000' })}>
              <BtnLabel>Mint 100 wZEC</BtnLabel>
            </button>
            {room !== null && room > 0n && (
              <button type="button" className="btn btn-sm btn-secondary" disabled={busy !== null} onClick={() => void act('Mint past the reserves', { action: 'mint', amount: (room + 1n).toString() })}>
                <BtnLabel>Break it: mint past the reserves</BtnLabel>
              </button>
            )}
          </div>
        )}
        {outcome && (
          <p role="status" className={outcome.ok ? 't-data text-valid' : 't-data text-invalid'}>
            {outcome.text}{' '}
            {outcome.link && (
              <a className="underline underline-offset-4" href={outcome.link} target="_blank" rel="noreferrer">
                explorer ↗
              </a>
            )}
          </p>
        )}
      </div>
    </Panel>
  )
}
