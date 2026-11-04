'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { fetchPreset, isBatch, loadVerifier, verify } from '@/lib/data/verifier'
import { PRESETS } from '@/lib/data/presets'
import { DEMO_AUDIENCE } from '@/lib/data/chain'
import type { Check, Policy, Preset, PresetId, VerificationResult } from '@/lib/data/types'
import { formatInt } from '@/lib/format'
import { revealRows } from '@/lib/reveal'
import { fromBase64Url, toBase64Url } from '@/lib/pof/bytes'
import { downloadBytes, isPofBinary } from '@/lib/files'
import { downloadReceipt } from '@/lib/receipt'
import { Verdict, present } from '@/components/ui/Verdict'
import { RevealTable } from '@/components/ui/RevealTable'
import { DataTable } from '@/components/ui/DataTable'
import { Chip, cx, Panel } from '@/components/ui/primitives'
import { SourceNote } from './SourceNote'
import { flyToken } from '@/lib/dropToken'
import { DropMarch, PickBox, PickCheck } from '@/components/motion/Pick'
import { CopyButton } from '@/components/motion/CopyButton'
import { BtnLabel } from '@/components/motion/BtnLabel'

const MAX_BYTES = 1024 * 1024
const AUDIENCE_KEY = 'vouch:verify:audience'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: the default identifier is fine */
  }
}

/** A verdict together with exactly what was verified, so later edits to the fields cannot relabel it. */
interface Checked {
  result: VerificationResult
  /** The proof as base64url text. */
  text: string
  audience: string
}

