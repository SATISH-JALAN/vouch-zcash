'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { getLenis } from '@/lib/lenis'
import { CUE, motionOK } from '@/lib/motion'
import { Mark } from '@/components/brand/Mark'

const WORDS = 'SCROLL · TO · DISCLOSE · '

/**
 * The scroll cue (MOTION.md §6.5): a ring of words turning slowly around a small rosette, nudged
 * faster by the scroll. Used once, on the hero. It is one of the iris's [data-iris-lift] items, so it
 * leaves as the first pinned stage begins and comes back on the way up. Static without motion.
 */
export function ScrollCue({ className }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = root.current
      const ring = el?.querySelector<SVGGElement>('[data-cue-ring]')
      if (!el || !ring || !motionOK()) return
      let angle = 0
      let last = ''
      const tick = (_t: number, dt: number) => {
        // the iris hides it with an inline autoAlpha: reading that costs nothing, a computed style would
        if (el.style.visibility === 'hidden') return
        const v = Math.abs(getLenis()?.velocity ?? 0)
        angle = (angle + (CUE.spin + v * CUE.push * 60) * (dt / 1000)) % 360
        const tr = `rotate(${angle.toFixed(2)} 50 50)`
        if (tr !== last) ring.setAttribute('transform', (last = tr))
      }
      gsap.ticker.add(tick)
      return () => gsap.ticker.remove(tick)
    },
    { scope: root },
  )

  return (
    <div ref={root} data-iris-lift="" aria-hidden className={className}>
      <svg viewBox="0 0 100 100" className="h-24 w-24 overflow-visible">
        <defs>
          <path id="cue-path" d="M50 50 m-38 0 a38 38 0 1 1 76 0 a38 38 0 1 1 -76 0" />
        </defs>
        <g data-cue-ring="">
          <text className="fill-current font-mono" style={{ fontSize: 8.6, letterSpacing: '0.22em' }}>
            <textPath href="#cue-path" textLength="236">
              {WORDS}
            </textPath>
          </text>
        </g>
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <Mark size={22} tone="shielded" />
      </span>
    </div>
  )
}
