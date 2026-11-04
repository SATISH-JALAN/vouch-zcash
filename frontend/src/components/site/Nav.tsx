'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayoutEffect, useRef, useState } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { D, EASE, MQ, motionOK } from '@/lib/motion'
import { NAV } from '@/lib/site'
import { Logo } from '@/components/brand/Logo'
import { RING, ringStroke } from '@/components/brand/Mark'
import { cx } from '@/components/ui/primitives'

/**
 * The header reads the ground beneath it (MOTION.md §6.3). Over a dark band ([data-band="shielded"])
 * it is transparent and light; over paper, a bone bar with a rule beneath. ScrollTrigger toggles on
 * the bands drive it (a band that changes its own ground, like the iris, says so with `vouch:ground`);
 * the colours crossfade over MICRO.ground.
 * On the landing page it starts below the ticker and fixes to the top as the ticker leaves; at that
 * moment the two positions coincide, so the swap never shows.
 * One dot marks the current route and slides between links. The logo answers a hover with one
 * drawn segment travelling its line: the preloader's gesture, small, once.
 */
export function Nav() {
  const pathname = usePathname()
  const landing = pathname === '/'
  const [stuck, setStuck] = useState(false)
  const [dark, setDark] = useState(landing)
  const bar = useRef<HTMLElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const mark = useRef<HTMLAnchorElement>(null)

  // the ground under the header's midline
  useGSAP(
    () => {
      const header = bar.current!
      const active = new Set<HTMLElement>()
      const read = () => setDark([...active].some((el) => el.dataset.band === 'shielded'))
      const line = () => header.offsetHeight / 2
      // a pinned band covers the screen for as long as its spacer does, not just its own height
      const box = (el: HTMLElement) => (el.parentElement?.classList.contains('pin-spacer') ? el.parentElement : el)
      const top = (el: HTMLElement) => box(el).getBoundingClientRect().top + window.scrollY
      const bands = gsap.utils
        .toArray<HTMLElement>('[data-band]')
        .filter((el) => !header.contains(el) && getComputedStyle(el).position !== 'fixed')
      const triggers = bands.map((el) =>
        ScrollTrigger.create({
          start: () => top(el) - line(),
          end: () => top(el) + box(el).offsetHeight - line(),
          // after the pins, so the spacers already have their length
          refreshPriority: -1,
          onToggle: (self) => {
            if (self.isActive) active.add(el)
            else active.delete(el)
            read()
          },
        }),
      )
      triggers.forEach((t, i) => t.isActive && active.add(bands[i]!))
      read()
      window.addEventListener('vouch:ground', read)

      // landing: fixed from the moment the ticker has scrolled away
      const ticker = document.querySelector<HTMLElement>('[data-ticker]')
      const stick = landing
        ? ScrollTrigger.create({ start: () => ticker?.offsetHeight ?? 0, end: 'max', onToggle: (self) => setStuck(self.isActive) })
        : null
      setStuck(!!stick?.isActive)

      return () => {
        window.removeEventListener('vouch:ground', read)
        triggers.forEach((t) => t.kill())
        stick?.kill()
      }
    },
    // every route has its own bands: tear the old triggers down, don't pile new ones on top
    { dependencies: [pathname], revertOnUpdate: true },
  )

  // the current-route dot slides from the link it was under (measured against the list, not the
  // viewport, so a scrolled or re-stuck header does not throw it off)
  const lastDot = useRef<number | null>(null)
  useLayoutEffect(() => {
    const ul = list.current
    const dot = ul?.querySelector<HTMLElement>('[data-nav-dot]')
    const from = lastDot.current
    const at = dot && ul ? dot.getBoundingClientRect().left - ul.getBoundingClientRect().left : null
    lastDot.current = at
    if (!dot || at === null || !motionOK()) return
    if (from === null) gsap.fromTo(dot, { scale: 0 }, { scale: 1, duration: D.sm, ease: EASE.pop })
    else if (from !== at) gsap.fromTo(dot, { x: from - at }, { x: 0, duration: D.md, ease: EASE.camera })
  }, [pathname])

  // logo hover: a segment of the line, drawn along the path once, over a faded ring
  useGSAP(
    (_ctx, contextSafe) => {
      const a = mark.current
      if (!a || !motionOK() || !window.matchMedia(MQ.hover).matches) return
      let overlay: SVGSVGElement | null = null
      const onEnter = contextSafe!(() => {
        if (overlay) return
        const svg = Array.from(a.querySelectorAll('svg')).find((s) => s.getBoundingClientRect().width > 0)
        const ring = svg?.querySelector('.v-ring')
        if (!svg || !ring) return
        const r = svg.getBoundingClientRect()
        const ns = 'http://www.w3.org/2000/svg'
        const o = document.createElementNS(ns, 'svg')
        o.setAttribute('viewBox', '0 0 32 32')
        o.setAttribute('aria-hidden', 'true')
        Object.assign(o.style, {
          position: 'fixed',
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: '60',
          color: getComputedStyle(svg).color,
        })
        const p = document.createElementNS(ns, 'path')
        p.setAttribute('d', RING)
        p.setAttribute('fill', 'none')
        p.setAttribute('stroke', 'currentColor')
        p.setAttribute('stroke-width', String(ringStroke(r.width)))
        p.setAttribute('stroke-linecap', 'round')
        o.appendChild(p)
        document.body.appendChild(o)
        overlay = o
        gsap
          .timeline({
            onComplete: () => {
              o.remove()
              overlay = null
            },
          })
          .to(ring, { opacity: 0.28, duration: 0.08, ease: 'none' }, 0)
          .fromTo(p, { drawSVG: '0% 0%' }, { drawSVG: '0% 20%', duration: 0.1, ease: 'power1.in' }, 0)
          .to(p, { drawSVG: '80% 100%', duration: 0.22, ease: 'none' })
          .to(p, { drawSVG: '100% 100%', duration: 0.08, ease: 'power1.out' })
          .to(ring, { opacity: 1, duration: 0.12, ease: 'none' }, 0.3)
      })
      a.addEventListener('pointerenter', onEnter)
      return () => {
        a.removeEventListener('pointerenter', onEnter)
        overlay?.remove()
      }
    },
    { scope: mark },
  )

  return (
    <header
      ref={bar}
      data-band={dark ? 'shielded' : undefined}
      className={cx(
        'inset-x-0 z-50 border-b transition-[background-color,border-color,color] duration-300',
        landing && !stuck && 'absolute top-10',
        landing && stuck && 'fixed top-0',
        !landing && 'sticky top-0',
        dark ? 'border-transparent bg-transparent text-on-dark' : 'border-rule bg-bone text-ink',
      )}
    >
      <nav className="wrap flex h-16 items-center justify-between gap-3 min-[400px]:gap-6" aria-label="Primary">
        <Link ref={mark} href="/" data-nav-mark="" className="nav-mark -ml-[3px] rounded-chip" aria-label="Vouch — home">
          <span className="hidden md:inline-flex">
            <Logo variant="horizontal" surface={dark ? 'shielded' : 'bone'} />
          </span>
          <span className="inline-flex md:hidden">
            <Logo variant="mark" surface={dark ? 'shielded' : 'bone'} />
          </span>
        </Link>
        {/* five links and the mark must fit 320px: tighter below 400px */}
        <ul ref={list} className="flex items-center gap-2.5 text-[13px] min-[400px]:gap-4 min-[400px]:text-[14px] sm:gap-7">
          {NAV.map((n) => {
            const current = pathname === n.href
            const tone = cx('link-draw pb-0.5', dark ? 'text-on-dark-2 hover:text-on-dark' : 'text-ink-2 hover:text-ink', current && (dark ? 'text-on-dark' : 'text-ink'))
            return (
              <li key={n.href} className={cx('relative', 'wide' in n && n.wide && 'hidden md:list-item')}>
                {'external' in n && n.external ? (
                  <a href={n.href} target="_blank" rel="noopener" className={tone}>
                    {n.label}
                    <span aria-hidden className="ml-0.5 text-[0.85em]">↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link href={n.href} aria-current={current ? 'page' : undefined} className={tone}>
                    {n.label}
                  </Link>
                )}
                {current && <span data-nav-dot="" aria-hidden className="absolute -bottom-2 left-1/2 -ml-0.5 h-1 w-1 rounded-full bg-current" />}
              </li>
            )
          })}
        </ul>
      </nav>
    </header>
  )
}
