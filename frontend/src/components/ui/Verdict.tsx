'use client'

import { useRef } from 'react'
import type { VerificationResult, Verdict as V } from '@/lib/data/types'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E, EASE, VERIFY, motionOK } from '@/lib/motion'
import { claimParts, daysBetween, formatDate, formatInt, formatStamp, plural } from '@/lib/format'
import { Mark, type MarkState, type MarkTone } from '@/components/brand/Mark'
import { ClaimLine } from './ClaimLine'
import { Chip, cx, type ChipStatus } from './primitives'
import { Hash } from './Hash'

type Tone = 'valid' | 'invalid' | 'expired' | 'neutral'

interface Presentation {
  tone: Tone
  word: string
  code: string
  detail?: string
  mark: { state: MarkState; tone: MarkTone }
}

const BORDER: Record<Tone, string> = {
  valid: 'var(--color-valid)',
  invalid: 'var(--color-invalid)',
  expired: 'var(--color-expired)',
  neutral: 'var(--color-border)',
}

export function present(v: V, now: number): Presentation {
  const invalid = (code: string, detail?: string): Presentation => ({ tone: 'invalid', word: 'Invalid.', code, detail, mark: { state: 'void', tone: 'void' } })
  switch (v.kind) {
    case 'Valid':
      return { tone: 'valid', word: 'Valid.', code: 'PROOF VALID', mark: { state: 'disclosed', tone: 'bone' } }
    case 'Expired': {
      const days = daysBetween(v.at, now)
      return {
        tone: 'expired',
        word: 'Expired.',
        code: days === 0 ? 'EXPIRED TODAY' : `EXPIRED ${plural(days, 'DAY')} AGO`,
        detail: `It stopped verifying at ${formatStamp(v.at)}. Nothing here is permanent.`,
        mark: { state: 'void', tone: 'expired' },
      }
    }
    case 'Revoked':
      return invalid('REVOKED', 'The holder invalidated this proof before its expiry.')
    case 'WrongAudience':
      return invalid('WRONG AUDIENCE', 'This proof names a different verifier. Passing a proof on is visible.')
    case 'AnchorNotFound':
      return invalid('ANCHOR NOT FOUND', 'The tree root it claims does not exist at that block height.')
    case 'AnchorTooOld':
      return invalid('ANCHOR TOO OLD', `It shows the notes unspent at block ${formatInt(v.anchorHeight)}, which is older than this verifier accepts. Ask for a fresh proof.`)
    case 'NotDormantLongEnough':
      return invalid(
        'NOT UNMOVED LONG ENOUGH',
        `It shows the notes unmoved since block ${formatInt(v.dormantSince)}; this verifier requires block ${formatInt(v.required)} or earlier.`,
      )
    case 'WrongScope':
      return invalid('WRONG PERIOD', `Made for you, but for period ${v.epoch}; you asked for period ${v.required}. Ask the holder for a proof made for your request.`)
    case 'AlreadyUsed':
      return invalid('ALREADY USED', 'The proof is genuine, but these coins were already used with you in this period.')
    case 'ProofInvalid':
      return invalid('PROOF INVALID', v.detail)
    case 'Malformed':
      return invalid('MALFORMED', v.reason)
  }
}

/**
 * The most important surface on the site, and its verify event (MOTION.md §7.1): one physical event,
 * not a state swap. Valid: the seal stamps down with one press shadow and one ripple, the border takes
 * the valid colour, and the disclosed value's bar lifts as it turns seal red. Invalid: the border
 * snaps to the invalid colour, one 4px nudge, the strike draws, the reason rises into place. Expired:
 * the seal drains of colour and a strike draws across the date. The hashes settle out of hex once.
 * Every withheld field stays barred and still. Callers own the aria-live region around it, so it
 * exists before the first verdict arrives.
 */
