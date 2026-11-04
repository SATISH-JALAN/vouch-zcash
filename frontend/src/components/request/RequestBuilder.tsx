'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ClaimKind, ProofRequest } from '@/lib/data/types'
import { audienceProblem, cliCommand, demoCliCommand, encodeRequest, MAX_ZATOSHI, newRequestId, PROVABLE, ZAT_PER_UNIT } from '@/lib/request'
import { audienceHash } from '@/lib/pof/hash'
import { claimParts, formatDate, formatInt, formatZec, formatZecExact } from '@/lib/format'
import { Chip, cx, Panel, TrustNote } from '@/components/ui/primitives'
import { CopyBlock } from '@/components/ui/CopyBlock'
import { Hash } from '@/components/ui/Hash'
import { DropMarch, PickBox, PickCheck } from '@/components/motion/Pick'
import { BtnLabel } from '@/components/motion/BtnLabel'
import { KineticValue } from '@/components/motion/KineticValue'
import { toZatoshi, trimZec, useRequest, type RequestKind } from './store'

const CLAIMS: { kind: ClaimKind; label: string; hint: string }[] = [
  { kind: 'HoldsAtLeast', label: 'Holds at least', hint: 'Threshold. The balance is never revealed.' },
  { kind: 'ReceivedPayment', label: 'Received a payment', hint: 'One payment, by transaction id.' },
  { kind: 'ReceivedAtLeastSince', label: 'Received at least, since', hint: 'Income over a period, as a threshold.' },
  { kind: 'HoldsExactly', label: 'Holds exactly', hint: 'An exact amount. Deliberately not offered: thresholds reveal less.' },
]

const KINDS: { kind: RequestKind; label: string; hint: string }[] = [
  { kind: 'proof', label: 'Proof of funds', hint: 'One proof: they hold at least this much.' },
  { kind: 'exit', label: 'Exit certificate', hint: 'For coins about to be sent to you.' },
  { kind: 'reserves', label: 'Reserves', hint: 'A batch summing every note, none twice.' },
]

/** This month as a period, e.g. 202610: readable, and the same for every request made this month. */
const thisMonth = () => {
  const d = new Date()
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1
}

const EXPIRY = [1, 7, 30]
const RESPOND = [0, 1, 3, 7]

function useBuilt(id: string): { request: ProofRequest | null; errors: Record<string, string>; roundUp: bigint | null; zat: bigint | null } {
  const s = useRequest()
  return useMemo(() => {
    const errors: Record<string, string> = {}
    let roundUp: bigint | null = null
    const zat = toZatoshi(s.amount, s.unit)
    if (zat === null) errors.amount = s.unit === 'ZEC' ? 'A number with at most 8 decimals.' : 'A whole number of zatoshi.'
    else if (zat <= 0n) errors.amount = 'Must be greater than zero.'
    else if (zat > MAX_ZATOSHI) errors.amount = 'More than 21 million ZEC will ever exist.'
    else if (zat % ZAT_PER_UNIT !== 0n) {
      roundUp = (zat / ZAT_PER_UNIT + 1n) * ZAT_PER_UNIT
      errors.amount = `Thresholds are proven in 0.125 ZEC steps. The next step up is ${formatZecExact(roundUp)} ZEC.`
    }
    const audience = audienceProblem(s.audience)
    if (audience) errors.audience = audience
    if (!PROVABLE.includes(s.claim)) errors.claim = 'Not provable yet.'
    const since = s.dormantSince.trim().replace(/[ ,]/g, '')
    const dormantSince = since ? Number(since) : undefined
    if (dormantSince !== undefined && (!Number.isInteger(dormantSince) || dormantSince < 1000 || dormantSince > 0xffffffff || dormantSince % 1000 !== 0))
      errors.dormantSince = 'A block height that is a multiple of 1,000 (anchors are published every 1,000 blocks).'
    if (Object.keys(errors).length || zat === null) return { request: null, errors, roundUp, zat }
    const request: ProofRequest = {
      v: 1,
      id,
      claim: s.claim,
      zatoshi: zat.toString(),
      audience: s.audience.trim(),
      expiryDays: s.expiryDays,
      // the last second (UTC) of the named day, so "answer by 3 Oct" still accepts an answer on 3 Oct
      ...(s.respondDays ? { respondBy: (Math.floor(Date.now() / 86_400_000) + s.respondDays + 1) * 86_400 - 1 } : {}),
      ...(s.bindSolana ? { bind: 'solana' as const } : {}),
      ...(s.kind !== 'proof' ? { kind: s.kind } : {}),
      ...(s.detectReuse || s.kind === 'exit' ? { epoch: thisMonth() } : {}),
      ...(dormantSince !== undefined ? { dormantSince } : {}),
    }
    return { request, errors, roundUp, zat }
  }, [s, id])
}

