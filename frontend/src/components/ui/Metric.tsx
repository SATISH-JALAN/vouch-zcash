'use client'

import { DigitRoll } from '@/components/motion/DigitRoll'

export interface MetricProps {
  /** Rendered as-is without JS. */
  value: string
  /** Roll the value's digits into place when it enters (MOTION.md §7.7): for the one number that carries the argument. */
  roll?: boolean
  unit?: string
  caption: string
}

export function Metric({ value, roll, unit, caption }: MetricProps) {
  return (
    <div>
      <p className="t-numeral text-ink">
        {roll ? <DigitRoll text={value} /> : value}
        {unit && <span className="t-data-sm ml-2 align-baseline uppercase tracking-[0.12em] text-ink-2">{unit}</span>}
      </p>
      <p className="t-small mt-4 max-w-[30ch] text-ink-3">{caption}</p>
    </div>
  )
}
