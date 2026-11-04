'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPreset, loadVerifier, verify } from '@/lib/data/verifier'
import type { VerificationResult } from '@/lib/data/types'
import { formatInt, formatStamp, formatZecExact } from '@/lib/format'
import { toBase64Url } from '@/lib/pof/bytes'
import { downloadBytes } from '@/lib/files'
import { DataTable } from '@/components/ui/DataTable'
import { Chip, cx, Panel, TrustNote } from '@/components/ui/primitives'
import { BtnLabel } from '@/components/motion/BtnLabel'
import { present } from '@/components/ui/Verdict'

/** The deposits file the fixtures ship beside each certificate (fixtures/*exit-deposits.json). */
interface DepositsFile {
  about: string
  certificate: string
  audience: string
  intent: string
  epoch: number
  network?: string
  deposits: Record<string, { txid?: string; height?: number; nullifiers: string[] }>
}

const SCENARIOS = [
  { id: 'testnet', label: 'Real testnet exit', file: 'testnet-exit-deposits.json' },
  { id: 'demo', label: 'Demo ledger exit', file: 'exit-deposits.json' },
] as const

type Match = { kind: 'Matched'; spent: number } | { kind: 'Mismatch'; notCertified: string[] } | { kind: 'NoShieldedSpend' } | { kind: 'NotACertificate' }

interface Entry {
  id: string
  at: number
  result: VerificationResult
  status: 'pre-cleared' | 'refused' | 'matched' | 'mismatch'
  deposit?: { txid?: string; nullifiers: string[]; match: Match }
  decision?: 'released' | 'held'
}

const SEEN_KEY = 'vouch:rail:seen'

/** The rail's reuse registry, in this browser only: a demo stand-in for the Verify API's store. */
function readSeen(audience: string): string[] {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>)[audience] ?? []
  } catch {
    return []
  }
}
function addSeen(audience: string, tags: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>
    all[audience] = [...new Set([...(all[audience] ?? []), ...tags])]
    localStorage.setItem(SEEN_KEY, JSON.stringify(all))
  } catch {
    /* private mode: reuse is not remembered across visits */
  }
}
function clearSeen(audience: string) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>
    delete all[audience]
    localStorage.setItem(SEEN_KEY, JSON.stringify(all))
  } catch {
    /* nothing stored */
  }
}

/** The same strict rule as `pof-verify match`: every nullifier the deposit reveals must be certified. */
function matchDeposit(revealed: string[], nullifiers: string[]): Match {
  if (!revealed.length) return { kind: 'NotACertificate' }
  if (!nullifiers.length) return { kind: 'NoShieldedSpend' }
  const notCertified = nullifiers.filter((n) => !revealed.includes(n.toLowerCase()))
  return notCertified.length ? { kind: 'Mismatch', notCertified } : { kind: 'Matched', spent: new Set(nullifiers).size }
}

/**
 * A rail's compliance desk, as a demo: receive exit certificates under the rail's own policy (its
 * period, its "unmoved since" block), see reuse, match the deposit when it lands, and decide.
 * The decision is local to this page; Vouch never moves money.
 */