function sentence(r: ProofRequest) {
  return claimParts({ kind: 'HoldsAtLeast', zatoshi: Number(r.zatoshi) })
}

export function RequestBuilder() {
  const s = useRequest()
  const [id, setId] = useState('0000000000000000')
  const [origin, setOrigin] = useState('')
  const { request, errors, roundUp, zat } = useBuilt(id)
  // the field keeps what is typed; the store gets a clamped number, so clearing "7" to type "30" works
  const [expiryText, setExpiryText] = useState(String(s.expiryDays))
  // the summary sentence updates on a commit (blur, Enter, a pause, a unit or a round-up), never per keystroke
  const [commit, setCommit] = useState(0)
  const bump = () => setCommit((c) => c + 1)
  // …or once typing pauses, so the sentence never disagrees for long with the link below it
  useEffect(() => {
    const t = setTimeout(bump, 700)
    return () => clearTimeout(t)
  }, [s.amount])
  useEffect(() => setExpiryText(String(s.expiryDays)), [s.expiryDays])
  const commitExpiry = () => {
    const n = Number(expiryText)
    const days = expiryText.trim() && Number.isFinite(n) ? Math.max(1, Math.min(365, Math.round(n))) : s.expiryDays
    s.set({ expiryDays: days })
    setExpiryText(String(days))
  }

  // Old links pointed at /request?r=…; the holder's side now lives at /prove.
  useEffect(() => {
    setOrigin(window.location.origin)
    setId(newRequestId())
    const r = new URLSearchParams(window.location.search).get('r')
    if (r) window.location.replace(`/prove?r=${r}`)
  }, [])

  const encoded = request ? encodeRequest(request) : null
  const link = encoded && origin ? `${origin}/prove?r=${encoded}` : null

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
      {/* the form */}
      <Panel label="Build a request" chip={<Chip>No account</Chip>} bodyClassName="space-y-8 p-5 sm:p-6">
        <fieldset>
          <legend className="t-eyebrow mb-3 text-ink-3">CLAIM</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLAIMS.map((c) => {
              const provable = PROVABLE.includes(c.kind)
              return (
                <label
                  key={c.kind}
                  data-on={s.claim === c.kind}
                  className={cx(
                    'pick rounded-chip border px-4 py-3 transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
                    provable ? 'cursor-pointer hover:border-ink' : 'cursor-not-allowed opacity-60',
                    s.claim === c.kind ? 'border-ink' : 'border-border',
                  )}
                >
                  <input type="radio" name="claim" value={c.kind} checked={s.claim === c.kind} disabled={!provable} onChange={() => s.set({ claim: c.kind })} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="block text-[15px] font-medium">{c.label}</span>
                    {provable ? <PickCheck className="h-3.5 w-3.5 shrink-0 text-ink" /> : <Chip>{c.kind === 'HoldsExactly' ? 'By design' : 'Roadmap'}</Chip>}
                  </span>
                  <span className="t-small block text-ink-3">{c.hint}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="t-eyebrow mb-3 text-ink-3">WHAT YOU ASK FOR</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <label
                key={k.kind}
                data-on={s.kind === k.kind}
                className={cx(
                  'pick cursor-pointer rounded-chip border px-4 py-3 transition-colors duration-200 hover:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
                  s.kind === k.kind ? 'border-ink' : 'border-border',
                )}
              >
                <input type="radio" name="kind" value={k.kind} checked={s.kind === k.kind} onChange={() => s.set({ kind: k.kind })} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="block text-[15px] font-medium">{k.label}</span>
                  <PickCheck className="h-3.5 w-3.5 shrink-0 text-ink" />
                </span>
                <span className="t-small block text-ink-3">{k.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="amount" className="t-eyebrow mb-3 block text-ink-3">
            {s.kind === 'reserves' ? 'TOTAL AT LEAST' : 'THRESHOLD'}
          </label>
          <div className="flex gap-2">
            <input
              id="amount"
              inputMode="decimal"
              className="field t-data flex-1"
              value={s.amount}
              onChange={(e) => s.set({ amount: e.target.value })}
              onBlur={bump}
              onKeyDown={(e) => e.key === 'Enter' && bump()}
              aria-invalid={!!errors.amount}
              aria-describedby="amount-help"
            />
            <div role="group" aria-label="Unit" className="flex overflow-hidden rounded-chip border border-border">
              {(['ZEC', 'zat'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    s.setUnit(u)
                    bump()
                  }}
                  aria-pressed={s.unit === u}
                  className={cx('pick pick-ink t-data-sm px-4 uppercase tracking-[0.1em]', s.unit === u ? 'text-bone' : 'text-ink-2 hover:bg-bone-2')}
                >
                  {u === 'zat' ? 'zatoshi' : 'ZEC'}
                </button>
              ))}
            </div>
          </div>
          <p id="amount-help" className={cx('t-data-sm mt-2', errors.amount ? 'text-invalid' : 'text-ink-3')}>
            {errors.amount ?? (zat === null ? '' : s.unit === 'ZEC' ? `= ${formatInt(zat)} zatoshi · proven in 0.125 ZEC steps` : `= ${formatZec(zat)} ZEC`)}
            {roundUp !== null && (
              <button
                type="button"
                className="ml-3 uppercase tracking-[0.12em] text-ink underline underline-offset-4"
                onClick={() => {
                  s.set({ amount: s.unit === 'ZEC' ? trimZec(formatZec(roundUp).replace(/,/g, '')) : roundUp.toString() })
                  bump()
                }}
              >
                Round up
              </button>
            )}
          </p>
        </div>

        <Field id="audience" label="AUDIENCE" error={errors.audience} hint="Your verifier identifier. The proof carries only its hash, never this name.">
          <input
            id="audience"
            className="field t-data"
            value={s.audience}
            onChange={(e) => s.set({ audience: e.target.value })}
            spellCheck={false}
            aria-invalid={!!errors.audience}
            aria-describedby="audience-help"
          />
          {s.audience.trim() && (
            <p className="t-data-sm mt-2 text-ink-3">
              blake2b → <Hash value={audienceHash(s.audience)} head={10} tail={8} label="audience hash" />
            </p>
          )}
        </Field>

        <Field
          id="since"
          label="UNMOVED SINCE · OPTIONAL"
          error={errors.dormantSince}
          hint="Require the coins to have been in the chain at this block and untouched after it, e.g. a block before a known incident. It proves when the coins last moved, not where they came from."
        >
          <input
            id="since"
            inputMode="numeric"
            className="field t-data"
            placeholder="block height, e.g. 4,410,000"
            value={s.dormantSince}
            onChange={(e) => s.set({ dormantSince: e.target.value })}
            aria-invalid={!!errors.dormantSince}
            aria-describedby="since-help"
            spellCheck={false}
          />
        </Field>

        <label className="flex cursor-pointer gap-3 rounded-chip border border-border p-3 transition-colors duration-200 hover:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal">
          <input type="checkbox" className="sr-only" checked={s.detectReuse || s.kind === 'exit'} disabled={s.kind === 'exit'} onChange={(e) => s.set({ detectReuse: e.target.checked })} />
          <PickBox on={s.detectReuse || s.kind === 'exit'} />
          <span>
            <span className="block text-[14px] font-medium text-ink">Detect the same coins used twice with you this month</span>
            <span className="t-data-sm block text-ink-3">
              The request names this month ({thisMonth()}). Within it the same notes give the same tags, so you see a second use; nobody
              else can link them. Always on for exit certificates.
            </span>
          </span>
        </label>

        <fieldset>
          <legend className="t-eyebrow mb-3 text-ink-3">EXPIRY</legend>
          <div className="flex flex-wrap items-center gap-2">
            {EXPIRY.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={s.expiryDays === d}
                onClick={() => s.set({ expiryDays: d })}
                className={cx('pick btn btn-sm border', s.expiryDays === d ? 'border-ink' : 'border-border hover:border-ink')}
              >
                {d === 1 ? '1 day' : `${d} days`}
              </button>
            ))}
            <label className="t-data-sm ml-2 flex items-center gap-2 text-ink-3">
              or
              <input
                type="number"
                min={1}
                max={365}
                className="field t-data h-[38px] w-20 px-3"
                value={expiryText}
                onChange={(e) => {
                  setExpiryText(e.target.value)
                  const n = Number(e.target.value)
                  if (Number.isInteger(n) && n >= 1 && n <= 365) s.set({ expiryDays: n })
                }}
                onBlur={commitExpiry}
                aria-label="Expiry in days"
              />
              days
            </label>
          </div>
          <p className="t-data-sm mt-2 text-ink-3">The proof stops verifying this many days after the holder generates it.</p>
        </fieldset>

        <fieldset>
          <legend className="t-eyebrow mb-3 text-ink-3">RESPOND BY</legend>
          <div className="flex flex-wrap gap-2">
            {RESPOND.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={s.respondDays === d}
                onClick={() => s.set({ respondDays: d })}
                className={cx('pick btn btn-sm border', s.respondDays === d ? 'border-ink' : 'border-border hover:border-ink')}
              >
                {d === 0 ? 'No deadline' : d === 1 ? 'Tomorrow' : `${d} days`}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer gap-3 rounded-chip border border-border p-3 transition-colors duration-200 hover:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal">
          <input type="checkbox" className="sr-only" checked={s.bindSolana} onChange={(e) => s.set({ bindSolana: e.target.checked })} />
          <PickBox on={s.bindSolana} />
          <span>
            <span className="block text-[14px] font-medium text-ink">Bind to the holder’s Solana account</span>
            <span className="t-data-sm block text-ink-3">For on-chain verifiers. Only that account can use the proof, so a copied proof is worthless.</span>
          </span>
        </label>
      </Panel>

      {/* the output */}
      <div className="space-y-6">
        <Panel label="Send this link" chip={request ? <Chip>Ready</Chip> : <Chip>Incomplete</Chip>} bodyClassName="p-5 sm:p-6">
          {request && link && encoded ? (
            <>
              <p className="t-body text-ink">
                {request.kind === 'reserves'
                  ? 'Asks for proof that their reserves total at least '
                  : request.kind === 'exit'
                    ? 'Asks them to certify the at least '
                    : 'Asks for proof that the holder holds at least '}
                <KineticValue className="font-mono" value={sentence(request).value} commit={commit} />
                {request.kind === 'exit' ? ' they are about to send you' : ''}
                {request.dormantSince ? `, in coins unmoved since block ${formatInt(request.dormantSince)}` : ''}, for{' '}
                <span className="font-mono">{request.audience}</span>, valid {request.expiryDays} {request.expiryDays === 1 ? 'day' : 'days'}
                {request.respondBy ? `, answered by ${formatDate(request.respondBy)}` : ''}
                {request.bind ? ', bound to their Solana account' : ''}
                {request.epoch ? `, in period ${request.epoch}` : ''}.
              </p>
              <CopyBlock label="LINK" value={link} />
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-sm btn-secondary" href={link} target="_blank" rel="noreferrer">
                  <BtnLabel>Preview as the holder ↗</BtnLabel>
                </a>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setId(newRequestId())}>
                  <BtnLabel>New request id</BtnLabel>
                </button>
              </div>
              <CopyBlock label="OR, FOR THE CLI" value={cliCommand(encoded, request.bind, request.kind)} />
              <CopyBlock label="ON THE DEMO LEDGER" value={demoCliCommand(encoded, request.bind, request.kind)} />
              <p className="t-data-sm mt-4 text-ink-3">Request id {id}. It lets you match the proof you receive to the request you sent.</p>
            </>
          ) : (
            <p className="t-data text-ink-3">Fix the highlighted fields and the link appears here.</p>
          )}
        </Panel>
        <TrustNote label="STATELESS">
          Nothing is stored. The whole request is encoded in the link itself. No server keeps it, there is no account, and closing this tab
          forgets it.
        </TrustNote>
      </div>
    </div>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="t-eyebrow mb-3 block text-ink-3">
        {label}
      </label>
      {children}
      <p id={`${id}-help`} className={cx('t-data-sm mt-2', error ? 'text-invalid' : 'text-ink-3')}>
        {error ?? hint}
      </p>
    </div>
  )
}
