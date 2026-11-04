'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { Attestation, CreditLine, GateTransaction, ProofRequest, ServiceStatus, VerificationResult } from '@/lib/data/types'
import { DEMO_AUDIENCE, DEMO_THRESHOLD_ZAT, INSTRUCTIONS_SYSVAR } from '@/lib/data/chain'
import { fetchPreset, verify } from '@/lib/data/verifier'
import { attest as liveAttest, demoProve, relayBorrower, relayDraw, relayOpenLine, relaySubmit, serviceStatusAwake } from '@/lib/data/services'
import * as sim from '@/lib/data/simulated'
import { formatDate, formatInt, formatZecExact } from '@/lib/format'
import { fromBase64Url, fromHex, toBase58, toBase64Url } from '@/lib/pof/bytes'
import { isUnbound, reseal } from '@/lib/pof/codec'
import { Chip, cx, TrustNote } from '@/components/ui/primitives'
import { DropMarch, PickBox, PickCheck } from '@/components/motion/Pick'
import { BtnLabel } from '@/components/motion/BtnLabel'
import { ClaimLine } from '@/components/ui/ClaimLine'
import { Hash } from '@/components/ui/Hash'
import { Mark } from '@/components/brand/Mark'

type Status = 'idle' | 'running' | 'done' | 'failed'
type StepId = 'proof' | 'attest' | 'tx' | 'line'
type Mode = 'live' | 'sim'

interface State {
  /** The mode this run started in. Every step of one run uses it, whatever the page learns later. */
  mode?: Mode
  proofB64?: string
  proof?: VerificationResult
  attestation?: Attestation
  tx?: GateTransaction
  line?: CreditLine
  status: Record<StepId, Status>
  error: Partial<Record<StepId, { title: string; body: string }>>
  extra?: { title: string; body: string; ok: boolean }
}

const INITIAL: State = { status: { proof: 'idle', attest: 'idle', tx: 'idle', line: 'idle' }, error: {} }
const ORDER: StepId[] = ['proof', 'attest', 'tx', 'line']
const TITLES: Record<StepId, string> = { proof: 'the proof', attest: 'the attestation', tx: 'the transaction', line: 'credit line' }
const POOL_REQUEST: ProofRequest = { v: 1, claim: 'HoldsAtLeast', zatoshi: String(DEMO_THRESHOLD_ZAT), audience: DEMO_AUDIENCE.id, expiryDays: 7, bind: 'solana' }

/** Flip one byte of Halo2 evidence and re-seal the checksum, as a forger would. */
function tamper(b64: string): string {
  const bytes = fromBase64Url(b64)!.slice()
  const at = bytes.length - 32 - 64 - 2_000
  bytes[at] = bytes[at]! ^ 0x01
  return toBase64Url(reseal(bytes))
}

