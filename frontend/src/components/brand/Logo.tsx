import type { CSSProperties } from 'react'
import { BRAND } from '@/lib/site'
import { Mark, type MarkState } from './Mark'

// The wordmark lives here and only here. A rename is this file plus the OG headline.
export function Wordmark({ size = 14, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={`wordmark ${className ?? ''}`} style={{ fontSize: size, ...style }}>
      {BRAND.toUpperCase()}
    </span>
  )
}

type Variant = 'horizontal' | 'stacked' | 'mark'

interface LogoProps {
  variant?: Variant
  /** Mark size in px. Horizontal default 24, stacked 60. */
  size?: number
  surface?: 'bone' | 'shielded'
  state?: MarkState
  className?: string
}

/**
 * Lockups (§6.4). Clear space = one bar height (2.4/32 of the mark) on every side.
 * The horizontal wordmark is centred on bar 3 (y 16–18.4 of 32), not on the bounding box.
 */
export function Logo({ variant = 'horizontal', size, surface = 'bone', state = 'sealed', className }: LogoProps) {
  const tone = surface === 'shielded' ? 'shielded' : 'bone'
  const color = surface === 'shielded' ? 'var(--color-on-dark)' : 'var(--color-ink)'

  if (variant === 'mark') {
    const s = size ?? 24
    return <Mark size={s} tone={tone} state={state} className={className} title={BRAND} />
  }

  if (variant === 'stacked') {
    const s = size ?? 60
    return (
      <span className={`inline-flex flex-col items-center ${className ?? ''}`} style={{ gap: (18 / 60) * s, color, padding: (2.4 / 32) * s }}>
        <Mark size={s} tone={tone} state={state} />
        <Wordmark size={(12 / 60) * s} />
      </span>
    )
  }

  const s = size ?? 24
  return (
    <span className={`inline-flex items-center ${className ?? ''}`} style={{ gap: (12 / 24) * s, color, padding: (2.4 / 32) * s }} aria-label={BRAND}>
      <Mark size={s} tone={tone} state={state} />
      <Wordmark size={(14 / 24) * s} />
    </span>
  )
}
