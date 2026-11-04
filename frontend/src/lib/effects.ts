'use client'

import { gsap, ScrollTrigger, SplitText } from '@/lib/gsap'
import { D, E, SEAM } from '@/lib/motion'

/**
 * Page-wide motion driven by data attributes, so any section gets it by markup alone:
 *  [data-rule]        full-bleed rules draw in from the left
 *  [data-parallax=n]  an oversized image drifts ±n% against the scroll
 *  [data-unveil]      a framed painting is uncovered bottom-up as the image eases out of a slight zoom
 *  [data-seam-band]   a dark band meeting paper: its top edge draws across as a hairline, then it
 *                     opens downward from that seam while its [data-seam-drift] content moves at its
 *                     own rate (MOTION.md §7.2). The edge stays hard: no gradient, no cross-fade
 * Called once per route after the page's own triggers exist; returns the cleanup.
 */
export function pageEffects(): () => void {
  const ctx = gsap.context(() => {
    ScrollTrigger.batch('[data-rule]', {
      start: 'top 96%',
      once: true,
      onEnter: (els) => gsap.to(els, { scaleX: 1, duration: D.xl, ease: E.big, stagger: 0.08 }),
    })

    for (const el of gsap.utils.toArray<HTMLElement>('[data-parallax]')) {
      const amt = parseFloat(el.dataset.parallax || '8')
      gsap.fromTo(
        el,
        { yPercent: -amt },
        { yPercent: amt, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } },
      )
    }

    for (const el of gsap.utils.toArray<HTMLElement>('[data-unveil]')) {
      const img = el.querySelector('img')
      const tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top 84%', once: true },
        onComplete: () => {
          gsap.set(el, { clipPath: 'none' }) // an explicit value: clearing it would restore the hidden pre-state
          if (img) gsap.set(img, { clearProps: 'transform' }) // hand hover back to CSS
        },
      })
      tl.fromTo(el, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 1.3, ease: 'power4.out' }, 0)
      if (img) tl.fromTo(img, { scale: 1.18 }, { scale: 1, duration: 1.6, ease: 'power4.out' }, 0)
    }

    for (const el of gsap.utils.toArray<HTMLElement>('[data-seam-band]')) {
      const drift = el.querySelectorAll('[data-seam-drift]')
      gsap
        .timeline({ scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 45%', scrub: SEAM.scrub } })
        // the band's own top row is the hairline: it draws out from the centre, then the band opens from it
        .fromTo(el, { clipPath: 'inset(0px 50% calc(100% - 1px) 50%)' }, { clipPath: 'inset(0px 0% calc(100% - 1px) 0%)', duration: 0.3, ease: 'power2.out' })
        .to(el, { clipPath: 'inset(0px 0% 0% 0%)', duration: 0.7, ease: 'power2.inOut' })
        .fromTo(drift, { y: SEAM.drift }, { y: 0, duration: 1, ease: 'none' }, 0)
    }
  })

  return () => ctx.revert()
}
