'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import type { ProofRequest, ServiceStatus, VerificationResult } from '@/lib/data/types'
import { decodeRequestDetailed, encodeRequest, cliCommand, demoCliCommand, newRequestId } from '@/lib/request'
import { verify } from '@/lib/data/verifier'
import { demoProve, serviceStatus } from '@/lib/data/services'
import { DEMO_AUDIENCE } from '@/lib/data/chain'
import { claimParts, formatInt, formatDate, formatStamp } from '@/lib/format'
import { fromBase64Url, toBase64Url } from '@/lib/pof/bytes'
import { downloadBytes, isPofBinary } from '@/lib/files'
import { downloadReceipt } from '@/lib/receipt'
import { NEVER } from '@/lib/reveal'
import { Chip, cx, Eyebrow, Panel, TrustNote } from '@/components/ui/primitives'
import { CopyBlock } from '@/components/ui/CopyBlock'
import { RevealTable } from '@/components/ui/RevealTable'
import { Verdict, present } from '@/components/ui/Verdict'
import { SourceNote } from '@/components/verify/SourceNote'
import { flyToken } from '@/lib/dropToken'
import { assembleInto } from '@/lib/assemble'
import { DropMarch, PickBox, PickCheck } from '@/components/motion/Pick'
import { CopyButton } from '@/components/motion/CopyButton'
import { BtnLabel } from '@/components/motion/BtnLabel'
import { readHistory, revoke, revokedSecrets, upsert, writeHistory, type HistoryEntry } from './history'

const SAMPLE: ProofRequest = { v: 1, claim: 'HoldsAtLeast', zatoshi: '50000000000', audience: DEMO_AUDIENCE.id, expiryDays: 7 }

// Release archives hold pof-prove, pof-verify and pof-anchor, with a .sha256 beside each (.github/workflows/release.yml).
const LATEST = 'https://github.com/SATISH-JALAN/Vouch/releases/latest/download'
const INSTALL: Record<string, string> = {
  macOS: `curl -fL ${LATEST}/vouch-macos-arm64.tar.gz | tar xz && export PATH="$PWD/vouch-macos-arm64:$PATH"   # Apple silicon`,
  Linux: `curl -fL ${LATEST}/vouch-linux-x86_64.tar.gz | tar xz && export PATH="$PWD/vouch-linux-x86_64:$PATH"`,
  Windows: `iwr ${LATEST}/vouch-windows-x86_64.zip -OutFile vouch.zip; Expand-Archive vouch.zip .; $env:Path = "$PWD\\vouch-windows-x86_64;$env:Path"   # PowerShell`,
  'From source': 'cargo install --git https://github.com/SATISH-JALAN/Vouch pof-prove --locked   # Rust 1.91+',
}

const isBase58Key = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim())

/**
 * The request lives in ?r=. Reading it through useSearchParams means the first client paint already
 * knows it, and a navigation to another request (or to bare /prove) replaces it.
 */
export function ProveConsole() {
  return (
    <Suspense fallback={<Panel label="Opening the request" bodyClassName="p-5 sm:p-8"><p className="t-data text-ink-3">Reading the link…</p></Panel>}>
      <FromSearch />
    </Suspense>
  )
}

function FromSearch() {
  const r = useSearchParams().get('r')
  // a new request starts clean: no proof, error or binding from the last one
  return <Console key={r ?? ''} r={r} />
}

type Proved = { b64: string; result: VerificationResult; provingMs?: number; notesUsed?: number }

