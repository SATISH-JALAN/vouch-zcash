'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { motionOK } from '@/lib/motion'
import { CLOSING_ART } from '@/lib/heroArt'
import { registerSlot } from '@/lib/through'
import { useLineReveal } from '@/components/motion/hooks'
import { Accent } from '@/components/ui/primitives'
import { BtnLabel } from '@/components/motion/BtnLabel'

/**
 * The last screen before the footer: one lit card above the door, a crowd watching it.
 * The through-line object lands exactly on the painted seal and disappears into it, so the painting
 * holds still (no parallax) and the landing slot is placed from its cover-fit geometry.
 */
export function Closing() {
  const title = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLElement>(null)
  useLineReveal(title)

  useGSAP(
    () => {
      const section = root.current!
      const plate = section.querySelector<HTMLElement>('[data-closing-plate]')!
      const slot = section.querySelector<HTMLElement>('[data-closing-slot]')!
      if (!motionOK()) return
      const place = () => {
        const W = plate.clientWidth
        const H = plate.clientHeight
        const a = CLOSING_ART
        const s = Math.max(W / a.w, H / a.h)
        const rw = a.w * s
        const rh = a.h * s
        const d = a.wax * rw
        gsap.set(slot, { left: (W - rw) * a.position[0] + a.seal[0] * rw - d / 2, top: (H - rh) * a.position[1] + a.seal[1] * rh - d / 2, width: d, height: d })
      }
      place()
      ScrollTrigger.addEventListener('refreshInit', place)
      const st = ScrollTrigger.create({ trigger: slot, start: 'center center' })
      const unslot = registerSlot(3, { el: slot, shape: 'seal', bare: true, range: () => [st.start, st.start] })
      return () => {
        ScrollTrigger.removeEventListener('refreshInit', place)
        unslot()
      }
    },
    { scope: root },
  )

  return (
    <section ref={root} data-band="shielded" data-seam-band="" aria-labelledby="closing-h" className="relative isolate overflow-hidden bg-shielded text-on-dark">
      <div data-closing-plate="" className="absolute inset-0 -z-10">
        <Image
          src="/visuals/closing.webp"
          alt="Oil painting: at night a crowd faces a glowing pavilion; above its door hangs a single card sealed in red wax, and every other window is curtained."
          fill
          sizes="100vw"
          className="object-cover object-[50%_0%]"
        />
        {/* the painted seal: where the through-line object lands */}
        <span data-closing-slot="" aria-hidden className="pointer-events-none absolute" />
      </div>
      <div className="absolute inset-0 -z-10 bg-shielded/35" aria-hidden />
      <div data-seam-drift="" className="wrap flex min-h-[clamp(620px,50vw,880px)] flex-col items-center justify-between pb-[clamp(48px,5vw,80px)] pt-[clamp(56px,6vw,104px)] text-center">
        <h2 ref={title} id="closing-h" data-line-reveal="" className="t-display-l max-w-[16ch] text-on-dark lg:max-w-none">
          Prove one thing. <Accent>Keep the rest.</Accent>
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/verify" className="btn btn-on-dark">
            <BtnLabel>Verify a proof</BtnLabel>
          </Link>
          <Link href="/request" className="btn btn-ghost-dark bg-shielded/40">
            <BtnLabel>Request a proof</BtnLabel>
          </Link>
        </div>
      </div>
    </section>
  )
}