export function RailConsole() {
  const [audience, setAudience] = useState('rail:testnet-demo')
  const [epoch, setEpoch] = useState('202610')
  const [since, setSince] = useState('')
  const [scenario, setScenario] = useState<DepositsFile | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nullifierText, setNullifierText] = useState('')
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadVerifier()
      .then(() => setReady('ready'))
      .catch(() => setReady('failed'))
  }, [])

  const policy = useMemo(() => {
    const e = Number(epoch.trim())
    const s = Number(since.replace(/[ ,]/g, ''))
    return {
      epoch: epoch.trim() && Number.isSafeInteger(e) && e >= 0 ? e : undefined,
      dormantSince: since.trim() && Number.isInteger(s) && s > 0 ? s : undefined,
    }
  }, [epoch, since])

  /** `as` overrides the form when a scenario has just set it: React state is not updated yet. */
  const receive = async (bytes: Uint8Array, as?: { audience: string; epoch: number }) => {
    setError(null)
    const asked = as ? { epoch: as.epoch, dormantSince: undefined } : policy
    if (asked.epoch === undefined) {
      setError('Name your period first: without one, the same coins could be used with you twice unseen.')
      return
    }
    setBusy(true)
    try {
      const a = (as?.audience ?? audience).trim().toLowerCase()
      const result = await verify(bytes, a, { policy: asked, seen: readSeen(a) })
      const id = result.scope && result.envelope ? toBase64Url(bytes).slice(-16) : `refused-${Date.now()}`
      const ok = result.verdict.kind === 'Valid' && result.revealed.length > 0
      if (ok) addSeen(a, result.tags)
      setEntries((es) => [{ id, at: Math.floor(Date.now() / 1000), result, status: ok ? 'pre-cleared' : 'refused' }, ...es])
    } catch (e) {
      setError(`The verifier could not run: ${(e as Error).message}.`)
    } finally {
      setBusy(false)
    }
  }

  const loadScenario = async (file: string) => {
    setError(null)
    try {
      const r = await fetch(`/proofs/${file}`)
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
      const s = (await r.json()) as DepositsFile
      setScenario(s)
      setAudience(s.audience)
      setEpoch(String(s.epoch))
      setSince('')
      await receive(await fetchPreset(s.certificate), { audience: s.audience, epoch: s.epoch })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const applyDeposit = (entryId: string, deposit: { txid?: string; nullifiers: string[] }) => {
    setEntries((es) =>
      es.map((e) => {
        if (e.id !== entryId) return e
        const match = matchDeposit(e.result.revealed, deposit.nullifiers)
        return { ...e, deposit: { ...deposit, match }, status: match.kind === 'Matched' ? 'matched' : 'mismatch', decision: undefined }
      }),
    )
  }

  const pasted = () =>
    nullifierText
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

  const decide = (entryId: string, decision: 'released' | 'held') => setEntries((es) => es.map((e) => (e.id === entryId ? { ...e, decision } : e)))

  const exportLog = () =>
    downloadBytes(
      JSON.stringify(
        entries.map((e) => ({
          id: e.id,
          receivedAt: e.at,
          status: e.status,
          decision: e.decision ?? null,
          verdict: e.result.verdict,
          checks: e.result.checks,
          scope: e.result.scope,
          revealed: e.result.revealed,
          deposit: e.deposit ?? null,
          verifier: e.result.verifier,
        })),
        null,
        2,
      ),
      'rail-audit-log.json',
      'application/json',
    )

  const current = entries[0]

  return (
    <div className="space-y-6">
      <TrustNote label="DEMO RAIL" tone="strong">
        This console plays a rail’s compliance desk. Verification is real (the same WASM verifier as /verify); the rail, its reuse registry (kept
        in this browser) and its release button are a demo. Vouch returns evidence; the rail decides, and nothing here moves money.
      </TrustNote>

      <Panel label="The rail’s policy" chip={<Chip status={ready === 'failed' ? 'invalid' : 'neutral'}>{ready === 'ready' ? 'WASM · READY' : ready === 'failed' ? 'VERIFIER FAILED' : 'LOADING'}</Chip>}>
        <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
          <label className="flex flex-col gap-2">
            <span className="t-eyebrow text-ink-3">RAIL IDENTIFIER</span>
            <input className="field t-data" value={audience} onChange={(e) => setAudience(e.target.value)} spellCheck={false} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="t-eyebrow text-ink-3">PERIOD (EPOCH)</span>
            <input className="field t-data" inputMode="numeric" value={epoch} onChange={(e) => setEpoch(e.target.value)} spellCheck={false} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="t-eyebrow text-ink-3">UNMOVED SINCE · OPTIONAL</span>
            <input className="field t-data" inputMode="numeric" placeholder="block height" value={since} onChange={(e) => setSince(e.target.value)} spellCheck={false} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-4 sm:px-6">
          <span className="t-eyebrow mr-2 text-ink-3">RUN A SCENARIO · REAL PROOFS</span>
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" disabled={busy} className="pick btn btn-sm border border-border hover:border-ink" onClick={() => void loadScenario(s.file)}>
              {s.label}
            </button>
          ))}
          <label className="btn btn-sm btn-secondary cursor-pointer">
            <BtnLabel>Receive a certificate…</BtnLabel>
            <input
              ref={fileInput}
              type="file"
              accept=".pof,application/octet-stream"
              className="sr-only"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) await receive(new Uint8Array(await f.arrayBuffer()))
                if (fileInput.current) fileInput.current.value = ''
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => {
              clearSeen(audience.trim().toLowerCase())
              setEntries([])
            }}
          >
            <BtnLabel>Reset the registry</BtnLabel>
          </button>
        </div>
        {scenario && <p className="t-data-sm border-t border-border px-5 py-3 text-ink-3 sm:px-6">{scenario.about}</p>}
      </Panel>

      {error && (
        <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
          {error}
        </div>
      )}

      <div aria-live="polite">
        {current ? (
          <CertificateCard
            entry={current}
            scenario={scenario}
            nullifierText={nullifierText}
            setNullifierText={setNullifierText}
            onDeposit={(d) => applyDeposit(current.id, d)}
            onPasted={() => applyDeposit(current.id, { nullifiers: pasted() })}
            onDecide={(d) => decide(current.id, d)}
          />
        ) : (
          <div className="rounded-panel border border-dashed border-border px-5 py-8 sm:px-8">
            <p className="t-data text-ink-3">{busy ? 'Checking the certificate…' : 'No certificate received yet. Run a scenario, or receive a .pof file.'}</p>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <section aria-labelledby="log-h">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 id="log-h" className="t-eyebrow text-ink-3">
              INCOMING · THIS SESSION
            </h3>
            <button type="button" className="btn btn-sm btn-secondary" onClick={exportLog}>
              <BtnLabel>Export audit log</BtnLabel>
            </button>
          </div>
          <DataTable<Entry>
            caption="Certificates received"
            rowKey={(e) => `${e.id}-${e.at}`}
            rows={entries}
            columns={[
              { key: 'at', header: 'Received', className: 'w-44 text-ink-3', cell: (e) => formatStamp(e.at) },
              { key: 'claim', header: 'Claim', cell: (e) => (e.result.envelope ? `≥ ${formatZecExact(e.result.envelope.claim.zatoshi)} ${e.result.anchor?.network === 'testnet' ? 'TAZ' : 'ZEC'}` : '—') },
              { key: 'verdict', header: 'Verdict', className: 'w-44', cell: (e) => e.result.verdict.kind },
              { key: 'status', header: 'Status', className: 'w-32', cell: (e) => e.status },
              { key: 'decision', header: 'Decision', className: 'w-28', cell: (e) => e.decision ?? '—' },
            ]}
          />
        </section>
      )}

      <TrustNote label="WHAT IT PROVES">
        A certificate shows the coins were already in the chain at a block and have not moved since, and names them by their nullifiers. It does
        not say where they were before that block; pick the block by your own policy. A deposit matches when every note it spends is one the
        certificate named. Wallets must build exit transactions without dummy spends (spend two or more certified notes into no more outputs than
        spends): a dummy spend’s nullifier cannot be told from an uncertified one, so it reads as a mismatch.
      </TrustNote>
    </div>
  )
}

