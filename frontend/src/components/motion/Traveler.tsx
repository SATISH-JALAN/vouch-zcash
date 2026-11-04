'use client'

import { useRef } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { MQ, THROUGH } from '@/lib/motion'
import { SEAL_RING, SHAPES, currentSlots, onSlotsChange, type Slot } from '@/lib/through'

/**
 * The through-line object (MOTION.md §5.5): one seal, fixed above the page, that travels from slot
 * to slot and changes shape, size and colour as the argument changes. Tracking is live: every frame
 * it reads the current rects of the two slots it is between, so late fonts, pins and resizes never
 * leave it behind. Anchors (scroll ranges) are re-read only when ScrollTrigger refreshes.
 *
 * It is always full strength. It never fades through partial opacity over another colour: it
 * appears and leaves by scale, around its own centre, and its colour switches in one short step.
 * Long transits don't drag it across the sections in between: it leaves, and it arrives. A slot can
 * ask to be approached down the margin first, so the object never crosses a heading or body copy.
 * On phones it parks in the right margin while travelling. Under reduced motion it never shows.
 */
export function Traveler() {
  const root = useRef<SVGSVGElement>(null)

  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(MQ.motion, () => {
      const svg = root.current!
      const path = svg.querySelector<SVGPathElement>('[data-t-path]')!
      const bars = svg.querySelector<SVGGElement>('[data-t-bars]')!
      const ring = svg.querySelector<SVGCircleElement>('[data-t-ring]')!
      const css = getComputedStyle(document.documentElement)
      const tok = (n: string) => css.getPropertyValue(n).trim()
      const SEAL = tok('--color-seal')
      const colorOf = (s: Slot) => (s.shape === 'seal' ? SEAL : s.ground === 'dark' ? tok('--color-on-dark') : tok('--color-ink'))
      const barsOf = (s: Slot) => (s.ground === 'dark' ? tok('--color-shielded') : tok('--color-bone'))
      const inOut = gsap.parseEase('power2.inOut')
      const clamp = gsap.utils.clamp(0, 1)
      const phone = window.matchMedia(MQ.mobile)

      type Seat = { slot: Slot; a: number; b: number }
      let seats: Seat[] = []
      let morphs: (gsap.core.Tween | null)[] = []

      const measure = () => {
        morphs.forEach((m) => m?.kill())
        seats = currentSlots().map((slot) => {
          const [a, b] = slot.range()
          return { slot, a, b: Math.max(a, b) }
        })
        // one paused morph per transit; the tick sets its progress
        morphs = seats.slice(0, -1).map((s, i) => {
          const to = seats[i + 1]!.slot.shape
          return s.slot.shape === to ? null : gsap.fromTo(path, { morphSVG: SHAPES[s.slot.shape] }, { morphSVG: SHAPES[to], paused: true, ease: 'none' })
        })
        last.key = ''
      }

      const last = { t: '', o: '', key: '', fill: '', bars: '', ring: '', rw: '' }
      const held = new Map<Slot, boolean>()
      const hide = () => {
        if (last.o !== '0') svg.style.opacity = last.o = '0'
      }
      const tick = () => {
        const n = seats.length
        if (!n) return hide()
        const y = window.scrollY
        const vh = window.innerHeight
        // slots that keep a copy of the object show it from the frame the object seats on them
        for (const s of seats) {
          if (!s.slot.hold) continue
          const on = y >= s.a
          if (held.get(s.slot) !== on) {
            held.set(s.slot, on)
            s.slot.hold(on)
          }
        }
        // where are we: seated on k, or travelling from k to k+1 with progress t; `vis` scales it in and out
        let k = n - 1
        let t = 0
        let seated = true
        let vis = 1
        if (y < seats[0]!.a) return hide()
        // the first slot takes over from a painting: not until the painting has settled
        if (y <= seats[0]!.b && seats[0]!.slot.ready?.() === false) return hide()
        for (let j = 0; j < n; j++) {
          const s = seats[j]!
          if (y <= s.b) {
            if (y >= s.a) k = j
            else {
              k = j - 1
              const from = seats[k]!
              t = (y - from.b) / Math.max(1, s.a - from.b)
              seated = false
              // a long way: leave, and arrive, but don't cross everything in between
              if (s.a - from.b > THROUGH.longTransit * vh) {
                const f = THROUGH.fade * vh
                vis = Math.max(from.slot.bare ? 0 : clamp(1 - (y - from.b) / f), s.slot.bare ? 0 : clamp(1 - (s.a - y) / f))
              } else {
                // a waypoint: grow out of it, shrink into it
                if (from.slot.bare) vis = Math.min(vis, clamp(t / THROUGH.bareSpan))
                if (s.slot.bare) vis = Math.min(vis, clamp((1 - t) / THROUGH.bareSpan))
              }
            }
            break
          }
        }
        // never drawn seated on a waypoint
        if (seated && seats[k]!.slot.bare) return hide()
        // past the last slot: seated on it, then gone into the painting
        if (k === n - 1 && seated && y > seats[n - 1]!.b) vis = 1 - clamp((y - seats[n - 1]!.b) / (THROUGH.landFade * vh))
        // nothing to draw: no layout reads, and at most one write
        if (vis <= 0.02) return hide()

        // a long transit leaves from its seat and arrives at the next, scaling on each spot: it never
        // slides off a slot that keeps a copy, so there is never a second seal on the move
        const long = !seated && seats[k + 1]!.a - seats[k]!.b > THROUGH.longTransit * vh
        const e = seated ? 0 : long ? (t < 0.5 ? 0 : 1) : inOut(clamp(t))
        const A = seats[k]!.slot.el.getBoundingClientRect()
        const next = seated ? null : seats[k + 1]!.slot
        const B = next ? next.el.getBoundingClientRect() : A
        // centres, so scaling in and out stays on the spot
        let ex = e
        let ey = e
        if (next?.approach === 'vertical' && !seated) {
          // down the margin first, then across at the slot's own height
          ey = inOut(clamp(t / 0.7))
          ex = inOut(clamp((t - 0.7) / 0.3))
        }
        let cx = A.left + A.width / 2 + (B.left + B.width / 2 - (A.left + A.width / 2)) * ex
        let cy = A.top + A.height / 2 + (B.top + B.height / 2 - (A.top + A.height / 2)) * ey
        let w = A.width + (B.width - A.width) * e
        if (!seated && phone.matches) {
          // park in the margin mid-flight, so it never sits over text on a narrow screen
          const m = Math.sin(Math.PI * e)
          const size = THROUGH.marginSize
          cx += (window.innerWidth - size / 2 - 4 - cx) * m
          w += (size - w) * m
        }
        w *= vis

        // the stamp's ring keeps one hairline weight on screen, whatever the seal's size
        const rw = ((SEAL_RING.px * 100) / Math.max(w, 1)).toFixed(2)
        if (rw !== last.rw) ring.setAttribute('stroke-width', (last.rw = rw))

        const tr = `translate3d(${(cx - w / 2).toFixed(1)}px,${(cy - w / 2).toFixed(1)}px,0) scale(${(w / 100).toFixed(4)})`
        if (tr !== last.t) svg.style.transform = last.t = tr
        if (last.o !== '1') svg.style.opacity = last.o = '1'

        const key = `${k}:${e.toFixed(3)}`
        if (key === last.key) return
        last.key = key
        const here = seats[k]!.slot
        if (seated || !morphs[k]) path.setAttribute('d', SHAPES[here.shape])
        else morphs[k]!.progress(e)
        // the colour holds, then switches in one short step: no in-between colour stays on screen
        const now = seated || e < THROUGH.colorHold + THROUGH.colorSpan / 2 ? here : next!
        const fill = colorOf(now)
        if (fill !== last.fill) {
          last.fill = fill
          gsap.to(path, { attr: { fill }, duration: THROUGH.colorStep, ease: 'none', overwrite: true })
        }
        // the document's lines belong to the document, and show only while it is one
        const nearest = seated || e < 0.5 ? here : next!
        const barsOn = nearest.shape === 'doc' && (seated || Math.abs(e - (nearest === here ? 0 : 1)) < 0.3)
        // likewise the stamp's ring: only while it is a seal
        const ringOn = nearest.shape === 'seal' && (seated || Math.abs(e - (nearest === here ? 0 : 1)) < 0.3) ? '1' : '0'
        if (ringOn !== last.ring) ring.setAttribute('opacity', (last.ring = ringOn))
        const barsKey = barsOn ? barsOf(nearest) : 'off'
        if (barsKey !== last.bars) {
          last.bars = barsKey
          bars.setAttribute('opacity', barsOn ? '1' : '0')
          if (barsOn) bars.setAttribute('fill', barsKey)
        }
      }

      measure()
      ScrollTrigger.addEventListener('refresh', measure)
      const off = onSlotsChange(measure)
      gsap.ticker.add(tick)
      return () => {
        gsap.ticker.remove(tick)
        ScrollTrigger.removeEventListener('refresh', measure)
        off()
        morphs.forEach((m) => m?.kill())
        svg.style.opacity = '0'
      }
    })
    return () => mm.revert()
  })

  return (
    <svg
      ref={root}
      viewBox="0 0 100 100"
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-40 overflow-visible"
      style={{ width: 100, height: 100, transformOrigin: '0 0', opacity: 0, willChange: 'transform' }}
    >
      <path data-t-path="" d={SHAPES.seal} fill="var(--color-seal)" />
      <circle data-t-ring="" cx="50" cy="50" r={SEAL_RING.r} fill="none" stroke="var(--color-seal-bg)" strokeOpacity={0.7} opacity="0" />
      <g data-t-bars="" fill="var(--color-bone)" opacity="0">
        <rect x="32" y="30" width="34" height="5" />
        <rect x="32" y="41" width="25" height="5" />
        <rect x="32" y="52" width="32" height="5" />
        <rect x="32" y="63" width="29" height="5" />
        <rect x="32" y="74" width="19" height="5" />
      </g>
    </svg>
  )
}
