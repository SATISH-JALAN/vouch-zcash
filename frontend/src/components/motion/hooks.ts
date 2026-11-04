'use client'

import type { RefObject } from 'react'
import { gsap, SplitText, useGSAP } from '@/lib/gsap'
import { D, E, EASE, MAGNET, MQ, STAGGER, motionOK } from '@/lib/motion'

/** 12.2 — masked line reveal for headings and prose. */
export function useLineReveal<T extends HTMLElement>(ref: RefObject<T | null>, start = 'top 82%') {
  useGSAP(
    (_ctx, contextSafe) => {
      const el = ref.current
      if (!el) return
      if (!motionOK()) {
        gsap.set(el, { visibility: 'visible' })
        return
      }
      let split: SplitText | null = null
      // fonts can settle after unmount; splitting a detached node would leak its trigger
      let dead = false
      const run = contextSafe!(() => {
        if (dead) return
        split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'line' })
        gsap.set(el, { visibility: 'visible' })
        gsap.from(split.lines, {
          yPercent: 108,
          duration: D.md,
          ease: E.big,
          stagger: STAGGER.line,
          scrollTrigger: { trigger: el, start, once: true },
          onComplete: () => split?.revert(),
        })
      })
      document.fonts.ready.then(run)
      return () => {
        dead = true
        split?.revert()
      }
    },
    { scope: ref },
  )
}

/**
 * Magnetic pull for one or two primary CTAs per page (MOTION.md §6.2). The shell never travels more
 * than MAGNET.max px; its label travels further, so the button has depth. Settles back, never bounces.
 */
export function useMagnetic<T extends HTMLElement>(ref: RefObject<T | null>) {
  useGSAP(
    (_ctx, contextSafe) => {
      const el = ref.current
      if (!el || !motionOK() || !window.matchMedia(`${MQ.hover} and ${MQ.desktop}`).matches) return
      const label = el.querySelector<HTMLElement>('.btn-label')
      const clamp = gsap.utils.clamp(-MAGNET.max, MAGNET.max)
      const xTo = gsap.quickTo(el, 'x', { duration: D.sm, ease: E.out })
      const yTo = gsap.quickTo(el, 'y', { duration: D.sm, ease: E.out })
      const lxTo = label ? gsap.quickTo(label, 'x', { duration: D.sm, ease: E.out }) : null
      const lyTo = label ? gsap.quickTo(label, 'y', { duration: D.sm, ease: E.out }) : null
      let pulled = false
      const onMove = contextSafe!((e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const near = Math.abs(dx) < r.width / 2 + MAGNET.radius && Math.abs(dy) < r.height / 2 + MAGNET.radius
        if (near) {
          pulled = true
          const x = clamp(dx * MAGNET.pull)
          const y = clamp(dy * MAGNET.pull)
          xTo(x)
          yTo(y)
          lxTo?.(x * MAGNET.labelDepth)
          lyTo?.(y * MAGNET.labelDepth)
        } else if (pulled) {
          pulled = false
          gsap.to(el, { x: 0, y: 0, duration: D.lg, ease: EASE.arrive })
          if (label) gsap.to(label, { x: 0, y: 0, duration: D.lg, ease: EASE.arrive })
        }
      })
      window.addEventListener('pointermove', onMove, { passive: true })
      return () => window.removeEventListener('pointermove', onMove)
    },
    { scope: ref },
  )
}