function Console({ r }: { r: string | null }) {
  const decoded = useMemo(() => (r ? decodeRequestDetailed(r) : null), [r])
  const request = decoded?.ok ? decoded.request : null
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [path, setPath] = useState<'wallet' | 'demo'>('demo')
  const [os, setOs] = useState('macOS')
  const [solana, setSolana] = useState('')
  const [busy, setBusy] = useState<'proving' | 'checking' | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proof, setProof] = useState<Proved | null>(null)
  const handover = useRef<HTMLElement>(null)
  const assembled = useRef(false)

  // the first proof this page produces is assembled out of scattered hex (MOTION.md §7.6), once
  useEffect(() => {
    if (!proof || assembled.current || proof.result.verdict.kind !== 'Valid') return
    assembled.current = true
    const id = requestAnimationFrame(() => {
      const el = handover.current
      const hash = el?.querySelector('[aria-label^="Copy checksum"]')
      const r = hash?.getBoundingClientRect()
      if (r && r.top > 0 && r.bottom < window.innerHeight) assembleInto(hash!, el!.querySelector('[data-verdict-mark]')?.closest('.rounded-panel') ?? el)
    })
    return () => cancelAnimationFrame(id)
  }, [proof])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [revoked, setRevoked] = useState<Set<string>>(new Set())
  const [listDown, setListDown] = useState(false)

  useEffect(() => {
    setHistory(readHistory())
    void revokedSecrets().then((s) => (s ? setRevoked(s) : setListDown(true)))
    void serviceStatus().then((s) => {
      setStatus(s)
      if (!s.demoProver) setPath('wallet')
    })
  }, [])

  const needsBinding = request?.bind === 'solana'
  const bindingOk = !needsBinding || isBase58Key(solana)

  const record = useCallback(
    (b64: string, result: VerificationResult, secret?: string) => {
      const env = result.envelope
      if (!env || !request) return
      const p = claimParts(env.claim, result.anchor?.network)
      setHistory(
        upsert({
          id: env.revocation.slice(0, 16),
          claim: `${p.before} ${p.value}`,
          audience: request.audience,
          network: result.anchor?.network ?? 'unknown',
          anchorHeight: env.anchor.height,
          createdAt: env.issuedAt,
          expiresAt: env.expiresAt,
          revocationTag: env.revocation,
          revocationSecret: secret,
          proof: b64,
        }),
      )
    },
    [request],
  )

  /** Verify our own proof the way the other side will. Throws if the verifier cannot run. */
  const selfVerify = async (input: string | Uint8Array, secret?: string, meta?: { provingMs?: number; notesUsed?: number }) => {
    if (!request) return
    const b64 = typeof input === 'string' ? input.trim() : toBase64Url(input)
    const result = await verify(b64, request.audience)
    setProof({ b64, result, ...meta })
    if (result.verdict.kind === 'Valid') record(b64, result, secret)
  }

  const proveAsDemo = async () => {
    if (!request || !bindingOk || busy) return
    setBusy('proving')
    setError(null)
    setProof(null)
    try {
      const out = await demoProve(request, needsBinding ? solana.trim() : undefined)
      if (out.ok) await selfVerify(out.proof.proof, out.proof.revocationSecret, { provingMs: out.proof.provingMs, notesUsed: out.proof.notesUsed })
      else setError(`The demo holder could not prove this: ${out.message}`)
    } catch (err) {
      setError(`The proof could not be made or checked: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy('checking')
    setError(null)
    setProof(null)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      await selfVerify(isPofBinary(buf) ? buf : new TextDecoder().decode(buf))
    } catch (err) {
      setError(`That file could not be checked: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const historyPanel = <History entries={history} revoked={revoked} listDown={listDown} durable={status?.durable} setEntries={setHistory} setRevoked={setRevoked} />

  if (!request) {
    return (
      <div className="space-y-8">
        {decoded && !decoded.ok && (
          <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
            This request link cannot be used: {decoded.reason}
          </div>
        )}
        <Panel label="No request open" bodyClassName="space-y-4 p-5 sm:p-8">
          <p className="t-body max-w-[60ch] text-ink-2">
            A verifier sends you a link that says exactly what they want to know. Open it and this page shows you what they will and will not learn
            before anything is generated.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={() => window.location.assign(`/prove?r=${encodeRequest({ ...SAMPLE, id: newRequestId() })}`)}>
              <BtnLabel>Open a sample request</BtnLabel>
            </button>
            <a className="btn btn-secondary" href="/request">
              <BtnLabel>Build a request</BtnLabel>
            </a>
          </div>
        </Panel>
        {historyPanel}
      </div>
    )
  }

  const p = claimParts({ kind: 'HoldsAtLeast', zatoshi: Number(request.zatoshi) })
  const encoded = encodeRequest(request)
  const overdue = request.respondBy && request.respondBy < Date.now() / 1000
  const verdict = proof && present(proof.result.verdict, proof.result.now)

  return (
    <div className="space-y-16">
      {/* the review screen: the product */}
      <section aria-labelledby="review-h" className="rounded-panel border border-ink p-5 sm:p-8">
        <Eyebrow>INCOMING PROOF REQUEST · REVIEW BEFORE ANYTHING IS GENERATED</Eyebrow>
        <h2 id="review-h" className="t-display-m mt-6 max-w-[30ch] text-ink">
          <span className="font-mono text-[0.72em] [overflow-wrap:anywhere]">{request.audience}</span>{' '}
          {request.kind === 'reserves'
            ? `asks you to prove your reserves total at least ${p.value}`
            : request.kind === 'exit'
              ? `asks you to certify the at least ${p.value} you are about to send them`
              : `asks you to prove you hold at least ${p.value}`}
          {request.dormantSince ? `, in coins unmoved since block ${formatInt(request.dormantSince)}` : ''}.
        </h2>
        <p className="t-small mt-4 text-ink-2">
          Expires {request.expiryDays} {request.expiryDays === 1 ? 'day' : 'days'} after you generate it. You can revoke it before then.
          {request.respondBy && ` They asked for an answer by ${formatDate(request.respondBy)}${overdue ? ' — that date has passed' : ''}.`}
          {request.id && ` Request id ${request.id}.`}
        </p>
        {request.epoch !== undefined && (
          <p className="t-small mt-2 text-ink-2">
            This request names a period ({request.epoch}). If you use the same coins with {request.audience} again in that period, they will
            see it was the same coins. Nobody else can link the two.
          </p>
        )}
        {request.kind === 'exit' && (
          <p className="t-small mt-2 text-ink-2">
            Make this certificate when you are ready to send. It names the coins being sent, so the recipient can match it to the deposit.
          </p>
        )}
        {request.kind === 'reserves' && (
          <p className="t-small mt-2 text-ink-2">
            Reserves are proven as a batch of proofs, up to five notes each, from the command line. The total is shown; your exact balance is not.
          </p>
        )}
        <RevealTable
          className="mt-8"
          learn={[
            { label: 'The claim', value: request.kind === 'reserves' ? `Reserves total at least ${p.value}` : `Holds at least ${p.value}` },
            { label: 'As of', value: 'one finalised block, chosen when you prove' },
            ...(request.dormantSince ? [{ label: 'Unmoved since', value: `block ${formatInt(request.dormantSince)}: your coins were in the chain then and untouched since` }] : []),
            ...(request.epoch !== undefined ? [{ label: 'Reuse', value: `visible to them within period ${request.epoch}, to nobody else` }] : []),
            { label: 'Made for', value: request.audience },
            ...(needsBinding ? [{ label: 'Usable by', value: 'only your Solana account, which you name below' }] : []),
            { label: 'Valid for', value: `${request.expiryDays} ${request.expiryDays === 1 ? 'day' : 'days'}` },
          ]}
          never={NEVER}
        />
      </section>

      {/* approve */}
      <section aria-labelledby="approve-h" className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="approve-h" className="t-display-m text-ink">
            Approve it.
          </h2>
          <div role="group" aria-label="How to prove" className="flex overflow-hidden rounded-chip border border-border">
            {(
              [
                ['demo', 'As the demo holder'],
                ['wallet', 'With your own wallet'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                aria-pressed={path === k}
                type="button"
                onClick={() => setPath(k)}
                className={cx('pick pick-ink t-data-sm px-4 py-2 uppercase tracking-[0.1em]', path === k ? 'text-bone' : 'text-ink-2 hover:bg-bone-2')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {needsBinding && (
          <label className="block">
            <span className="t-eyebrow mb-2 block text-ink-3">YOUR SOLANA ACCOUNT (BASE58)</span>
            <input className="field t-data w-full" value={solana} onChange={(e) => setSolana(e.target.value)} placeholder="e.g. 7Xf…9Qk" spellCheck={false} aria-invalid={!!solana && !bindingOk} aria-describedby="solana-help" />
            <span id="solana-help" className={cx('t-data-sm mt-2 block', solana && !bindingOk ? 'text-invalid' : 'text-ink-3')}>
              {solana && !bindingOk ? 'That is not a base58 Solana public key.' : 'The proof is bound to this account; nobody else can use it on-chain.'}
            </span>
          </label>
        )}

        {path === 'demo' ? (
          <Panel label="The demo holder" chip={<Chip>{status?.demoProver ? 'LIVE' : status ? 'NOT CONFIGURED' : 'CHECKING'}</Chip>} bodyClassName="space-y-5 p-5 sm:p-6">
            <p className="t-body max-w-[70ch] text-ink-2">
              No ZEC needed. The demo holder owns 4,018.2 ZEC in five real Ironwood notes on the published demo ledger. Pressing prove makes the
              demo prover answer this exact request with a real Halo2 proof; then this page verifies it the way the other side will.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" aria-busy={busy === 'proving'} onClick={() => void proveAsDemo()} disabled={!!busy || !status?.demoProver || !bindingOk}>
                <BtnLabel>{busy === 'proving' ? 'Proving…' : 'Prove as the demo holder'}</BtnLabel>
              </button>
              {!status?.demoProver && status && <span className="t-data-sm text-ink-3">{status.attestor.message ?? 'The demo prover runs inside pof-attest; this deployment has none.'} Use the CLI below.</span>}
            </div>
            <CopyBlock label="OR RUN THE SAME THING LOCALLY" value={demoCliCommand(encoded, request.bind)} />
          </Panel>
        ) : (
          <Panel label="Your own wallet" chip={<Chip>Keys stay on your machine</Chip>} bodyClassName="space-y-5 p-5 sm:p-6">
            <div role="group" aria-label="Install" className="flex flex-wrap gap-2">
              {Object.keys(INSTALL).map((k) => (
                <button key={k} type="button" aria-pressed={os === k} onClick={() => setOs(k)} className={cx('pick btn btn-sm border', os === k ? 'border-ink' : 'border-border hover:border-ink')}>
                  {k}
                </button>
              ))}
            </div>
            <CopyBlock label="1 · INSTALL THE PROVER" value={INSTALL[os]!} />
            <div className="mt-6">
              <p className="t-eyebrow mb-2 text-ink-3">2 · GET THE CHAIN SNAPSHOT</p>
              <p className="t-data-sm text-ink-2">
                The prover reads the public Ironwood data up to a published anchor from a local snapshot file, which pof-anchor builds from any
                lightwalletd.{' '}
                <Link href="/docs/prove#snapshot" className="link-draw text-ink">
                  How to get the snapshot
                </Link>
              </p>
            </div>
            <CopyBlock label="3 · ANSWER THIS REQUEST" value={cliCommand(encoded, request.bind)} />
            <p className="t-data-sm text-ink-3">
              The prover reads your seed from the local file you name with --seed-file, finds your notes in the snapshot, picks the fewest that
              clear the bar, and proves. Your seed never leaves your machine, nothing is broadcast, and the only thing it writes is proof.pof.
            </p>
          </Panel>
        )}

        <label
          data-dropzone=""
          data-dragging={dragging}
          onDragOver={(e: DragEvent) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) flyToken(file.name, { x: e.clientX, y: e.clientY }, e.currentTarget.querySelector('.t-title'))
            void onFile(file)
          }}
          aria-disabled={busy ? true : undefined}
          className={cx(
            'flex flex-col gap-2 rounded-panel border border-dashed border-border p-5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal',
            busy ? 'cursor-wait' : 'cursor-pointer hover:border-ink hover:bg-bone-2',
          )}
        >
          <DropMarch />
          <span className="t-eyebrow text-ink-3">{path === 'wallet' ? '4 · ' : ''}CHECK IT BEFORE YOU SEND IT</span>
          <span className="t-title">{busy === 'checking' ? 'Checking…' : 'Drop the proof.pof it wrote. You see exactly what they will see.'}</span>
          <input
            type="file"
            accept=".pof,.txt,application/octet-stream,text/plain"
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              void onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>

        {error && (
          <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
            {error}
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {busy === 'proving' ? 'Proving…' : busy === 'checking' ? 'Checking…' : verdict ? `${verdict.word} ${verdict.code}` : ''}
        </p>
      </section>

      {proof && (
        <section ref={handover} aria-labelledby="handover-h" className="space-y-6">
          <h2 id="handover-h" className="t-display-m text-ink">
            {proof.result.verdict.kind === 'Valid' ? 'Hand it over.' : 'Do not send this one.'}
          </h2>
          {proof.provingMs !== undefined && (
            <p className="t-data-sm text-ink-3">
              Proved in {(proof.provingMs / 1000).toFixed(1)} s from {proof.notesUsed} note{proof.notesUsed === 1 ? '' : 's'}. The count is not in the proof.
            </p>
          )}
          <Verdict result={proof.result} audienceId={request.audience} />
          <SourceNote result={proof.result} />
          {proof.result.verdict.kind === 'Valid' && <Handover b64={proof.b64} audience={request.audience} result={proof.result} />}
        </section>
      )}

      {historyPanel}
    </div>
  )
}

function Handover({ b64, audience, result }: { b64: string; audience: string; result: VerificationResult }) {
  const download = () => {
    const bytes = fromBase64Url(b64)
    if (bytes) downloadBytes(bytes as BlobPart, 'proof.pof', 'application/octet-stream')
  }
  const link = () => `${window.location.origin}/verify#p=${b64}&a=${encodeURIComponent(audience)}`
  return (
    <Panel label="Send it however you already talk to them" bodyClassName="flex flex-wrap gap-2 p-5 sm:p-6">
      <button type="button" className="btn btn-primary" onClick={download}>
        <BtnLabel>Download proof.pof</BtnLabel>
      </button>
      <CopyButton value={link()} label="Copy verify link" className="btn btn-secondary" />
      <CopyButton value={b64} label="Copy as text" className="btn btn-secondary" />
      <button type="button" className="btn btn-secondary" onClick={() => downloadReceipt(result, audience)}>
        <BtnLabel>Download your receipt</BtnLabel>
      </button>
    </Panel>
  )
}

function History({
  entries,
  revoked,
  listDown,
  durable,
  setEntries,
  setRevoked,
}: {
  entries: HistoryEntry[]
  revoked: Set<string>
  /** The public revocation list could not be read: only this browser's own revocations are known. */
  listDown?: boolean
  durable?: boolean
  setEntries: Dispatch<SetStateAction<HistoryEntry[]>>
  setRevoked: Dispatch<SetStateAction<Set<string>>>
}) {
  // several revocations can be in flight at once; each one only touches its own entry
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [paste, setPaste] = useState<Record<string, string>>({})
  const [confirmForget, setConfirmForget] = useState(false)
  const now = Date.now() / 1000

  const doRevoke = async (e: HistoryEntry) => {
    const secret = (e.revocationSecret ?? paste[e.id] ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(secret)) {
      setMessage('Paste the 64-character revocation secret from `pof-prove history --secrets` first.')
      return
    }
    setBusy((b) => new Set(b).add(e.id))
    const out = await revoke(secret)
    setBusy((b) => {
      const next = new Set(b)
      next.delete(e.id)
      return next
    })
    setMessage(out.message)
    if (out.ok) {
      const mark = (x: HistoryEntry) => (x.id === e.id ? { ...x, revocationSecret: secret, revokedAt: Math.floor(Date.now() / 1000) } : x)
      setEntries((prev) => prev.map(mark))
      writeHistory(readHistory().map(mark))
      setRevoked((prev) => new Set(prev).add(secret))
    }
  }

  const forget = () => {
    writeHistory([])
    setEntries([])
    setConfirmForget(false)
  }

  return (
    <section aria-labelledby="history-h">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
        <h2 id="history-h" className="t-eyebrow text-ink">
          Your proof history · this browser only
        </h2>
        {entries.length > 0 &&
          (confirmForget ? (
            <span className="t-data-sm flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-invalid">This also deletes every stored revocation secret.</span>
              <button type="button" className="uppercase tracking-[0.12em] text-invalid hover:text-ink" onClick={forget}>
                Forget all
              </button>
              <button type="button" autoFocus className="uppercase tracking-[0.12em] text-ink-3 hover:text-ink" onClick={() => setConfirmForget(false)}>
                Keep them
              </button>
            </span>
          ) : (
            <button type="button" className="t-data-sm uppercase tracking-[0.12em] text-ink-3 hover:text-ink" onClick={() => setConfirmForget(true)}>
              Forget all
            </button>
          ))}
      </div>
      {message && <p className="t-data-sm mb-3 text-ink-2" role="status">{message}</p>}
      {listDown && entries.length > 0 && (
        <p className="t-data-sm mb-3 text-invalid" role="status">
          The public revocation list could not be read, so a proof revoked from another device may still show as live here.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="t-data text-ink-3">No proofs made in this browser yet. Proofs from the CLI are listed by `pof-prove history`.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => {
            const isRevoked = e.revokedAt !== undefined || (e.revocationSecret !== undefined && revoked.has(e.revocationSecret))
            const state = isRevoked ? 'revoked' : now > e.expiresAt ? 'expired' : 'live'
            const revoking = busy.has(e.id)
            return (
              <li key={e.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="t-data text-ink">
                    {e.claim} · for <span className="font-mono [overflow-wrap:anywhere]">{e.audience}</span>
                  </p>
                  <p className="t-data-sm text-ink-3">
                    id {e.id} · made {formatStamp(e.createdAt)} · expires {formatDate(e.expiresAt)} · {e.network} anchor, block {e.anchorHeight.toLocaleString('en-US')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip status={state === 'live' ? 'valid' : state === 'expired' ? 'expired' : 'invalid'}>{state}</Chip>
                  <a className="btn btn-sm btn-secondary" href={`/verify#p=${e.proof}&a=${encodeURIComponent(e.audience)}`}>
                    <BtnLabel>Open</BtnLabel>
                  </a>
                  {state === 'live' && (
                    <>
                      {!e.revocationSecret && (
                        <input
                          className="field t-data-sm h-[34px] w-44 px-2"
                          placeholder="revocation secret"
                          value={paste[e.id] ?? ''}
                          onChange={(ev) => {
                            const v = ev.target.value
                            setPaste((p) => ({ ...p, [e.id]: v }))
                          }}
                          aria-label={`Revocation secret for ${e.id}`}
                        />
                      )}
                      <button type="button" className="btn btn-sm border border-invalid text-invalid hover:bg-bone-2" aria-busy={revoking} disabled={revoking} onClick={() => void doRevoke(e)}>
                        <BtnLabel>{revoking ? 'Revoking…' : 'Revoke'}</BtnLabel>
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <TrustNote label="REVOCATION" className="mt-6">
        Each proof carries a tag, the hash of a secret only you hold. Revoking publishes the secret; verifiers that check the list refuse the proof.
        The list server can drop or delay an entry, but it cannot revoke a proof you did not.
        {durable === false && ' This deployment does not report durable storage for the list, so a restart may lose entries.'}
      </TrustNote>
    </section>
  )
}
