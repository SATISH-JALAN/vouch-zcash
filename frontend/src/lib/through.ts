'use client'

/**
 * The through-line object (MOTION.md §5.5): one seal that travels the landing page, changing shape
 * as the argument changes. Sections don't know about the object; they register a slot for it:
 * an element to sit on, the scroll range to sit there, and the shape to be while seated.
 * The Traveler reads the registry whenever ScrollTrigger refreshes, and tracks the slots live.
 */

export type Shape = 'seal' | 'doc'

export interface Slot {
  el: HTMLElement
  shape: Shape
  /** the scroll range (px) in which the object sits on this slot; outside it, it travels */
  range: () => [number, number]
  /** the ground the slot sits on: a document on a dark band is drawn light */
  ground?: 'paper' | 'dark'
  /**
   * How the object arrives here. 'vertical' travels down the margin it left from, then across at the
   * slot's own height, so it never passes over the headings and copy in between.
   */
  approach?: 'direct' | 'vertical'
  /**
   * A waypoint only: the object is never drawn seated here (the painting's own wax is the seal), it
   * scales up as it leaves and down as it arrives
   */
  bare?: boolean
  /** the first slot only: whether the thing the object takes over from has finished moving */
  ready?: () => boolean
  /**
   * A slot that draws its own copy of the object (a root that stays once the object moves on) is
   * told from the object's own frame when to show it: from the moment the object seats here, and
   * not before. Two clocks would let the copy and the object come apart; one can't.
   */
  hold?: (on: boolean) => void
}

const slots = new Map<number, Slot>()
const EVENT = 'vouch:slots'

export function registerSlot(index: number, slot: Slot) {
  slots.set(index, slot)
  window.dispatchEvent(new Event(EVENT))
  return () => {
    if (slots.get(index) === slot) slots.delete(index)
    window.dispatchEvent(new Event(EVENT))
  }
}

export function currentSlots(): Slot[] {
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s)
}

export function onSlotsChange(fn: () => void) {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/**
 * A pressed wax seal's outline, in a 100×100 box: an even scalloped edge, the way wax spreads under
 * a stamp. Deterministic, so the root and the object match. It is fitted to an exact 88×88 square on
 * the box's centre, so it sits dead centre in a ring and matches a painted seal by size.
 */
function blob() {
  const n = 96
  const raw: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    // twelve rounded lobes meeting in soft notches
    const r = 42 + 3.2 * Math.sqrt(Math.abs(Math.cos(6 * (a + Math.PI / 2))))
    raw.push([r * Math.cos(a), r * Math.sin(a)])
  }
  const xs = raw.map((p) => p[0])
  const ys = raw.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const fit = (v: number, lo: number, hi: number) => 50 + ((v - (lo + hi) / 2) * 88) / (hi - lo)
  const pts = raw.map(([x, y]) => [fit(x, x0, x1), fit(y, y0, y1)] as const)
  // a smooth closed curve through the points (Catmull-Rom as cubics): wax, not a polygon
  const f = (v: number) => v.toFixed(2)
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + n) % n]!, pts[i]!, pts[(i + 1) % n]!, pts[(i + 2) % n]!]
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d} Z`
}

/** The ring pressed into the wax by the stamp, in the same 100×100 box. */
export const SEAL_RING = { r: 29, px: 1.3 } as const

export const SHAPES: Record<Shape, string> = {
  seal: blob(),
  // a page with one corner folded: the document every fact comes out of
  doc: 'M24 6 L64 6 L80 22 L80 94 L24 94 Z',
}
