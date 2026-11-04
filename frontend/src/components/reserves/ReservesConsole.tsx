'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchPreset, isBatch, loadVerifier, verifyBatch } from '@/lib/data/verifier'
import type { BatchResult, VerificationResult } from '@/lib/data/types'
import { formatInt, formatZecExact } from '@/lib/format'
import { DataTable } from '@/components/ui/DataTable'
import { Chip, cx, Panel, TrustNote } from '@/components/ui/primitives'
import { BtnLabel } from '@/components/motion/BtnLabel'
import { ReserveFeedPanel } from './ReserveFeedPanel'

const PRESETS = [
  {
    id: 'reserves',
    label: 'A reserves batch',
    note: 'The demo holder’s five notes, two per proof, three proofs in one scope. Summed by the verifier.',
    file: 'reserves.pofb',
  },
  {
    id: 'reserves-double',
    label: 'A note counted twice',
    note: 'Two real proofs, but the second counts a note the first already counted. Each is valid alone; the batch is not.',
    file: 'reserves-double.pofb',
  },
] as const

const MAX_BYTES = 4 * 1024 * 1024
/** The verifier identifier the demo reserves were proven to: the wrapped-ZEC demo feed. */
const RESERVES_AUDIENCE = 'reserves:wzec-demo'

interface Row {
  n: number
  result: VerificationResult
}

/**
 * A reserves batch: several proofs from one holder, in one scope, against one anchor. The verifier
 * refuses a note counted twice across them and states the sum. Like /verify, it is a trust surface:
 * the verdict appears and sits still.
 */
