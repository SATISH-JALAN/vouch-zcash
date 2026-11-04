'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E } from '@/lib/motion'
import { useIntro } from '@/lib/store'
import { Logo } from '@/components/brand/Logo'

/**
 * 12.1 — the first landing load of a session, desktop widths only (decided before paint by HEAD_SCRIPT).
 * The mark draws itself, the wordmark fades up, counter 0→100, then the overlay wipes up
 * over the hero. About 2.6s, and skippable with a click or any key.
 */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null)
  const setIntroDone = useIntro((s) => s.setIntroDone)

  useGSAP(
    (_ctx, contextSafe) => {
      const el = root.current!
      const html = document.documentElement
      if (!html.classList.contains('preload')) {
        setIntroDone()
        return
      }

      const finish = () => {
        html.classList.remove('preload')
        try {
          sessionStorage.setItem('vouch:intro', '1')
        } catch {}
      }

      const counter = el.querySelector<HTMLElement>('[data-counter]')!
      const count = { n: 0 }
      const tl = gsap.timeline({ onComplete: finish })
      const EXIT = 1.95
      tl.fromTo(el.querySelector('.v-ring'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.75, ease: E.inOut }, 0)
        .fromTo(el.querySelector('.wordmark'), { opacity: 0 }, { opacity: 1, duration: D.md, ease: E.out }, 0.95)
        .to(count, { n: 100, duration: 1.8, ease: 'power1.inOut', onUpdate: () => (counter.textContent = String(Math.round(count.n)).padStart(3, '0')) }, 0)
        .add(() => setIntroDone(), EXIT - 0.02)
        .fromTo(el, { clipPath: 'inset(0 0 0% 0)' }, { clipPath: 'inset(0 0 100% 0)', duration: D.lg * 0.95, ease: E.big }, EXIT)

      // seek() suppresses callbacks by default, so the setIntroDone above would never fire: call it here
      const skip = contextSafe!(() => {
        if (tl.time() >= EXIT) return
        setIntroDone()
        tl.seek(EXIT)
      })
      window.addEventListener('keydown', skip)
      el.addEventListener('click', skip)
      return () => {
        window.removeEventListener('keydown', skip)
        el.removeEventListener('click', skip)
      }
    },
    { scope: root },
  )

  return (
    <div
      ref={root}
      className="preloader fixed inset-0 z-[100] items-center justify-center bg-shielded text-on-dark"
      data-band="shielded"
      aria-hidden="true"
    >
      {/* the only thing on a black screen: give it room */}
      <Logo variant="stacked" surface="shielded" size={128} />
      <span data-counter className="t-data-sm absolute bottom-8 right-[var(--gutter)] text-on-dark-2">
        000
      </span>
      <span className="t-data-sm absolute bottom-8 left-[var(--gutter)] text-on-dark-2">CLICK OR PRESS ANY KEY TO SKIP</span>
    </div>
  )
}
