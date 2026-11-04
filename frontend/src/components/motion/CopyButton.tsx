'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { EASE, VERIFY, motionOK } from '@/lib/motion'
import { useCopy } from '@/components/ui/useCopy'

// two sheets, one behind the other; and the check they become
const COPY = 'M5.5 5.5V2.5h8v8h-3 M2.5 5.5h8v8h-8Z'
const CHECK = 'M3 8.6l3.3 3.3L13.2 4.8'

/**
 * Every copy control (MOTION.md §6.4): the icon morphs from copy to check, the label scrambles to
 * "Copied", and both return after VERIFY.copyHold. The label's width is reserved for the longer of
 * the two words, so nothing beside it moves. Screen readers hear "copied" once.
 */
export function CopyButton({ value, label, done = 'Copied', className }: { value: string; label: string; done?: string; className?: string }) {
  const { copied, copy } = useCopy(VERIFY.copyHold * 1000)
  const root = useRef<HTMLButtonElement>(null)
  const first = useRef(true)

  useGSAP(
    () => {
      if (first.current) {
        first.current = false
        return
      }
      const el = root.current!
      const icon = el.querySelector<SVGPathElement>('[data-copy-icon]')!
      const text = el.querySelector<HTMLElement>('[data-copy-text]')!
      const next = copied ? done : label
      if (!motionOK()) {
        text.textContent = next
        icon.setAttribute('d', copied ? CHECK : COPY)
        return
      }
      gsap.to(icon, { morphSVG: copied ? CHECK : COPY, duration: 0.3, ease: EASE.arrive, overwrite: true })
      gsap.to(text, { duration: VERIFY.scramble * 0.8, scrambleText: { text: next, chars: 'lowerCase', speed: 0.6 }, overwrite: true })
    },
    { scope: root, dependencies: [copied] },
  )

  return (
    <button ref={root} type="button" className={className} onClick={() => void copy(value)}>
      <svg viewBox="0 0 16 16" width="14" height="14" className="shrink-0 overflow-visible" aria-hidden>
        <path data-copy-icon="" d={COPY} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="btn-label inline-grid">
        <span className="invisible col-start-1 row-start-1" aria-hidden>
          {done.length > label.length ? done : label}
        </span>
        <span data-copy-text="" className="col-start-1 row-start-1">
          {label}
        </span>
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'copied' : ''}
      </span>
    </button>
  )
}
