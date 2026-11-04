'use client'

import Lenis from 'lenis'
import { gsap, ScrollTrigger } from './gsap'

let instance: Lenis | null = null
let tick: ((t: number) => void) | null = null

/** One ticker, always: GSAP drives Lenis; Lenis's own rAF is off. */
export function startLenis(): Lenis {
  if (instance) return instance
  instance = new Lenis({ lerp: 0.085, autoRaf: false })
  instance.on('scroll', ScrollTrigger.update)
  tick = (t: number) => instance?.raf(t * 1000)
  // first in every frame: anything else on the ticker (the through-line object, the cursor) reads
  // this frame's scroll, never the last one's, so a fixed layer never trails the page by a frame
  gsap.ticker.add(tick, false, true)
  gsap.ticker.lagSmoothing(0)
  return instance
}

export function stopLenis() {
  if (tick) gsap.ticker.remove(tick)
  instance?.destroy()
  instance = null
  tick = null
}

export const getLenis = () => instance

/**
 * Scroll to an element or y, through Lenis when it is running. Without Lenis (reduced motion)
 * it jumps. An element target also receives focus, so a keyboard user continues from there.
 */
export function scrollToTarget(target: string | HTMLElement | number, immediate = false) {
  const el = typeof target === 'number' ? null : typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
  if (instance) {
    instance.scrollTo(target, { immediate, offset: typeof target === 'number' ? 0 : -72, duration: 1.2 })
  } else {
    const smooth = !immediate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof target === 'number') window.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' })
    else el?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }
  if (el && !immediate) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }
}
