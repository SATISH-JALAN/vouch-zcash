'use client'

import Image from 'next/image'
import { cx } from '@/components/ui/primitives'
import { CURSOR } from '@/lib/motion'
import type { CSSProperties } from 'react'

export interface Place {
  id: string
  label: string
  /** Components this building stands for, matched against the table below. */
  components: string[]
  note: string
  /** Label anchor, as % of the painting. */
  x: number
  y: number
}

export const PLACES: Place[] = [
  { id: 'ironwood', label: 'Ironwood Pavilion', components: ['pof-anchor'], note: 'Zcash’s shielded pool, and the source of truth. The ZEC stays here; its two roots are rebuilt from public data.', x: 24, y: 28 },
  { id: 'prover', label: 'The Prover’s Workshop', components: ['pof-prove', 'pof-zk', 'pof-core'], note: 'Runs on the holder’s own machine. Keys never leave this building.', x: 13, y: 55 },
  { id: 'verifier', label: 'The Verifier’s Hall', components: ['pof-verify'], note: 'Open to anyone. The same code runs in the CLI, the browser and the attestor.', x: 29, y: 51 },
  { id: 'attestor', label: 'Attestor’s Signal Tower', components: ['pof-attest'], note: 'Signs a verdict and wires it across the river. The one trusted hop.', x: 49, y: 48 },
  { id: 'solana', label: 'Solana Pavilion', components: ['pof-gate', 'pof-credit'], note: 'Receives the signed verdict, records it once, and acts on it: a credit line, a reserves feed.', x: 86, y: 28 },
]

const RIVER = 'No bridge crosses the river. Only a signed message does.'

/** A painted fairground with HTML labels. Hovering or tapping a label highlights its rows in the table. */
export function StackMap({ active, onActive }: { active: string | null; onActive: (id: string | null) => void }) {
  const current = PLACES.find((p) => p.id === active)
  return (
    <figure>
      {/* the aperture lens (MOTION.md §6.1): the one painting on the page people linger over */}
      <div
        className="relative overflow-hidden rounded-panel border border-border"
        data-cursor="lens"
        style={{ '--lens-r': `${CURSOR.ring / 2}px` } as CSSProperties}
        onMouseLeave={() => onActive(null)}
      >
        <Image
          src="/visuals/stack-map.webp"
          alt="Oil painting: a world's-fair ground at dusk, divided by a river. Pavilions on one bank are joined to a glass pavilion on the other only by telegraph wires; there is no bridge."
          width={1536}
          height={1024}
          sizes="(min-width: 1760px) 1760px, 100vw"
          className="h-auto w-full"
        />
        <div className="lens-veil" aria-hidden />
        {PLACES.map((p, i) => (
          <button
            key={p.id}
            type="button"
            data-cursor-label="OPEN"
            onMouseEnter={() => onActive(p.id)}
            onFocus={() => onActive(p.id)}
            onBlur={() => onActive(null)}
            onClick={() => onActive(p.id)}
            aria-pressed={active === p.id}
            aria-label={`${p.label}: ${p.note}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            className={cx(
              'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-chip border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-200 md:px-3 md:py-1.5 md:text-[11px]',
              active === p.id ? 'border-on-dark bg-on-dark text-shielded' : 'border-on-dark/40 bg-shielded/80 text-on-dark hover:border-on-dark',
            )}
          >
            <span className="md:hidden">{i + 1}</span>
            <span className="hidden md:inline">{p.label}</span>
          </button>
        ))}
      </div>
      <figcaption className="t-data-sm mt-3 flex min-h-[2.9em] flex-wrap items-baseline gap-x-3 text-ink-2" aria-live="polite">
        {current ? (
          <>
            <span className="uppercase tracking-[0.12em] text-ink">{current.label}</span>
            <span>{current.note}</span>
            {current.components.length > 0 && <span className="text-ink-3">· {current.components.join(', ')}</span>}
          </>
        ) : (
          <span>{RIVER}</span>
        )}
      </figcaption>
      <ol className="t-data-sm mt-2 grid grid-cols-1 gap-1 text-ink-3 sm:grid-cols-2 md:hidden">
        {PLACES.map((p, i) => (
          <li key={p.id}>
            {i + 1} · {p.label}
          </li>
        ))}
      </ol>
    </figure>
  )
}
