'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useLineReveal } from '@/components/motion/hooks'
import { Metric } from '@/components/ui/Metric'
import { Accent, Rule, SectionHead, cx } from '@/components/ui/primitives'
import { IRONWOOD_ACTIVATION, SHIELDED_POOL_USD } from '@/lib/data/chain'
import { LINKS } from '@/lib/site'
import { PLACES, StackMap } from './StackMap'

const COMPONENTS: Record<string, { lang: string; job: string }> = {
  'pof-core': { lang: 'Rust', job: 'Claim types, the proof envelope, encoding. No I/O, no network.' },
  'pof-anchor': { lang: 'Rust CLI', job: 'Rebuilds both roots from public compact blocks; checks the note-commitment root against lightwalletd.' },
  'pof-zk': { lang: 'Rust · Halo2', job: 'The delegation circuit, twice: with the threshold added, and with the notes revealed for exit certificates. No trusted setup.' },
  'pof-prove': { lang: 'Rust CLI', job: 'Reads wallet state, pins the anchors, drives the circuit: a proof, an exit certificate or a reserves batch.' },
  'pof-verify': { lang: 'Rust → WASM', job: 'Six checks, cheapest first. One implementation, compiled twice.' },
  'pof-attest': { lang: 'Rust service', job: 'Runs pof-verify and signs the verdict for chains that cannot read Zcash. Serves rails: certificates, deposit match, webhooks.' },
  'pof-gate': { lang: 'Anchor', job: 'Turns a signed attestation into a replay-protected fact on Solana.' },
  'pof-credit': { lang: 'Anchor', job: 'Example consumer: opens a credit line against a threshold receipt.' },
  'pof-reserve': { lang: 'Anchor', job: 'Turns an attested reserves batch into a feed; a token mints only within it, while it is fresh.' },
}

// The same river as the map: five pieces on the Zcash bank, two on the Solana bank, one hop between.
const BANKS = [
  { label: 'Zcash side', note: 'On the holder’s machine, and in anyone’s browser.', rows: ['pof-core', 'pof-anchor', 'pof-zk', 'pof-prove', 'pof-verify'] },
  { label: 'The crossing', note: 'The one trusted hop.', rows: ['pof-attest'] },
  { label: 'Solana side', note: 'Sees a signed verdict. Never a key, never a note.', rows: ['pof-gate', 'pof-credit', 'pof-reserve'] },
]

const LINK_ROW: { label: string; href: string | null; external?: boolean }[] = [
  { label: 'REPO', href: LINKS.repo, external: true },
  { label: 'PROOF FORMAT SPEC', href: LINKS.formatSpec },
  { label: 'VERIFIER', href: LINKS.verifier },
  { label: 'ZIP 311', href: LINKS.zip311, external: true },
  { label: 'ZCASH FORUM THREAD', href: LINKS.forum, external: true },
]

export function Stack() {
  const title = useRef<HTMLHeadingElement>(null)
  useLineReveal(title)
  const [place, setPlace] = useState<string | null>(null)
  const lit = PLACES.find((p) => p.id === place)?.components ?? []

  return (
    <section id="stack" aria-labelledby="stack-h">
      <Rule />
      <div className="wrap pb-[var(--s-top)] pt-[var(--s-top)]">
        <SectionHead eyebrow="THE STACK" title={<>Built on what <Accent>already works.</Accent></>} titleRef={title} lineReveal />

        <div className="section-body space-y-[clamp(40px,6vh,64px)]">
          <StackMap active={place} onActive={setPlace} />

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-bone px-6 pb-12 pt-9 lg:px-10">
              <Metric value={SHIELDED_POOL_USD} caption="sealed into Ironwood at activation." />
            </div>
            <div className="bg-bone px-6 pb-12 pt-9 lg:px-10">
              <Metric value={IRONWOOD_ACTIVATION} caption="Ironwood activates. Orchard is now the legacy pool; Vouch targets Ironwood." />
            </div>
            <div className="bg-bone px-6 pb-12 pt-9 lg:px-10">
              <Metric value="6" caption="verifier checks: format, expiry, revocation, audience, anchor, proof." />
            </div>
            <div className="bg-bone px-6 pb-12 pt-9 lg:px-10">
              <Metric value="0" caption="keys transmitted. The prover runs on the holder’s machine." />
            </div>
          </div>

          <VerifiedCount />
          <ComponentIndex lit={lit} />
        </div>
      </div>
    </section>
  )
}

