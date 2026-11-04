'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { useLineReveal } from '@/components/motion/hooks'
import { Accent, Rule, SectionHead, cx } from '@/components/ui/primitives'
import { D, E, motionOK } from '@/lib/motion'

const CELLS = [
  {
    tag: 'Exits',
    title: ['Exits', 'that clear'],
    img: '/visuals/unlock-collateral.webp',
    pos: '42% 50%',
    alt: 'Oil painting: at a bank counter a borrower hands over one sealed card; his own strongbox stays closed at his feet.',
    lines: ['A swap rail learns the coins predate block H and have not moved since.', 'And that they are the exact notes in the deposit, not a wallet history.'],
  },
  {
    tag: 'Collateral',
    title: ['Collateral', 'without custody'],
    img: '/visuals/unlock-receipts.webp',
    pos: '50% 45%',
    alt: 'Oil painting: a shopkeeper and a customer shake hands over a sealed card; her purse stays closed.',
    lines: ['A lender learns the position clears their bar, and sees it if the same coins come back twice.', 'The ZEC never leaves Zcash and nobody else holds it.'],
  },
  {
    tag: 'Reserves',
    title: ['Reserves', 'that go stale on time'],
    img: '/visuals/unlock-expire.webp',
    pos: '62% 40%',
    alt: 'Oil painting: a trader studies a sealed card beside an hourglass that has nearly run out.',
    lines: ['A treasury proves its total across many proofs, no note counted twice.', 'A Solana token mints only within it, and only while the proof is fresh.'],
  },
]

/** Three paintings, one large and two stacked, with the fact each one unlocks set over the scene. */
export function Unlocks() {
  const title = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useLineReveal(title)

  useGSAP(
    () => {
      const cards = gsap.utils.toArray<HTMLElement>('[data-card]', root.current)
      if (!motionOK()) {
        gsap.set(root.current!.querySelectorAll('[data-enter]'), { opacity: 1 })
        return
      }
      // the painting is unveiled and its words rise onto it before it has finished: they start once the
      // unveil (power4.out) has covered about 60% of its travel, so nobody waits to read
      for (const card of cards) {
        gsap.fromTo(
          card.querySelectorAll('[data-enter]'),
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, duration: D.md, ease: E.big, stagger: 0.06, delay: 0.27, scrollTrigger: { trigger: card, start: 'top 84%', once: true } },
        )
      }
    },
    { scope: root },
  )

  return (
    <section id="unlocks" aria-labelledby="unlocks-h">
      <Rule />
      <div className="wrap section">
        <SectionHead
          eyebrow="WHY IT MATTERS"
          title={
            <span id="unlocks-h">
              One fact is enough to <Accent>act on.</Accent>
            </span>
          }
          titleRef={title}
          lineReveal
        />

        <div
          ref={root}
          className="section-body grid grid-cols-1 gap-3 md:grid-cols-2 lg:h-[clamp(640px,50vw,880px)] lg:grid-cols-12 lg:grid-rows-2 lg:gap-4"
        >
          {CELLS.map((c, i) => (
            <article
              key={c.tag}
              data-card=""
              data-unveil=""
              className={cx(
                'group relative isolate flex min-h-[480px] flex-col justify-between overflow-hidden rounded-panel bg-shielded text-on-dark md:min-h-[440px] lg:min-h-0',
                i === 0 ? 'md:col-span-2 md:min-h-[600px] lg:col-span-7 lg:row-span-2' : 'lg:col-span-5',
              )}
            >
              {/* the scene: oversized for the parallax, eased up on hover */}
              <div className="absolute inset-0 -z-10 overflow-hidden">
                <div data-parallax="5" className="absolute inset-x-0 -inset-y-[7%]">
                  <Image
                    src={c.img}
                    alt={c.alt}
                    fill
                    sizes={i === 0 ? '(min-width: 1024px) 58vw, 100vw' : '(min-width: 1024px) 42vw, (min-width: 768px) 50vw, 100vw'}
                    className="object-cover transition-transform duration-[1400ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] group-hover:scale-[1.045]"
                    style={{ objectPosition: c.pos }}
                  />
                </div>
                <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_13_12/0.94)_0%,rgb(11_13_12/0.6)_34%,rgb(11_13_12/0)_66%)]" />
                <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(to_bottom,rgb(11_13_12/0.55),rgb(11_13_12/0))]" />
              </div>

              <div className="flex items-center justify-between gap-4 p-6 lg:p-8" data-enter="">
                <span className="t-pixel text-[13px] tracking-[0.14em] text-on-dark">
                  {String(i + 1).padStart(2, '0')}
                  <span className="text-on-dark-2"> / 03</span>
                </span>
                <span className="t-eyebrow inline-flex items-center gap-2.5 text-on-dark">
                  <span className="h-2 w-2 bg-seal transition-transform duration-500 group-hover:scale-150" aria-hidden />
                  {c.tag}
                </span>
              </div>

              <div className="p-6 lg:p-8 xl:p-10">
                <h3
                  data-enter=""
                  className="max-w-[16ch] font-serif text-on-dark"
                  style={{ fontSize: i === 0 ? 'clamp(38px, 3.9vw, 72px)' : 'clamp(30px, 2.4vw, 44px)', lineHeight: 1.02, letterSpacing: '-0.015em' }}
                >
                  {c.title[0]} <em className="text-on-dark/80">{c.title[1]}</em>
                </h3>
                <div data-enter="" className={cx('mt-5 max-w-[46ch] text-[15px] leading-[1.55] text-on-dark/75', i === 0 && 'lg:mt-7 lg:text-[17px]')}>
                  {c.lines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