export function GateDemo() {
  const [svc, setSvc] = useState<ServiceStatus | null>(null)
  const [borrower, setBorrower] = useState<string | null>(null)
  const [s, setS] = useState<State>(INITIAL)
  const [tamperProof, setTamperProof] = useState(false)
  const [tamperAtt, setTamperAtt] = useState(false)
  const [attestorDown, setAttestorDown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [waking, setWaking] = useState(false)

  // Nothing can run until svc is set, and svc is set together with the borrower, so a run never
  // starts SIM and then finds itself LIVE. A sleeping attestor is waited for, not reported as absent.
  useEffect(() => {
    const stop = new AbortController()
    void serviceStatusAwake(() => setWaking(true), stop.signal).then(async (st) => {
      const b = st.solana && st.attestor.ok ? await relayBorrower() : null
      if (stop.signal.aborted) return
      setWaking(false)
      setBorrower(b)
      setSvc(st)
    })
    return () => stop.abort()
  }, [])

  const deployed: Mode = svc?.solana && svc.attestor.ok && borrower ? 'live' : 'sim'
  const mode: Mode = s.mode ?? deployed
  const next = ORDER.find((id) => s.status[id] === 'idle')
  const halted = ORDER.some((id) => s.status[id] === 'failed')
  const reset = () => setS(INITIAL)

  async function loadProof(mode: Mode): Promise<string> {
    if (mode === 'live' && (svc?.demoProver || svc?.demoPool) && borrower) {
      const out = await demoProve(POOL_REQUEST, borrower)
      if (!out.ok) throw new Error(`The demo holder could not prove: ${out.message}`)
      return out.proof.proof
    }
    return toBase64Url(await fetchPreset(mode === 'live' ? 'onchain.pof' : 'valid.pof'))
  }

  async function step(id: StepId, st: State): Promise<State> {
    const mode = st.mode ?? deployed
    const done = (patch: Partial<State>): State => ({ ...st, ...patch, status: { ...st.status, [id]: 'done' } })
    const fail = (title: string, body: string): State => ({ ...st, status: { ...st.status, [id]: 'failed' }, error: { ...st.error, [id]: { title, body } } })
    try {
      switch (id) {
        case 'proof': {
          let b64 = await loadProof(mode)
          if (tamperProof) b64 = tamper(b64)
          return done({ proofB64: b64, proof: await verify(b64, DEMO_AUDIENCE.id) })
        }
        case 'attest': {
          if (attestorDown) return fail('Attestor unreachable', 'Simulated outage: connection refused. Nothing was signed and nothing reached Solana. The demo says so instead of spinning.')
          const out = mode === 'live' ? await liveAttest(st.proofB64!) : await sim.attest(st.proof!, false)
          if (out.ok) return done({ attestation: out.attestation })
          return fail(out.reason === 'unreachable' ? 'Attestor unreachable' : 'Attestor refused to sign', out.message)
        }
        case 'tx': {
          const a = st.attestation!
          const out = mode === 'live' ? await relaySubmit({ action: 'submit', attestation: { message: a.message, signature: a.signature, attestor: a.attestor }, tamper: tamperAtt }) : await sim.submit(a, { tamperAttestation: tamperAtt })
          return out.ok ? done({ tx: out.tx }) : fail(`Transaction failed · ${out.failedAt}`, out.message)
        }
        case 'line': {
          if (mode === 'live') {
            const out = await relayOpenLine({ action: 'open-line', receipt: st.tx!.receipt })
            return out.ok ? done({ line: out.line }) : fail(`open_line failed · ${out.failedAt}`, out.message)
          }
          return done({ line: await sim.openLine(st.tx!) })
        }
      }
    } catch (err) {
      return fail('Step failed', (err as Error).message)
    }
  }

  const runNext = async () => {
    if (!next || halted || busy) return
    setBusy(true)
    const st: State = { ...s, mode }
    setS({ ...st, status: { ...st.status, [next]: 'running' } })
    setS(await step(next, st))
    setBusy(false)
  }

  const runAll = async () => {
    if (busy) return
    setBusy(true)
    let st: State = { ...INITIAL, mode: deployed }
    setS(st)
    for (const id of ORDER) {
      setS({ ...st, status: { ...st.status, [id]: 'running' } })
      st = await step(id, st)
      setS(st)
      if (st.status[id] === 'failed') break
    }
    setBusy(false)
  }

  const replay = async () => {
    if (!s.attestation) return
    setBusy(true)
    const out =
      mode === 'live'
        ? await relaySubmit({ action: 'submit', attestation: { message: s.attestation.message, signature: s.attestation.signature, attestor: s.attestation.attestor } })
        : ({ ok: false, failedAt: 'Instruction 1 · pof-gate', message: 'Simulated: the ClaimReceipt account for this proof id already exists, so account creation fails. One proof, one receipt.' } as const)
    // Only a refusal by the chain counts. A relayer that is busy or out of budget refused nothing.
    setS({
      ...s,
      extra: out.ok
        ? { ok: false, title: 'Replay was accepted', body: 'This should never happen: pof-gate created a second receipt.' }
        : out.failedAt.startsWith('Instruction')
          ? { ok: true, title: `Replay refused · ${out.failedAt}`, body: out.message }
          : { ok: false, title: `Could not run the replay · ${out.failedAt}`, body: out.message },
    })
    setBusy(false)
  }

  const stranger = async () => {
    if (!s.tx) return
    setBusy(true)
    const out =
      mode === 'live'
        ? await relayOpenLine({ action: 'open-line', receipt: s.tx.receipt, wallet: 'stranger' })
        : ({ ok: false, failedAt: 'pof-credit · open_line', message: 'Simulated: the signer is not the account the proof is bound to, so pof-credit refuses. A copied proof or receipt is worthless to anyone else.' } as const)
    setS({
      ...s,
      extra: out.ok
        ? { ok: false, title: 'Another wallet opened a line', body: 'This should never happen.' }
        : out.failedAt.startsWith('pof-credit')
          ? { ok: true, title: `Refused · ${out.failedAt}`, body: out.message }
          : { ok: false, title: `Could not run this · ${out.failedAt}`, body: out.message },
    })
    setBusy(false)
  }

  const drawOnLine = async () => {
    if (!s.line) return
    setBusy(true)
    const out = mode === 'live' ? await relayDraw({ action: 'draw', line: s.line.account }) : await sim.draw(s.line)
    setS(
      out.ok
        ? {
            ...s,
            line: { ...s.line, drawn: out.drawn, drawExplorer: 'explorer' in out ? (out.explorer as string | undefined) : undefined },
            extra: { ok: true, title: `Drew ${out.amount} · pof-credit · draw`, body: `The pool’s vault paid the borrower’s account; ${out.drawn} of ${s.line.limit} is now drawn. The borrower signed, the relayer paid the fee.` },
          }
        : { ...s, extra: { ok: out.failedAt.startsWith('pof-credit'), title: `Draw refused · ${out.failedAt}`, body: out.message } },
    )
    setBusy(false)
  }

  // Screen readers hear each step land; failures are already announced by their role="alert".
  const running = ORDER.find((id) => s.status[id] === 'running')
  const doneCount = ORDER.filter((id) => s.status[id] === 'done').length
  const announce = running
    ? `Step ${ORDER.indexOf(running) + 1}, ${TITLES[running]}: running.`
    : halted
      ? ''
      : doneCount === ORDER.length
        ? `All four steps done: ${s.line ? `a credit line of ${s.line.limit} is open.` : 'complete.'}`
        : doneCount > 0
          ? `Step ${doneCount}, ${TITLES[ORDER[doneCount - 1]!]}: done.`
          : ''

  const binding = s.proof?.envelope && !isUnbound(s.proof.envelope.binding) ? toBase58(fromHex(s.proof.envelope.binding)) : null

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-14">
      {/* controls */}
      <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center gap-3">
          <Chip status={mode === 'live' ? 'valid' : 'neutral'}>{svc ? (mode === 'live' ? `LIVE · ${svc.solana?.cluster}` : 'SIMULATED CHAIN') : waking ? 'WAKING THE ATTESTOR' : 'CHECKING'}</Chip>
        </div>
        {waking && !svc && (
          <p className="t-data-sm text-ink-3" role="status">
            The attestor runs on a free host that sleeps when idle. Waking it takes up to a minute; the demo starts LIVE once it answers.
          </p>
        )}
        <div className="space-y-2">
          <button type="button" className="btn btn-primary w-full" aria-busy={busy} onClick={() => void runNext()} disabled={!svc || !next || halted || busy}>
            <BtnLabel>{busy ? 'Running…' : halted ? 'Halted · reset to retry' : next ? `Run step ${ORDER.indexOf(next) + 1}` : 'Complete'}</BtnLabel>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void runAll()} disabled={!svc || busy}>
              <BtnLabel>Run all</BtnLabel>
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={reset} disabled={busy}>
              <BtnLabel>Reset</BtnLabel>
            </button>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="t-eyebrow mb-3 text-ink-3">BREAK SOMETHING</legend>
          <Toggle disabled={busy} checked={tamperProof} onChange={(v) => { setTamperProof(v); reset() }} label="Flip one byte of the proof" hint="The attestor runs the verifier, gets ProofInvalid, refuses to sign." />
          <Toggle disabled={busy} checked={tamperAtt} onChange={(v) => { setTamperAtt(v); reset() }} label="Flip one byte of the attestation" hint="The Ed25519 instruction fails; pof-gate never runs." />
          <Toggle disabled={busy} checked={attestorDown} onChange={(v) => { setAttestorDown(v); reset() }} label="Take the attestor offline" hint="Simulated outage. The demo says so instead of spinning." />
        </fieldset>

        {mode === 'sim' ? (
          <TrustNote label="SIMULATED">
            Step 1 is real: a real proof, checked by the real verifier in your browser. This deployment has no attestor or devnet programs
            configured, so steps 2–4 are simulated. They fail in the same places, for the same reasons, as the live stack.
            {svc?.attestor.message && ` (${svc.attestor.message})`}
          </TrustNote>
        ) : (
          <TrustNote label="LIVE">
            Real attestor, real Solana {svc?.solana?.cluster} transactions sent by a demo relayer that holds the borrower key the proof is bound to.
            Every account links to the explorer.
          </TrustNote>
        )}
      </aside>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
      {/* the stepper */}
      <ol className="relative">
        <Step n={1} title="The proof" status={s.status.proof} error={s.error.proof} caption={mode === 'live' ? 'The demo holder proves ≥ 500 ZEC for the pool, bound to the borrower’s Solana account. The ZEC stays where it is.' : 'The borrower hands over proof.pof. The ZEC stays where it is.'}>
          {s.proof?.envelope && (
            <>
              {s.proof.verdict.kind === 'Valid' ? (
                <ClaimLine claim={s.proof.envelope.claim} anchorHeight={s.proof.envelope.anchor.height} />
              ) : (
                <p className="t-body text-ink-2">
                  Claims to hold at least {formatZecExact(s.proof.envelope.claim.zatoshi)} ZEC. Your browser’s verifier says: {s.proof.verdict.kind}.
                </p>
              )}
              <Artifact
                rows={[
                  ['file', `proof.pof · ${formatInt(s.proof.sizeBytes)} bytes · POF1 v${s.proof.envelope.version}`],
                  ['verdict', `${s.proof.verdict.kind} · checked by ${s.proof.verifier} (WASM) in ${s.proof.elapsedMs.toFixed(0)} ms`],
                  ['audience', <Hash key="a" value={s.proof.envelope.audience} head={10} tail={6} label="audience hash" />],
                  ['bound to', binding ? <Hash key="b" value={binding} head={8} tail={6} label="Solana account" /> : 'nobody (unbound)'],
                  ['anchor', `block ${formatInt(s.proof.envelope.anchor.height)}${s.proof.anchor ? ` · ${s.proof.anchor.network}` : ''}`],
                  ['expires', formatDate(s.proof.envelope.expiresAt)],
                  ['checksum', <Hash key="c" value={s.proof.checksum ?? ''} head={10} tail={6} label="checksum" />],
                ]}
              />
            </>
          )}
        </Step>

        <Step n={2} title="The attestation" status={s.status.attest} error={s.error.attest} caption="pof-attest runs the same verifier and signs the verdict for a chain that cannot read Zcash.">
          <TrustNote label="TRUST-MINIMISED" tone="strong" className="mb-5">
            This is the one step that is not trustless. Solana cannot verify a Zcash proof: wrong curve, and no access to Zcash state. So an
            open-source attestor runs pof-verify and signs the result. The program accepts only keys on its allowlist, anyone can run an
            attestor, and anyone can re-derive the verdict from the proof and public chain data.
          </TrustNote>
          {s.attestation && (
            <Artifact
              rows={[
                ['domain', s.attestation.domain],
                ['subject', <Hash key="s" value={s.attestation.subject} head={10} tail={6} label="proof id" />],
                ['beneficiary', <Hash key="b" value={s.attestation.beneficiary} head={8} tail={6} label="beneficiary" />],
                ['claim', `kind ${s.attestation.claimKind} · value ${formatInt(s.attestation.claimValue)} zat`],
                ['anchor_ht', formatInt(s.attestation.anchorHeight)],
                ['expires', formatDate(s.attestation.expiresAt)],
                ['verdict', `${s.attestation.verdict} (Valid)`],
                ['slot', formatInt(s.attestation.slot)],
                ['message', <Hash key="m" value={s.attestation.message} head={16} tail={8} label="message" />],
                ['signature', <Hash key="g" value={s.attestation.signature} head={16} tail={8} label="signature" />],
                ['attestor', <Hash key="p" value={s.attestation.attestor} head={8} tail={6} label="attestor key" />],
              ]}
            />
          )}
        </Step>

        <Step n={3} title="The transaction" status={s.status.tx} error={s.error.tx} caption="One transaction, two instructions. pof-gate reads the Instructions sysvar to bind the signature to this attestation.">
          {s.tx && (
            <Artifact
              rows={[
                ...s.tx.instructions.map((ix): [string, ReactNode] => [
                  `ix ${ix.index}`,
                  <span key={ix.index}>
                    {ix.program} · <Hash value={ix.programId} head={8} tail={4} label="program id" /> · {ix.summary}
                  </span>,
                ]),
                ['sysvar', <Hash key="sv" value={INSTRUCTIONS_SYSVAR} head={10} tail={4} label="sysvar" />],
                ['receipt', <Hash key="r" value={s.tx.receipt} head={8} tail={6} label="ClaimReceipt" />],
                ['signature', s.tx.explorer ? <a key="t" className="link-draw text-ink" href={s.tx.explorer} target="_blank" rel="noreferrer">{s.tx.signature.slice(0, 16)}… ↗</a> : <Hash key="t" value={s.tx.signature} head={12} tail={8} label="transaction signature" />],
                ['slot', formatInt(s.tx.slot)],
              ]}
            />
          )}
        </Step>

        <Step n={4} title="Credit line opened" status={s.status.line} error={s.error.line} caption="pof-credit reads the receipt, checks the threshold and the signer, marks the receipt consumed, and opens the line." last>
          {s.line && (
            <>
              <p className="t-body text-ink">
                A credit line of <span className="font-mono">{s.line.limit}</span> is open against a proof of at least {formatZecExact(s.line.requiredZatoshi)} ZEC.
              </p>
              <Artifact
                rows={[
                  ['line', s.line.explorer ? <a key="l" className="link-draw text-ink" href={s.line.explorer} target="_blank" rel="noreferrer">{s.line.account.slice(0, 12)}… ↗</a> : <Hash key="l" value={s.line.account} head={8} tail={6} label="CreditLine account" />],
                  ['pool', <Hash key="p" value={s.line.pool} head={8} tail={6} label="pool account" />],
                  ['limit', s.line.limit],
                  ['drawn', s.line.drawExplorer ? <a key="d" className="link-draw text-ink" href={s.line.drawExplorer} target="_blank" rel="noreferrer">{s.line.drawn} ↗</a> : s.line.drawn],
                  ['against', <Hash key="a" value={s.line.openedAgainst} head={8} tail={6} label="receipt" />],
                  ['required', `${formatInt(s.line.requiredZatoshi)} zat`],
                ]}
              />
              <p className="t-data-sm mt-5 text-ink-3">The ZEC never left Zcash. The pool never learned the balance, the notes, or any address.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void drawOnLine()} disabled={busy}>
                  <BtnLabel>{`Draw 1,000 ${mode === 'live' ? 'dUSDC' : 'USDC'}`}</BtnLabel>
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void replay()} disabled={busy}>
                  <BtnLabel>Submit the same attestation again</BtnLabel>
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void stranger()} disabled={busy}>
                  <BtnLabel>Open a line from another wallet</BtnLabel>
                </button>
              </div>
              {s.extra && (
                <div role="status" className={cx('mt-4 rounded-panel border px-5 py-4', s.extra.ok ? 'border-border' : 'border-invalid')}>
                  <p className={cx('t-data font-medium', s.extra.ok ? 'text-ink' : 'text-invalid')}>{s.extra.title}</p>
                  <p className="t-data-sm mt-2 max-w-[80ch] text-ink-2">{s.extra.body}</p>
                </div>
              )}
            </>
          )}
        </Step>
      </ol>
    </div>
  )
}

