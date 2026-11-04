'use client'

import { gsap } from './gsap'
import { D, EASE, motionOK } from './motion'

/**
 * A dropped file's name, flown from where it was dropped to where its contents land (MOTION.md §6.4):
 * the token appears under the pointer, travels to the target's top-left corner, and hands over to
 * what the target now shows. Decorative, and skipped without motion.
 */
export function flyToken(name: string, from: { x: number; y: number }, target: Element | null) {
  if (!motionOK() || !target) return
  const token = document.createElement('div')
  token.className = 'drop-token'
  token.setAttribute('aria-hidden', 'true')
  token.textContent = name
  document.body.appendChild(token)
  const to = target.getBoundingClientRect()
  const w = token.offsetWidth
  const h = token.offsetHeight
  gsap
    .timeline({ onComplete: () => token.remove() })
    .fromTo(token, { x: from.x - w / 2, y: from.y - h / 2, scale: 1.08 }, { scale: 1, duration: 0.12, ease: 'power2.out' })
    .to(token, { x: to.left + 14, y: to.top + 12, duration: D.md, ease: EASE.camera })
    .to(token, { opacity: 0, duration: 0.2, ease: EASE.leave }, '-=0.08')
}
