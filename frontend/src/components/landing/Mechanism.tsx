'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { EASE, IRIS, MQ, TREE } from '@/lib/motion'
import { onMeaningfulResize } from '@/lib/resize'
import { registerSlot, SEAL_RING, SHAPES } from '@/lib/through'
import { Mark } from '@/components/brand/Mark'
import { Accent, Rule, SectionHead, TrustNote } from '@/components/ui/primitives'

const STAGES = [
  {
    title: 'Pin a moment',
    img: '/visuals/step-1-pin.webp',
    alt: 'Oil painting: a gloved hand stops a brass chronometer at one moment.',
    body: 'The prover takes a snapshot of the chain at one finalised block. Every proof is “as of” that block, which is what makes it checkable and what makes it expire honestly. For “unmoved since”, the notes must also be in the tree at an earlier block the verifier names.',
  },
  {
    title: 'Locate the notes',
    img: '/visuals/step-2-locate.webp',
    alt: 'Oil painting: a clerk on a ladder threads a path through an archive of pigeonholes.',
    body: 'With keys derived from your seed, the prover finds your notes in that snapshot, builds a path from each one to it, and shows each is unspent without revealing it. This ties the claim to real, on-chain money.',
  },
  {
    title: 'Sign without sending',
    img: '/visuals/step-3-sign.webp',
    alt: 'Oil painting: a letter is signed, then placed in a drawer instead of the post.',
    body: 'The prover reads your seed from a local file and signs with the spending key it derives. The seed never leaves your machine. The result is transaction-shaped and is never broadcast.',
  },
  {
    title: 'Produce the proof',
    img: '/visuals/step-4-seal.webp',
    alt: 'Oil painting: a notary presses a brass seal into red wax on a single card.',
    body: 'Claim, audience, expiry and evidence are packed into one file. For a threshold, the amount is proven to clear the bar without being revealed.',
  },
]

const NS = 'http://www.w3.org/2000/svg'

/**
 * The anchor tree (MOTION.md §5.2), in one pinned diagram rather than four cards. The through-line
 * seal arrives as the root; a ring draws around it, edges grow down into the four rosette nodes,
 * each node inks in as its edge reaches it, and the four paintings open in turn inside ellipses that
 * match their oval vignettes, counted 01 / 04. The step text is readable throughout.
 * Below 1024px it is a numbered list. Reduced motion: the whole tree drawn, nothing pinned.
 */