export function Verdict({ result, audienceId, className }: { result: VerificationResult; audienceId?: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const p = present(result.verdict, result.now)
  const env = result.envelope
  const v = result.verdict

  useGSAP(
    () => {
      const el = root.current
      if (!el || !motionOK()) return
      const line = el.querySelector('.v-line')
      const strike = el.querySelector('.v-strike')
      const mark = el.querySelector('[data-verdict-mark] svg')
      const ripple = el.querySelector('[data-verdict-ripple]')
      const tl = gsap.timeline()
      if (p.tone === 'valid') {
        const bar = el.querySelector('[data-claim-bar]')
        const value = el.querySelector('[data-claim-value]')
        const ink = getComputedStyle(el).color
        const seal = getComputedStyle(document.documentElement).getPropertyValue('--color-seal').trim()
        // the stamp: down hard with one frame of press shadow, then a single faint ring
        tl.fromTo(mark, { scale: VERIFY.stampFrom, filter: 'drop-shadow(0 3px 0 rgb(26 29 27 / 0.28))' }, { scale: 1, filter: 'drop-shadow(0 0 0 rgb(26 29 27 / 0))', duration: VERIFY.stamp, ease: 'power3.out', transformOrigin: '50% 50%' })
          .fromTo(ripple, { scale: 1, opacity: 0.45 }, { scale: 1.7, opacity: 0, duration: VERIFY.ripple, ease: 'power2.out' }, VERIFY.stamp * 0.6)
          .fromTo(line, { attr: { 'fill-opacity': 1, 'stroke-opacity': 0 } }, { attr: { 'fill-opacity': 0, 'stroke-opacity': 1 }, duration: D.sm, ease: E.snap }, 0.1)
          .fromTo(el, { borderColor: BORDER.neutral }, { borderColor: BORDER.valid, duration: D.sm, ease: E.out }, 0)
          // the one fact is disclosed: its bar lifts, and it turns seal red late and fast
          .fromTo(bar, { scaleX: 1 }, { scaleX: 0, duration: 0.5, ease: EASE.arrive }, 0.25)
          .fromTo(value, { color: ink }, { color: seal, duration: 0.15 }, 0.45)
      } else if (p.tone === 'invalid') {
        const reason = el.querySelector('[data-verdict-reason]')
        // abrupt: no ease-out on the colour, one nudge and never a shake loop
        tl.set(line, { attr: { 'fill-opacity': 0, 'stroke-opacity': 1 } })
          .fromTo(el, { borderColor: BORDER.neutral }, { borderColor: BORDER.invalid, duration: D.xs, ease: 'none' }, 0)
          .fromTo(el, { x: -VERIFY.nudge }, { x: 0, duration: 0.35, ease: 'power3.out' }, 0)
          .fromTo(strike, { drawSVG: '0%' }, { drawSVG: '100%', duration: D.xs, ease: 'none' }, 0)
          .fromTo(reason, { yPercent: 105 }, { yPercent: 0, duration: D.sm, ease: EASE.arrive }, 0.1)
      } else if (p.tone === 'expired') {
        const date = el.querySelector('[data-date-strike]')
        tl.fromTo(line, { attr: { 'fill-opacity': 1, 'stroke-opacity': 0 } }, { attr: { 'fill-opacity': 0, 'stroke-opacity': 1 }, duration: D.sm, ease: E.out })
          .fromTo(el, { borderColor: BORDER.neutral }, { borderColor: BORDER.expired, duration: D.sm, ease: E.out }, '<')
          .fromTo(mark, { filter: 'saturate(1)' }, { filter: 'saturate(0.2)', duration: D.md, ease: E.out }, '<')
          .fromTo(strike, { drawSVG: '0%' }, { drawSVG: '100%', duration: D.sm, ease: E.out }, '-=0.2')
          .fromTo(date, { scaleX: 0 }, { scaleX: 1, duration: D.sm, ease: EASE.arrive }, '-=0.15')
      }
    },
    { scope: root, dependencies: [result], revertOnUpdate: true },
  )

  const chipStatus: ChipStatus = p.tone
  const passed = result.checks.filter((c) => c.status === 'pass').length

  return (
    <div
      ref={root}
      className={cx('rounded-panel border bg-bone px-5 py-6 sm:px-8 sm:py-8', className)}
      style={{ borderColor: BORDER[p.tone] }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <span data-verdict-mark="" className="relative block shrink-0 self-start">
          <Mark size={56} state={p.mark.state} tone={p.mark.tone} />
          {p.tone === 'valid' && <span data-verdict-ripple="" className="pointer-events-none absolute inset-0 rounded-full border border-valid opacity-0" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <p className="t-display-m text-ink">{p.word}</p>
            <Chip status={chipStatus}>{p.code}</Chip>
          </div>

          {v.kind === 'Valid' && env ? (
            <div className="mt-5 space-y-2">
              <ClaimLine claim={v.claim} anchorHeight={v.anchorHeight} dormantSince={v.dormantSince} network={result.anchor?.network} />
              <p className="t-data text-ink-2">
                Made for you · valid until {formatDate(env.expiresAt)} · {passed} of {result.checks.length} checks passed
                {result.anchor?.network === 'demo' && ' · demo anchor'}
                {result.anchor?.network === 'testnet' && ' · Zcash testnet anchor (TAZ, no monetary value)'}
              </p>
            </div>
          ) : v.kind === 'Expired' ? (
            <p className="t-data mt-4 max-w-[72ch] text-ink-2">
              It stopped verifying at{' '}
              <span className="relative inline-block">
                {formatStamp(v.at)}
                <span data-date-strike="" className="absolute inset-x-0 top-1/2 h-px origin-left bg-current" aria-hidden />
              </span>
              . Nothing here is permanent.
            </p>
          ) : (
            p.detail && (
              <p className="t-data mt-4 max-w-[72ch] overflow-hidden text-ink-2">
                <span data-verdict-reason="" className="block">
                  {p.detail}
                </span>
              </p>
            )
          )}

          {env && v.kind !== 'Valid' && (
            <p className="t-data-sm mt-4 text-ink-3">
              It claimed: <ClaimText env={env} network={result.anchor?.network} /> — not established.
            </p>
          )}

          {env && (
            <dl className="t-data-sm mt-6 grid gap-x-8 gap-y-2 border-t border-border pt-4 text-ink-3 sm:grid-cols-[auto_1fr]">
              <dt>ANCHOR</dt>
              <dd className="text-ink-2">
                {env.anchor.ncHeight < env.anchor.height ? (
                  <>
                    notes in the chain at block {formatInt(env.anchor.ncHeight)}, unspent at block {formatInt(env.anchor.height)}
                  </>
                ) : (
                  <>block {formatInt(env.anchor.height)}</>
                )}
                {result.anchor && ` (${result.anchor.network})`} · notes <Hash value={env.anchor.ncRoot} head={8} tail={6} label="note-commitment root" scramble /> ·
                nullifiers <Hash value={env.anchor.nfRoot} head={8} tail={6} label="nullifier-set root" scramble />
              </dd>
              <dt>AUDIENCE</dt>
              <dd className="text-ink-2">
                <Hash value={env.audience} head={8} tail={6} label="audience hash" scramble />
                {v.kind === 'Valid' && audienceId && <span> · blake2b of “{audienceId}”</span>}
              </dd>
              <dt>FILE</dt>
              <dd className="text-ink-2">
                {formatInt(result.sizeBytes)} bytes · checksum{' '}
                {result.checksum ? <Hash value={result.checksum} head={8} tail={6} label="checksum" scramble /> : '—'} · checked in {result.elapsedMs.toFixed(1)} ms
              </dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}

/** Plain and unsealed: this fact has not been established. */
function ClaimText({ env, network }: { env: NonNullable<VerificationResult['envelope']>; network?: string }) {
  const p = claimParts(env.claim, network)
  return (
    <span className="text-ink-2">
      {p.before.toLowerCase()} {p.value}
      {p.after && ` ${p.after}`}
    </span>
  )
}