export function ReservesConsole() {
  const [audience, setAudience] = useState<string>(RESERVES_AUDIENCE)
  const [active, setActive] = useState<string | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading')
  const fileInput = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    loadVerifier()
      .then(() => setReady('ready'))
      .catch(() => setReady('failed'))
  }, [])

  /** `as` overrides the field when a preset has just set it: React state is not updated yet. */
  const run = async (bytes: Uint8Array, which: string, as?: string) => {
    const mine = ++seq.current
    setActive(which)
    setError(null)
    if (bytes.length > MAX_BYTES) {
      setResult(null)
      setError(`That is ${formatInt(bytes.length)} bytes; a batch of 64 proofs is under 1 MB.`)
      return
    }
    if (!isBatch(bytes)) {
      setResult(null)
      setError('This is not a reserves batch (.pofb). A single proof is checked on /verify.')
      return
    }
    setBusy(true)
    try {
      const r = await verifyBatch(bytes, (as ?? audience).trim())
      if (mine === seq.current) setResult(r)
    } catch (e) {
      if (mine === seq.current) {
        setResult(null)
        setError(`The verifier could not run: ${(e as Error).message}. Nothing was checked.`)
      }
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }

  const runPreset = async (id: string, file: string) => {
    try {
      setAudience(RESERVES_AUDIENCE)
      await run(await fetchPreset(file), id, RESERVES_AUDIENCE)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const current = PRESETS.find((p) => p.id === active)
  const rows: Row[] = result?.members.map((m, i) => ({ n: i + 1, result: m })) ?? []
  const v = result?.verdict

  return (
    <div className="space-y-6">
      <Panel label="Reserves batch" chip={<Chip status={ready === 'failed' ? 'invalid' : 'neutral'}>{ready === 'ready' ? 'WASM · READY' : ready === 'failed' ? 'VERIFIER FAILED TO LOAD' : 'LOADING VERIFIER'}</Chip>}>
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex min-h-[140px] cursor-pointer flex-col justify-between gap-4 rounded-panel border border-dashed border-border p-5 hover:border-ink hover:bg-bone-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal">
            <span className="t-eyebrow text-ink-3">CHOOSE A .POFB FILE</span>
            <span className="t-title block">Choose a reserves batch.</span>
            <span className="t-small text-ink-2">Read in this browser and never uploaded.</span>
            <input
              ref={fileInput}
              type="file"
              accept=".pofb,application/octet-stream"
              className="sr-only"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) await run(new Uint8Array(await f.arrayBuffer()), 'custom')
                if (fileInput.current) fileInput.current.value = ''
              }}
            />
          </label>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="t-eyebrow text-ink-3">VERIFYING AS</span>
              <input className="field t-data" readOnly={busy} value={audience} onChange={(e) => setAudience(e.target.value)} spellCheck={false} />
            </label>
            <div>
              <p className="t-eyebrow mb-3 text-ink-3">OR RUN A TEST BATCH · REAL PROOFS</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    aria-pressed={active === p.id}
                    onClick={() => void runPreset(p.id, p.file)}
                    className={cx('pick btn btn-sm border hover:border-ink', active === p.id ? 'border-ink' : 'border-border')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {current && <p className="t-data-sm mt-3 text-ink-3">{current.note}</p>}
            </div>
          </div>
        </div>
      </Panel>

      {error && (
        <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
          {error}
        </div>
      )}

      <div aria-live="polite">
        {v ? (
          <div className={cx('rounded-panel border bg-bone px-5 py-6 sm:px-8', v.kind === 'Valid' ? 'border-valid' : 'border-invalid')}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="t-display-m text-ink">{v.kind === 'Valid' ? 'Valid.' : 'Invalid.'}</p>
              <Chip status={v.kind === 'Valid' ? 'valid' : 'invalid'}>{v.kind === 'Valid' ? 'RESERVES ESTABLISHED' : v.kind === 'Malformed' ? 'MALFORMED' : 'BATCH REFUSED'}</Chip>
            </div>
            {v.kind === 'Valid' ? (
              <p className="t-body mt-4 text-ink">
                Holds at least <span className="font-mono text-seal">{formatZecExact(v.totalZatoshi)} ZEC</span> across {v.members} proofs, as of block{' '}
                <span className="font-mono">{formatInt(v.anchorHeight)}</span>
                {v.dormantSince !== undefined && (
                  <>
                    , unmoved since block <span className="font-mono">{formatInt(v.dormantSince)}</span>
                  </>
                )}
                . No note is counted twice.
              </p>
            ) : (
              <p className="t-data mt-4 max-w-[72ch] text-ink-2">{v.reason}</p>
            )}
            {result && (
              <p className="t-data-sm mt-4 text-ink-3">
                {formatInt(result.sizeBytes)} bytes · checked in {result.elapsedMs.toFixed(0)} ms · {result.verifier}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-panel border border-dashed border-border px-5 py-8 sm:px-8">
            <p className="t-data text-ink-3">{busy ? 'Checking every proof in the batch…' : 'No batch checked yet. A total appears here, or the proof at fault.'}</p>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <section aria-labelledby="members-h">
          <h3 id="members-h" className="t-eyebrow mb-4 text-ink-3">
            THE PROOFS IN THE BATCH
          </h3>
          <DataTable<Row>
            caption="Batch members"
            rowKey={(r) => String(r.n)}
            rows={rows}
            rowClassName={(r) => (v?.kind === 'Invalid' && v.member === r.n - 1 ? 'text-invalid' : undefined)}
            columns={[
              { key: 'n', header: '#', className: 'w-10 text-ink-3', cell: (r) => String(r.n).padStart(2, '0') },
              {
                key: 'claim',
                header: 'Claim',
                cell: (r) => (r.result.envelope ? `at least ${formatZecExact(r.result.envelope.claim.zatoshi)} ZEC` : '—'),
              },
              { key: 'verdict', header: 'Alone', className: 'w-44', cell: (r) => r.result.verdict.kind },
              {
                key: 'note',
                header: 'In the batch',
                cell: (r) => (v?.kind === 'Invalid' && v.member === r.n - 1 ? 'at fault' : v?.kind === 'Valid' ? 'counted' : '—'),
              },
            ]}
          />
        </section>
      )}

      <ReserveFeedPanel />

      <TrustNote label="HOW IT ADDS UP">
        Every proof names the same verifier, period and block. Inside one period the same note always yields the same tag, so a note
        counted in two proofs is seen and the batch is refused. The total is the sum of what each proof shows, in 0.125 ZEC steps: the
        holder’s exact balance is still never revealed.
      </TrustNote>
    </div>
  )
}
