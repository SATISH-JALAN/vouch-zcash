'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { VERIFY, motionOK } from '@/lib/motion'
import { truncateMiddle } from '@/lib/format'
import { cx } from './primitives'
import { useCopy } from './useCopy'

/**
 * Mono, middle-truncated, click-to-copy: an instrument readout. On copy a check draws on just after
 * it (outside the text, so nothing shifts) and clears after VERIFY.copyHold. `scramble` settles the
 * value once out of random hex when it first appears, as a verdict's hashes do.
 */
export function Hash({
  value,
  head = 5,
  tail = 4,
  full = false,
  className,
  label,
  scramble = false,
}: {
  value: string
  head?: number
  tail?: number
  full?: boolean
  className?: string
  label?: string
  scramble?: boolean
}) {
  const { copied, copy } = useCopy(VERIFY.copyHold * 1000)
  const text = useRef<HTMLSpanElement>(null)
  const shown = full ? value : truncateMiddle(value, head, tail)

  useGSAP(
    () => {
      if (!scramble || !motionOK() || !text.current) return
      // scrambling a value into itself: the characters not yet revealed churn as hex, then settle in order
      gsap.to(text.current, { duration: VERIFY.scramble, scrambleText: { text: shown, chars: '0123456789abcdef', speed: 0.9, revealDelay: 0.1 } })
    },
    { dependencies: [shown] },
  )

  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      title={value}
      aria-label={`Copy ${label ?? 'value'} ${value}`}
      className={cx('relative inline max-w-full cursor-copy break-all text-left font-mono text-ink-2 transition-colors duration-200 hover:text-ink', className)}
    >
      {/* keyed by the value: ScrambleText rewrites the span's contents, so React's own text node is gone
          after the first scramble; a new value gets a new span instead of an update to a detached node */}
      <span key={shown} ref={text}>
        {shown}
      </span>
      <svg viewBox="0 0 16 16" className={cx('hash-check pointer-events-none absolute left-full top-1/2 ml-1 h-[0.95em] w-[0.95em] -translate-y-1/2', copied && 'is-on')} aria-hidden>
        <path d="M3 8.6l3.3 3.3L13.2 4.8" pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only" aria-live="polite">
        {copied ? 'copied' : ''}
      </span>
    </button>
  )
}