function CertificateCard({
  entry,
  scenario,
  nullifierText,
  setNullifierText,
  onDeposit,
  onPasted,
  onDecide,
}: {
  entry: Entry
  scenario: DepositsFile | null
  nullifierText: string
  setNullifierText: (s: string) => void
  onDeposit: (d: { txid?: string; nullifiers: string[] }) => void
  onPasted: () => void
  onDecide: (d: 'released' | 'held') => void
}) {
  const r = entry.result
  const v = r.verdict
  const env = r.envelope
  const p = present(v, r.now)
  const tone = entry.status === 'matched' ? 'valid' : entry.status === 'pre-cleared' ? 'neutral' : 'invalid'
  return (
    <div className={cx('rounded-panel border bg-bone px-5 py-6 sm:px-8', tone === 'valid' ? 'border-valid' : tone === 'invalid' ? 'border-invalid' : 'border-ink')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="t-display-m text-ink">
          {entry.status === 'pre-cleared' ? 'Pre-cleared.' : entry.status === 'matched' ? 'Deposit matched.' : entry.status === 'mismatch' ? 'Deposit does not match.' : 'Refused.'}
        </p>
        <Chip status={tone === 'neutral' ? 'neutral' : tone}>{entry.status.toUpperCase()}</Chip>
      </div>
      {v.kind === 'Valid' && env ? (
        <p className="t-body mt-4 text-ink">
          At least <span className="font-mono text-seal">{formatZecExact(v.claim.zatoshi)}</span> {r.anchor?.network === 'testnet' ? 'TAZ' : 'ZEC'}, as of block{' '}
          <span className="font-mono">{formatInt(v.anchorHeight)}</span>
          {v.dormantSince !== undefined && (
            <>
              , unmoved since block <span className="font-mono">{formatInt(v.dormantSince)}</span>
            </>
          )}
          , in period {env.epoch}. {r.revealed.length ? `It names ${r.revealed.length} nullifiers (the notes being sent, and padding that never appears on chain).` : 'It is not an exit certificate: it names no notes.'}
        </p>
      ) : (
        <p className="t-data mt-4 max-w-[72ch] text-ink-2">
          {p.code}: {p.detail}
        </p>
      )}

      {entry.status !== 'refused' && (
        <div className="mt-6 space-y-3 border-t border-border pt-5">
          <p className="t-eyebrow text-ink-3">WHEN THE DEPOSIT LANDS</p>
          {scenario && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(scenario.deposits).map(([name, d]) => (
                <button key={name} type="button" className="pick btn btn-sm border border-border hover:border-ink" onClick={() => onDeposit(d)}>
                  Deposit {d.txid ? `${d.txid.slice(0, 10)}…` : name}
                </button>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-2">
            <span className="t-data-sm text-ink-3">Or paste the deposit’s Ironwood nullifiers (hex, one per line):</span>
            <textarea className="field t-data-sm min-h-[72px] break-all" value={nullifierText} onChange={(e) => setNullifierText(e.target.value)} spellCheck={false} />
          </label>
          <button type="button" className="btn btn-sm btn-secondary" disabled={!nullifierText.trim()} onClick={onPasted}>
            <BtnLabel>Match these</BtnLabel>
          </button>
          {entry.deposit && (
            <div className="t-data space-y-2 pt-2">
              {entry.deposit.txid && (
                <p className="text-ink-2">
                  Transaction <span className="font-mono [overflow-wrap:anywhere]">{entry.deposit.txid}</span>
                  {scenario?.network === 'testnet' ? ' on Zcash testnet' : ''}
                </p>
              )}
              <p className={entry.deposit.match.kind === 'Matched' ? 'text-valid' : 'text-invalid'}>
                {entry.deposit.match.kind === 'Matched'
                  ? `Every note this deposit spends (${entry.deposit.match.spent}) is one the certificate named.`
                  : entry.deposit.match.kind === 'Mismatch'
                    ? `${entry.deposit.match.notCertified.length} of the ${entry.deposit.nullifiers.length} nullifiers it reveals are not in the certificate: uncertified notes, or dummy spends, which look the same.`
                    : entry.deposit.match.kind === 'NoShieldedSpend'
                      ? 'The deposit spends no shielded notes.'
                      : 'Not an exit certificate.'}
              </p>
              <div className="flex gap-2 pt-1">
                <button type="button" className={cx('btn btn-sm', entry.decision === 'released' ? 'btn-primary' : 'btn-secondary')} onClick={() => onDecide('released')}>
                  <BtnLabel>Release</BtnLabel>
                </button>
                <button type="button" className={cx('btn btn-sm', entry.decision === 'held' ? 'btn-primary' : 'btn-secondary')} onClick={() => onDecide('held')}>
                  <BtnLabel>Hold</BtnLabel>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