/** Traction, counted honestly: verdicts only, never proof bytes or who asked. Only checks started on /verify count. */
function VerifiedCount() {
  const [stats, setStats] = useState<{ total: number; byVerdict: Record<string, number> } | null>(null)
  useEffect(() => {
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null))
  }, [])
  if (!stats || stats.total === 0) return null
  const valid = stats.byVerdict.Valid ?? 0
  return (
    <p className="t-data-sm -mt-6 text-ink-3" aria-live="polite">
      {stats.total.toLocaleString('en-US')} verifications run on /verify so far · {valid.toLocaleString('en-US')} valid ·{' '}
      {(stats.total - valid).toLocaleString('en-US')} refused. Only the verdict is counted.
    </p>
  )
}

function ComponentIndex({ lit }: { lit: string[] }) {
  let n = 0
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-ink pb-4">
        <p className="t-eyebrow text-ink">Components</p>
        <p className="t-data-sm text-ink-3">{String(Object.keys(COMPONENTS).length).padStart(2, '0')} pieces · 1 verifier, compiled twice</p>
      </div>

      {BANKS.map((bank) => {
        const crossing = bank.rows.includes('pof-attest')
        return (
          <div
            key={bank.label}
            className={cx(
              'grid-12 border-b border-border',
              // the crossing band bleeds a little past the grid so its text stays on the same columns
              crossing && "relative isolate border-ink before:absolute before:inset-y-0 before:-left-4 before:-right-4 before:-z-10 before:bg-bone-2 before:content-[''] lg:before:-left-6 lg:before:-right-6",
            )}
          >
            <div className="col-span-12 pb-2 pt-6 lg:col-span-3 lg:py-7 lg:pl-0">
              <p className={cx('t-eyebrow', crossing ? 'text-ink' : 'text-ink-3')}>{bank.label}</p>
              <p className="t-small mt-2 max-w-[26ch] text-ink-2">{bank.note}</p>
            </div>
            <ul className="col-span-12 lg:col-span-9">
              {bank.rows.map((name) => {
                const c = COMPONENTS[name]!
                const i = ++n
                return (
                  <li
                    key={name}
                    className={cx(
                      'group grid grid-cols-[2.25rem_1fr] items-baseline gap-x-4 gap-y-1 border-t border-border py-5 transition-colors duration-200 first:border-t-0 md:grid-cols-[2.5rem_minmax(0,0.85fr)_minmax(0,0.5fr)_minmax(0,1.5fr)] md:gap-x-6 lg:py-7',
                      lit.includes(name) && 'bg-bone-2',
                    )}
                  >
                    <span className="t-data-sm text-ink-3">{String(i).padStart(2, '0')}</span>
                    <span
                      className="font-serif leading-none text-ink transition-transform duration-300 group-hover:translate-x-1.5"
                      style={{ fontSize: 'clamp(26px, 2.1vw, 38px)', letterSpacing: '-0.01em' }}
                    >
                      {name}
                    </span>
                    <span className="t-data-sm col-start-2 uppercase tracking-[0.12em] text-ink-3 md:col-start-auto">{c.lang}</span>
                    <span className="col-start-2 max-w-[48ch] text-[15px] leading-[1.6] text-ink-2 md:col-start-auto">{c.job}</span>
                  </li>
                )
              })}
              {crossing && (
                <li className="border-t border-border py-6 md:pl-[calc(2.5rem+24px)]">
                  <p className="font-serif text-ink" style={{ fontSize: 'clamp(24px, 2vw, 34px)', lineHeight: 1.15 }}>
                    Trust-minimised, not trustless.
                  </p>
                  <p className="t-small mt-3 max-w-[72ch] text-ink-2">
                    A Solana program cannot check a Zcash fact by itself: wrong curve, no access to Zcash state. So verification by a Solana program
                    goes through an open-source attestor that runs the same verifier and signs the result. Anyone can run one; a Zcash light client on
                    Solana would remove it.
                  </p>
                </li>
              )}
            </ul>
          </div>
        )
      })}

      <nav aria-label="Project links" className="mt-8 flex flex-wrap gap-x-8 gap-y-3 lg:justify-end">
        {LINK_ROW.filter((l) => l.href).map((l) =>
          l.external ? (
            <a key={l.label} href={l.href!} target="_blank" rel="noreferrer" className="t-data-sm link-draw tracking-[0.14em] text-ink-2 hover:text-ink">
              {l.label} ↗
            </a>
          ) : (
            <Link key={l.label} href={l.href!} className="t-data-sm link-draw tracking-[0.14em] text-ink-2 hover:text-ink">
              {l.label} ↗
            </Link>
          ),
        )}
      </nav>
    </div>
  )
}