export function VerifierConsole() {
  const [text, setText] = useState('')
  const [audience, setAudience] = useState<string>(DEMO_AUDIENCE.id)
  // Optional: the block the notes must be unmoved since (a rail picks one before an incident).
  const [since, setSince] = useState('')
  const [active, setActive] = useState<PresetId | 'custom' | null>(null)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState('pof-verify')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  // only the latest run may land: an older one finishing late must not overwrite it
  const seq = useRef(0)

  const run = useCallback(async (input: string | Uint8Array, which: PresetId | 'custom', as: string, policy?: Policy) => {
    const mine = ++seq.current
    setActive(which)
    setError(null)
    const size = typeof input === 'string' ? input.length * 0.75 : input.length
    if (size > MAX_BYTES) {
      setChecked(null)
      setBusy(false)
      setError(`That is ${formatInt(Math.round(size))} bytes. A proof is about 12 KB; nothing over 1 MB is checked.`)
      return
    }
    if (typeof input !== 'string' && isBatch(input)) {
      setChecked(null)
      setBusy(false)
      setError('This is a reserves batch, not a single proof. Check it on /reserves, where the proofs are added up.')
      return
    }
    const audience = as.trim()
    const text = typeof input === 'string' ? input.trim() : toBase64Url(input)
    setBusy(true)
    try {
      const result = await verify(input, audience, { count: true, policy })
      // a verdict means the WASM loaded after all (a retry after an earlier failure)
      setReady('ready')
      if (mine === seq.current) setChecked({ result, text, audience })
    } catch (err) {
      if (mine !== seq.current) return
      setChecked(null)
      setError(`The verifier could not run: ${(err as Error).message}. Nothing was checked.`)
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [])

  // Load the WASM verifier while the visitor reads; restore the identifier; honour #p= links.
  useEffect(() => {
    const stored = readStored(AUDIENCE_KEY)
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const p = hash.get('p')
    const a = hash.get('a') ?? stored ?? DEMO_AUDIENCE.id
    setAudience(a)
    loadVerifier()
      .then((m) => {
        setReady('ready')
        setVersion(m.version)
      })
      .catch((e: unknown) => {
        setReady('failed')
        setLoadError((e as Error).message)
      })
    if (p) {
      setText(p)
      void run(p, 'custom', a)
    }
  }, [run])

  const runPreset = async (p: Preset) => {
    const mine = ++seq.current
    setAudience(p.audience)
    setSince(p.policy?.dormantSince ? String(p.policy.dormantSince) : '')
    try {
      const bytes = await fetchPreset(p.file)
      if (mine !== seq.current) return
      setText(toBase64Url(bytes))
      await run(bytes, p.id, p.audience, p.policy)
    } catch (err) {
      if (mine === seq.current) setError((err as Error).message)
    }
  }

  // What a manual check requires: the field, on top of a loaded preset's own policy.
  const asked = (): Policy | undefined => {
    const preset = PRESETS.find((p) => p.id === active)?.policy
    const n = Number(since.replace(/[ ,]/g, ''))
    const dormantSince = since.trim() && Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff ? n : undefined
    return dormantSince === undefined && !preset ? undefined : { ...preset, dormantSince }
  }

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return
    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatInt(file.size)} bytes. A proof is about 12 KB; nothing over 1 MB is checked.`)
      return
    }
    const buf = new Uint8Array(await file.arrayBuffer())
    if (isPofBinary(buf)) {
      setText(toBase64Url(buf))
      void run(buf, 'custom', audience, asked())
    } else {
      const t = new TextDecoder().decode(buf).trim()
      setText(t)
      void run(t, 'custom', audience, asked())
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    // the file's name flies from the drop point into the field its contents fill
    if (file) flyToken(file.name, { x: e.clientX, y: e.clientY }, pasteRef.current)
    void onFile(file)
  }

  const clear = () => {
    setText('')
    setChecked(null)
    setError(null)
    setActive(null)
    // otherwise choosing the same file again fires no change event
    if (fileInput.current) fileInput.current.value = ''
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  }

  const current = PRESETS.find((p) => p.id === active)

  return (
    <div className="space-y-6">
      <Panel
        label="Proof input"
        chip={<Chip status={ready === 'failed' ? 'invalid' : 'neutral'}>{ready === 'ready' ? `WASM · ${version}` : ready === 'failed' ? 'VERIFIER FAILED TO LOAD' : 'LOADING VERIFIER'}</Chip>}
      >
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* dropzone */}
          <label
            data-dropzone=""
            data-dragging={dragging}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-cursor-label="OPEN"
            aria-disabled={busy || undefined}
            className={cx(
              'flex min-h-[168px] flex-col items-start justify-between gap-6 rounded-panel border border-dashed p-5 transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
              busy ? 'cursor-wait' : 'hover:border-ink hover:bg-bone-2',
              dragging ? 'bg-bone-2' : 'border-border',
            )}
          >
            <DropMarch />
            <span className="t-eyebrow text-ink-3">DROP A .POF FILE</span>
            <span>
              <span className="t-title block">Drop a proof here, or choose a file.</span>
              <span className="t-small mt-1 block text-ink-2">Binary .pof or base64url text. It is read in this browser and never uploaded.</span>
            </span>
            <input ref={fileInput} type="file" accept=".pof,.txt,application/octet-stream,text/plain" className="sr-only" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="t-eyebrow text-ink-3">OR PASTE BASE64URL</span>
              <textarea
                ref={pasteRef}
                className="field t-data-sm min-h-[108px] break-all"
                spellCheck={false}
                readOnly={busy}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setActive('custom')
                }}
                placeholder="UE9GMQEA…"
                aria-describedby="paste-hint"
              />
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-2">
                <span className="t-eyebrow text-ink-3">VERIFYING AS</span>
                <input
                  className="field t-data"
                  readOnly={busy}
                  value={audience}
                  onChange={(e) => {
                    setAudience(e.target.value)
                    writeStored(AUDIENCE_KEY, e.target.value)
                  }}
                  spellCheck={false}
                />
              </label>
              <label className="flex flex-col gap-2 sm:w-44">
                <span className="t-eyebrow text-ink-3">UNMOVED SINCE · OPTIONAL</span>
                <input
                  className="field t-data"
                  readOnly={busy}
                  inputMode="numeric"
                  placeholder="block height"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                  aria-describedby="since-hint"
                  spellCheck={false}
                />
              </label>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" aria-busy={busy} disabled={!text.trim() || busy || ready === 'failed'} onClick={() => void run(text, active && active !== 'custom' ? active : 'custom', audience, asked())}>
                  <BtnLabel>{busy ? 'Checking…' : 'Verify'}</BtnLabel>
                </button>
                <button type="button" className="btn btn-secondary" onClick={clear} disabled={busy || (!text && !checked && !error)}>
                  <BtnLabel>Clear</BtnLabel>
                </button>
              </div>
            </div>
            <p id="paste-hint" className="t-data-sm text-ink-3">
              Try it: load a vector, change one character, verify again. Change the identifier and it will refuse.
            </p>
            <p id="since-hint" className="t-data-sm text-ink-3">
              Unmoved since: require the notes to have been in the chain at that block or earlier, and untouched after it. Leave it empty to accept any.
            </p>
          </div>
        </div>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <p className="t-eyebrow mb-3 text-ink-3">OR RUN A TEST VECTOR · REAL PROOFS</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => void runPreset(p)}
                aria-pressed={active === p.id}
                className={cx('pick btn btn-sm border hover:border-ink', active === p.id ? 'border-ink' : 'border-border')}
              >
                {p.label}
              </button>
            ))}
          </div>
          {current && (
            <p className="t-data-sm mt-3 text-ink-3">
              {current.note}
              {current.audience !== DEMO_AUDIENCE.id && ` Verifying as “${current.audience}”.`}
            </p>
          )}
        </div>
      </Panel>

      {ready === 'failed' && !error && (
        <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
          The verifier could not load{loadError ? ` (${loadError})` : ''}. Nothing can be checked in this browser until it does: reload the page to try again.
        </div>
      )}
      {error && (
        <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
          {error}
        </div>
      )}

      <div aria-live="polite">
        {checked ? (
          <Verdict result={checked.result} audienceId={checked.audience} />
        ) : (
          <div className="rounded-panel border border-dashed border-border px-5 py-8 sm:px-8">
            <p className="t-data text-ink-3">{busy ? 'Checking…' : 'No proof checked yet. A verdict appears here: valid, invalid, or expired.'}</p>
          </div>
        )}
      </div>
      {checked && (
        <>
          <SourceNote result={checked.result} />
          <ResultDetail {...checked} />
        </>
      )}
    </div>
  )
}

function ResultDetail({ result, text, audience }: Checked) {
  const tone = present(result.verdict, result.now).tone
  const failColor = tone === 'expired' ? 'text-expired' : tone === 'invalid' ? 'text-invalid' : 'text-ink'
  const pof = useMemo(() => {
    const bytes = text ? fromBase64Url(text) : null
    return bytes && isPofBinary(bytes) ? bytes : null
  }, [text])
  const link = () => `${window.location.origin}/verify#p=${text}&a=${encodeURIComponent(audience)}`

  return (
    <div className="space-y-12 pt-6">
      <section aria-labelledby="checks-h">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id="checks-h" className="t-eyebrow text-ink-3">
            THE SIX CHECKS · CHEAPEST FIRST · STOPS AT THE FIRST FAILURE
          </h3>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => downloadReceipt(result, audience)}>
            <BtnLabel>Download receipt</BtnLabel>
          </button>
        </div>
        <DataTable<Check>
          caption="Verifier checks"
          rowKey={(c) => c.id}
          rows={result.checks}
          columns={[
            { key: 'n', header: '#', className: 'w-10 text-ink-3', cell: (c) => String(result.checks.indexOf(c) + 1).padStart(2, '0') },
            { key: 'label', header: 'Check', className: 'w-[30%] text-ink', cell: (c) => c.label },
            {
              key: 'status',
              header: 'Result',
              className: 'w-32',
              cell: (c) => (
                <span className={cx('inline-flex items-center gap-2 uppercase tracking-[0.06em]', c.status === 'pass' ? 'text-ink' : c.status === 'fail' ? failColor : 'text-ink-3')}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current transition-transform duration-200 group-hover:scale-[1.4]" aria-hidden />
                  {c.status === 'not-run' ? 'not run' : c.status}
                </span>
              ),
            },
            { key: 'detail', header: 'Detail', className: 'text-ink-2', cell: (c) => c.detail },
          ]}
        />
      </section>

      {result.envelope && (
        <section aria-labelledby="reveal-h">
          <h3 id="reveal-h" className="t-eyebrow mb-4 text-ink-3">
            WHAT THIS PROOF DISCLOSED
          </h3>
          <RevealTable {...revealRows(result.envelope, result.checks, result.anchor?.network)} />
        </section>
      )}

      {text && (
        <section aria-labelledby="raw-h">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 id="raw-h" className="t-eyebrow text-ink-3">
              THE FILE · {formatInt(result.sizeBytes)} BYTES · BASE64URL
            </h3>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={text} label="Copy" className="btn btn-sm btn-secondary" />
              <CopyButton value={link()} label="Copy verify link" className="btn btn-sm btn-secondary" />
              {pof && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => downloadBytes(pof as BlobPart, 'proof.pof', 'application/octet-stream')}>
                  <BtnLabel>Download .pof</BtnLabel>
                </button>
              )}
            </div>
          </div>
          <pre className="t-data-sm max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-panel border border-border bg-bone-2 p-4 text-ink-2" data-lenis-prevent="">
            {text}
          </pre>
          <p className="t-data-sm mt-3 text-ink-3">The verify link carries the proof after the #, which browsers never send to a server.</p>
        </section>
      )}
    </div>
  )
}