export function Mechanism() {
  const pin = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ motion: `${MQ.desktop} and ${MQ.motion}`, still: `${MQ.desktop} and (prefers-reduced-motion: reduce)` }, (ctx) => {
        const el = pin.current!
        if (ctx.conditions?.still) {
          const g = grow(el)
          g.final()
          return () => g.clear()
        }
        let stage = build(el)
        const off = onMeaningfulResize(() => {
          stage.revert()
          stage = build(el)
          ScrollTrigger.refresh()
        })
        return () => {
          off()
          stage.revert()
        }
      })
      return () => mm.revert()
    },
    { scope: pin },
  )

  return (
    <section id="mechanism" aria-labelledby="mechanism-h">
      <Rule />
      <div ref={pin} className="lg:flex lg:min-h-screen lg:flex-col lg:justify-center lg:pt-16">
        <div className="wrap pt-[var(--s-top)] lg:py-10">
          <SectionHead eyebrow="FOUR STEPS" title={<span id="mechanism-h">A proof is a transaction that is <Accent>never sent.</Accent></span>} className="[&_h2]:lg:max-w-none" />

          <div className="mt-[var(--s-content)] lg:mt-8">
            {/* the tree: desktop only. The root above, the four rosette nodes on each column's left edge. */}
            <div data-tree="" className="relative mb-8 hidden h-[112px] lg:block" aria-hidden>
              <svg data-tree-lines="" className="absolute inset-0 h-full w-full overflow-visible" />
              <span data-tree-root="" className="pointer-events-none absolute" style={{ width: TREE.rootSize, height: TREE.rootSize }} />
              <div className="absolute bottom-0 left-0 h-[28px]" style={{ width: 'calc(75% + 18px)' }}>
                {STAGES.map((_, i) => (
                  <span
                    key={i}
                    data-tree-node=""
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-bone px-1.5"
                    style={{ left: `${(i / 3) * 100}%` }}
                  >
                    <span className="relative block">
                      <Mark size={28} tone="decorative" />
                      {/* the inked mark on top, drawn in as its edge arrives */}
                      <span data-node="" className="absolute inset-0">
                        <Mark size={28} tone="bone" />
                      </span>
                    </span>
                  </span>
                ))}
              </div>
              {/* stage progress: the pin will end */}
              <p className="t-data-sm absolute bottom-1 right-0 flex items-center gap-3 text-ink-3">
                <span>
                  <span data-tree-count="" className="text-ink">
                    04
                  </span>{' '}
                  / 04
                </span>
                <span className="flex gap-1">
                  {STAGES.map((_, i) => (
                    <span key={i} className="block h-px w-5 bg-rule">
                      <span data-tree-dash="" className="block h-full origin-left bg-ink" />
                    </span>
                  ))}
                </span>
              </p>
            </div>

            <ol className="grid gap-y-10 lg:grid-cols-4 lg:gap-x-6">
              {STAGES.map((s, i) => (
                <li key={s.title} className="grid grid-cols-1 gap-x-5 border-t border-border pt-6 md:grid-cols-[220px_1fr] md:gap-x-8 lg:block lg:border-t-0 lg:pt-0">
                  <div data-leaf="" className="relative mb-5 w-full min-w-0 max-w-[260px] md:row-span-3 md:mb-0 md:max-w-none lg:mb-5 lg:w-fit lg:max-w-full">
                    <Image src={s.img} alt={s.alt} width={480} height={600} unoptimized className="h-auto w-full lg:h-[clamp(240px,calc(100vh-624px),460px)] lg:w-auto lg:max-w-full lg:object-contain lg:object-left" />
                  </div>
                  <p className="t-data-sm text-ink-3">{String(i + 1).padStart(2, '0')}</p>
                  <h3 className="t-display-m mt-2 text-ink">{s.title}</h3>
                  <p className="t-small mt-3 max-w-[36ch] text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="wrap pb-[var(--s-end)] pt-12 lg:pt-0">
        <TrustNote label="NO BROADCAST">Nothing is broadcast. The prover reads your seed from a local file, builds and signs the transaction on your machine, and discards it. The seed never leaves your machine.</TrustNote>
      </div>
    </section>
  )
}

/** Lays the tree out against the live DOM: the root centred over the nodes, one curved edge to each. */
function grow(el: HTMLElement) {
  const tree = el.querySelector<HTMLElement>('[data-tree]')!
  const svg = tree.querySelector<SVGSVGElement>('[data-tree-lines]')!
  const slot = tree.querySelector<HTMLElement>('[data-tree-root]')!
  const nodes = gsap.utils.toArray<HTMLElement>('[data-tree-node]', tree)
  const inks = gsap.utils.toArray<HTMLElement>('[data-node]', tree)
  const dashes = gsap.utils.toArray<HTMLElement>('[data-tree-dash]', tree)
  const count = tree.querySelector<HTMLElement>('[data-tree-count]')!
  const leaves = gsap.utils.toArray<HTMLElement>('[data-leaf]', el)

  const box = tree.getBoundingClientRect()
  const at = nodes.map((n) => {
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }
  })
  const R = TREE.rootSize / 2
  const cx = (at[0]!.x + at[at.length - 1]!.x) / 2
  const cy = R
  gsap.set(slot, { left: cx - R, top: 0 })

  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
  svg.replaceChildren()
  const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
    const n = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
    svg.appendChild(n)
    return n
  }
  const ink = 'var(--color-ink)'
  // the seal, and the ring the stamp pressed into it
  const k = TREE.rootSize / 100
  const root = make('g', { transform: `translate(${cx - R} ${cy - R}) scale(${k})` })
  const wax = document.createElementNS(NS, 'path')
  wax.setAttribute('d', SHAPES.seal)
  wax.setAttribute('fill', 'var(--color-seal)')
  const press = document.createElementNS(NS, 'circle')
  for (const [a, v] of Object.entries({ cx: 50, cy: 50, r: SEAL_RING.r, fill: 'none', stroke: 'var(--color-seal-bg)', 'stroke-opacity': 0.7, 'stroke-width': SEAL_RING.px / k }))
    press.setAttribute(a, String(v))
  root.append(wax, press)
  const ring = make('circle', { cx, cy, r: R + TREE.ringGap, fill: 'none', stroke: ink, 'stroke-width': 1 })
  const y0 = cy + R + TREE.ringGap
  const edges = at.map((p) => {
    const y1 = p.y - 14
    const mid = (y0 + y1) / 2
    return make('path', { d: `M${cx} ${y0} C${cx} ${mid} ${p.x} ${mid} ${p.x} ${y1}`, fill: 'none', stroke: ink, 'stroke-width': 1 })
  })
  // dash of L+2 with a gap of L+24, offset L+12: no stub shows before a line starts drawing (§5.2),
  // and a closed ring has no nick where it meets itself (the measured length runs a little short)
  const hide = (p: SVGGeometryElement) => {
    const L = p.getTotalLength()
    gsap.set(p, { strokeDasharray: `${L + 2} ${L + 24}`, strokeDashoffset: L + 12 })
  }

  return {
    root,
    ring,
    edges,
    inks,
    dashes,
    count,
    leaves,
    slot,
    hide,
    /** everything drawn: reduced motion */
    final() {
      gsap.set(dashes, { scaleX: 1 })
      count.textContent = '04'
    },
    clear() {
      svg.replaceChildren()
    },
  }
}

