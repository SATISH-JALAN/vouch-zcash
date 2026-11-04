'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { CURSOR, MICRO, MQ, motionOK } from '@/lib/motion'

/**
 * A dot that follows the pointer (MOTION.md §6.1). The system cursor always stays: the dot rides
 * with it, a little behind, and is never hidden while a mouse is over the page. It inverts whatever
 * is under it (a difference blend), so it reads the same on paper, on the dark bands and on the
 * paintings, and it re-reads what is under it as the page scrolls, not only when the pointer moves.
 * Components declare, they don't run cursor logic:
 *   data-cursor="lens"         a painting worth lingering on: a thin ring as well, and the painting
 *                              veiled everywhere except under it (the element supplies a .lens-veil)
 *   data-cursor="seal"         red underneath: no blend (difference would turn the seal cyan)
 *   data-cursor-label="TOP"    a target with no words of its own: the ring carries a short label
 * Links and buttons grow the dot into a disc. Fine pointer only. Off under reduced motion.
 */

type State = 'dot' | 'hover' | 'lens' | 'label' | 'seal'

const TARGETS =
  '[data-cursor-label], [data-cursor], .btn, button, [role="button"], a, label, summary, select, input:not([type=text]):not([type=search]):not([type=email]):not([type=url]):not([type=tel]):not([type=password]):not([type=number]), .text-seal'

const TYPING = 'textarea, [contenteditable=""], [contenteditable="true"], input:is([type=text], [type=search], [type=email], [type=url], [type=tel], [type=password], [type=number], :not([type]))'

function classify(t: Element | null): { state: State; el: HTMLElement | null; label: string } {
  // a field you type in keeps the plain dot, even inside a clickable label
  if (t?.closest(TYPING)) return { state: 'dot', el: null, label: '' }
  const el = t?.closest<HTMLElement>(TARGETS) ?? null
  if (!el) return { state: 'dot', el: null, label: '' }
  const label = el.dataset.cursorLabel
  if (label) return { state: 'label', el, label }
  const declared = el.dataset.cursor
  if (declared === 'lens') return { state: 'lens', el, label: '' }
  if (declared === 'seal' || el.classList.contains('text-seal')) return { state: 'seal', el, label: '' }
  if (declared === 'none') return { state: 'dot', el: null, label: '' }
  return { state: 'hover', el, label: '' }
}

export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (!motionOK() || !window.matchMedia(MQ.hover).matches) return
    const d = dot.current!
    const r = ring.current!
    const l = label.current!

    // Drawn state. The ticker is the only writer of transforms; tweens only move these numbers.
    const size = (st: State) => (st === 'hover' ? 1 : CURSOR.dot / CURSOR.hover)
    const s = { dot: size('dot'), ring: 0, shown: 0 }
    const target = { x: -100, y: -100 }
    const pos = { x: -100, y: -100 }
    let state: State = 'dot'
    let lensEl: HTMLElement | null = null
    // the element the current state was set for (any state, not only the lens): a probe that finds
    // the same state on the same element changes nothing
    let stateEl: HTMLElement | null = null
    let stateText = ''
    const last = { dx: '', rx: '', ro: '', lx: '', ly: '', scroll: -1, probe: 0 }

    const setState = (next: State, el: HTMLElement | null, text: string) => {
      if (next === state && el === stateEl && text === stateText) return
      stateEl = el
      stateText = text
      if (lensEl && lensEl !== el) lensEl.classList.remove('is-lens')
      lensEl = next === 'lens' ? el : null
      lensEl?.classList.add('is-lens')
      state = next
      d.dataset.state = r.dataset.state = next
      l.textContent = next === 'label' ? text : ''
      gsap.to(s, { dot: size(next), ring: next === 'lens' || next === 'label' ? 1 : 0, duration: MICRO.cursor, ease: 'expo.out', overwrite: 'auto' })
    }
    // what is under the pointer: on crossing onto an element, and whenever the page moves under it
    const probe = (t?: Element | null) => {
      const c = classify(t === undefined ? document.elementFromPoint(target.x, target.y) : t)
      setState(c.state, c.el, c.label)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        if (s.shown) gsap.to(s, { shown: 0, duration: MICRO.cursor, overwrite: 'auto' })
        return
      }
      target.x = e.clientX
      target.y = e.clientY
      if (!s.shown) {
        pos.x = target.x
        pos.y = target.y
        gsap.to(s, { shown: 1, duration: MICRO.cursor, overwrite: 'auto' })
      }
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') probe(e.target as Element | null)
    }
    // only when the pointer really leaves the window: the system cursor goes, and so does the dot
    const onOut = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !e.relatedTarget) gsap.to(s, { shown: 0, duration: MICRO.cursor, overwrite: 'auto' })
    }

    const tick = (t: number, dt: number) => {
      // CURSOR.lerp of the way per 60fps frame, whatever the real frame rate
      const k = 1 - Math.pow(1 - CURSOR.lerp, dt / (1000 / 60))
      pos.x += (target.x - pos.x) * k
      pos.y += (target.y - pos.y) * k
      // the page scrolled under a still pointer, or a pin moved something: read what is there now
      if (s.shown && (window.scrollY !== last.scroll || t - last.probe > 0.25)) {
        last.scroll = window.scrollY
        last.probe = t
        probe()
      }
      const x = pos.x.toFixed(1)
      const y = pos.y.toFixed(1)
      const dx = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(${(s.dot * s.shown).toFixed(3)})`
      const rx = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(${(0.6 + 0.4 * s.ring).toFixed(3)})`
      if (dx !== last.dx) d.style.transform = last.dx = dx
      const ro = (s.ring * s.shown).toFixed(3)
      if (rx !== last.rx) r.style.transform = last.rx = rx
      if (ro !== last.ro) r.style.opacity = last.ro = ro
      if (lensEl) {
        const b = lensEl.getBoundingClientRect()
        const lx = `${(pos.x - b.left).toFixed(1)}px`
        const ly = `${(pos.y - b.top).toFixed(1)}px`
        if (lx !== last.lx) lensEl.style.setProperty('--lx', (last.lx = lx))
        if (ly !== last.ly) lensEl.style.setProperty('--ly', (last.ly = ly))
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerover', onOver, { passive: true })
    document.addEventListener('pointerout', onOut, { passive: true })
    gsap.ticker.add(tick)
    return () => {
      gsap.ticker.remove(tick)
      lensEl?.classList.remove('is-lens')
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
    }
  })

  return (
    <>
      <div
        ref={ring}
        aria-hidden
        className="cursor-ring pointer-events-none fixed left-0 top-0 z-[99] flex items-center justify-center rounded-full opacity-0"
        style={{ width: CURSOR.ring, height: CURSOR.ring, willChange: 'transform, opacity' }}
      >
        {/* under the ring, never inside it: the ring frames the target, and the target stays legible */}
        <span ref={label} className="t-data-sm absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[9px] tracking-[0.12em]" />
      </div>
      <div
        ref={dot}
        aria-hidden
        className="cursor-dot pointer-events-none fixed left-0 top-0 z-[99] rounded-full"
        style={{ width: CURSOR.hover, height: CURSOR.hover, transform: 'scale(0)', willChange: 'transform' }}
      />
    </>
  )
}
