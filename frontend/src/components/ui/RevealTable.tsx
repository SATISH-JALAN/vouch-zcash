import type { ReactNode } from 'react'
import { Redact } from './Redact'

export interface LearnRow {
  label: string
  value: ReactNode
}
export interface WithheldRow {
  label: string
  /** bar width in ch — varied, like real text */
  width: number
}

/** Two columns: what they learn / what they never learn. This component alone explains the product. */
export function RevealTable({ learn, never, className }: { learn: LearnRow[]; never: WithheldRow[]; className?: string }) {
  return (
    <div className={`grid overflow-hidden rounded-panel border border-border lg:grid-cols-2 ${className ?? ''}`}>
      <div className="border-b border-border lg:border-b-0 lg:border-r">
        <p className="t-eyebrow flex h-[42px] items-center border-b border-border px-5 text-ink-2">What they learn</p>
        <dl>
          {learn.map((r) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr] items-baseline gap-4 border-b border-border px-5 py-[11px] last:border-b-0">
              <dt className="t-data-sm uppercase tracking-[0.1em] text-ink-3">{r.label}</dt>
              <dd className="t-data min-w-0 break-words text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="t-eyebrow flex h-[42px] items-center border-b border-border px-5 text-ink-2">What they never learn</p>
        <dl>
          {never.map((r) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-4 border-b border-border px-5 py-[11px] last:border-b-0">
              <dt className="t-data-sm uppercase tracking-[0.1em] text-ink-3">{r.label}</dt>
              <dd className="t-data">
                <Redact width={r.width} label={`${r.label}: withheld`} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