function Step({ n, title, caption, status, error, last, children }: { n: number; title: string; caption: string; status: Status; error?: { title: string; body: string }; last?: boolean; children?: ReactNode }) {
  return (
    <li className={cx('relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-5 sm:grid-cols-[56px_minmax(0,1fr)] sm:gap-x-8', !last && 'pb-12')}>
      {!last && <span className="absolute bottom-0 left-5 top-12 w-px bg-border sm:left-7" aria-hidden />}
      <div className="flex justify-center pt-1">
        <Mark size={40} state={status === 'done' ? 'disclosed' : status === 'failed' ? 'void' : 'sealed'} tone={status === 'failed' ? 'void' : status === 'idle' || status === 'running' ? 'decorative' : 'bone'} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <p className="t-data-sm text-ink-3">{String(n).padStart(2, '0')}</p>
          <h2 className="t-display-m text-ink">{title}</h2>
          {status === 'done' && <Chip>done</Chip>}
          {status === 'running' && <Chip>running</Chip>}
          {status === 'failed' && <Chip status="invalid">failed</Chip>}
        </div>
        <p className="t-small mt-2 max-w-[60ch] text-ink-2">{caption}</p>
        <div className="mt-5">
          {children}
          {error && (
            <div role="alert" className="rounded-panel border border-invalid px-5 py-4">
              <p className="t-data font-medium text-invalid">{error.title}</p>
              <p className="t-data-sm mt-2 max-w-[80ch] text-ink-2">{error.body}</p>
            </div>
          )}
          {status === 'idle' && !children && <p className="t-data-sm text-ink-3">Waiting.</p>}
        </div>
      </div>
    </li>
  )
}

function Artifact({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="t-data-sm mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] border-t border-border">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-border py-2 uppercase tracking-[0.1em] text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words border-b border-border py-2 text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label
      className={cx(
        'flex gap-3 rounded-chip border border-border p-3 transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ink',
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <PickBox on={checked} />
      <span>
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        <span className="t-data-sm block text-ink-3">{hint}</span>
      </span>
    </label>
  )
}