function build(el: HTMLElement) {
  return gsap.context(() => {
    const g = grow(el)
    // the first painting opens while the lower edges are still drawing, so the band between the tree
    // and the step titles is never empty for more than a moment
    const LEAF = 0.95
    const EACH = 0.8
    ;[g.ring, ...g.edges].forEach(g.hide)
    gsap.set(g.root, { opacity: 0 })
    gsap.set(g.inks, { opacity: 0, scale: 0.6, transformOrigin: '50% 50%' })
    gsap.set(g.dashes, { scaleX: 0 })
    gsap.set(g.leaves, { clipPath: 'ellipse(0% 0% at 50% 50%)' })
    g.count.textContent = '00'

    const tl = gsap.timeline({ defaults: { ease: EASE.scrub } })
    tl.to(g.ring, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' }, 0.1)
      .to(g.edges, { strokeDashoffset: 0, duration: 0.8, stagger: 0.12, ease: 'power2.inOut' }, 0.5)
    g.inks.forEach((n, i) => tl.to(n, { opacity: 1, scale: 1, duration: 0.3, ease: EASE.pop }, 0.5 + 0.8 + i * 0.12))
    g.leaves.forEach((leaf, i) => {
      const t = LEAF + i * EACH
      tl.to(leaf, { clipPath: 'ellipse(75% 75% at 50% 50%)', duration: 0.7, ease: 'power3.out' }, t).to(g.dashes[i]!, { scaleX: 1, duration: 0.5 }, t)
    })
    tl.to({}, { duration: 0.4 })

    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: TREE.pin,
      pin: true,
      scrub: IRIS.scrub,
      animation: tl,
      onToggle: (self) => gsap.set(g.leaves, { willChange: self.isActive ? 'clip-path' : 'auto' }),
    })
    let shown = -1
    tl.eventCallback('onUpdate', () => {
      const n = Math.max(0, Math.min(4, Math.floor((tl.time() - LEAF) / EACH) + 1))
      if (n !== shown) g.count.textContent = String((shown = n)).padStart(2, '0')
    })

    // approached down the margin, then across at the root's own height: it never crosses the heading
    // the drawn root shows under the object from the frame it seats, and stays once it moves on
    const unslot = registerSlot(2, {
      el: g.slot,
      shape: 'seal',
      approach: 'vertical',
      range: () => [st.start, st.end],
      hold: (on) => gsap.set(g.root, { opacity: on ? 1 : 0 }),
    })
    return () => {
      unslot()
      g.clear()
    }
  }, el)
}
