'use client'

import { gsap } from './gsap'
import { D, EASE, motionOK } from './motion'

const HEX = '0123456789abcdef'

/**
 * Data assembly (MOTION.md §7.6), flat and on concept: hex characters scattered across the panel
 * converge on a hash and land as it resolves (the Hash itself settles with one scramble pass).
 * 2D only, no particle library: a few dozen spans, one tween each, gone when they land.
 */
export function assembleInto(target: Element | null, around: Element | null, count = 32) {
  if (!motionOK() || !target) return
  const to = target.getBoundingClientRect()
  const field = (around ?? target).getBoundingClientRect()
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60'
  const color = getComputedStyle(target).color
  const chars = Array.from({ length: count }, (_, i) => {
    const s = document.createElement('span')
    s.textContent = HEX[Math.floor(Math.random() * 16)]!
    s.style.cssText = `position:absolute;left:0;top:0;font:500 12px var(--font-mono);color:${color}`
    layer.appendChild(s)
    return { s, i }
  })
  document.body.appendChild(layer)
  const tl = gsap.timeline({ onComplete: () => layer.remove() })
  for (const { s, i } of chars) {
    const x0 = field.left + Math.random() * field.width
    const y0 = field.top + Math.random() * field.height
    const x1 = to.left + (to.width * (i + 0.5)) / count
    tl.fromTo(
      s,
      { x: x0, y: y0, opacity: 0, rotation: gsap.utils.random(-40, 40) },
      { opacity: 0.9, duration: 0.15 },
      i * 0.012,
    ).to(s, { x: x1, y: to.top + to.height / 2 - 7, rotation: 0, duration: D.md, ease: EASE.camera }, 0.1 + i * 0.012)
  }
  tl.to(layer.children, { opacity: 0, duration: 0.18, ease: EASE.leave }, '-=0.12')
}
