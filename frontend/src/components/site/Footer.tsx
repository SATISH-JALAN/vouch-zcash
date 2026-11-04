'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { scrollToTarget } from '@/lib/lenis'
import { motionOK } from '@/lib/motion'
import { LINKS, SUBMISSION } from '@/lib/site'

const LINKS_ROW: { href: string; label: string; external?: boolean }[] = [
  { href: '/verify', label: 'Verify' },
  { href: '/request', label: 'Request' },
  { href: '/prove', label: 'Prove' },
  { href: '/rail', label: 'Rail' },
  { href: '/reserves', label: 'Reserves' },
  { href: '/demo', label: 'Demo' },
  { href: '/docs', label: 'Docs', external: true },
  { href: LINKS.zip311, label: 'ZIP 311', external: true },
  ...(LINKS.repo ? [{ href: LINKS.repo, label: 'Repository', external: true }] : []),
]

/**
 * The last page of the document: one line of links, the credits, and the name, very large,
 * running off the edge. Keep it this quiet; the wordmark is the footer.
 */
export function Footer() {
  const root = useRef<HTMLElement>(null)
  const word = useRef<HTMLDivElement>(null)
  // on paper routes the footer is the one dark band: it opens from a seam. On the landing page the
  // closing scene is already dark above it, so there is no seam to open
  const seam = usePathname() !== '/'

  useGSAP(
    () => {
      if (!motionOK()) return
      gsap.fromTo(
        '[data-wordmark]',
        { yPercent: 38 },
        { yPercent: 0, ease: 'none', scrollTrigger: { trigger: word.current, start: 'top bottom', end: 'bottom bottom', scrub: 0.6 } },
      )
    },
    { scope: root },
  )

  // the spotlight: a soft lit disc that follows the pointer across the wordmark
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const lit = e.currentTarget.querySelector<HTMLElement>('.footer-word-lit')
    if (!lit) return
    const r = lit.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
    e.currentTarget.style.setProperty('--lit', '1')
  }

  return (
    <footer ref={root} data-band="shielded" data-seam-band={seam ? '' : undefined} className="relative overflow-hidden border-t border-rule-dark bg-shielded text-on-dark">
      <div className="wrap t-data-sm flex flex-col gap-6 pb-6 pt-[clamp(56px,5vw,88px)] text-on-dark-2" data-seam-drift="">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-7 gap-y-3 uppercase tracking-[0.16em]">
            {LINKS_ROW.map((l) =>
              l.external ? (
                <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="link-draw hover:text-on-dark">
                  {l.label} ↗
                </a>
              ) : (
                <Link key={l.href} href={l.href} className="link-draw hover:text-on-dark">
                  {l.label}
                </Link>
              ),
            )}
          </nav>
          <button
            type="button"
            onClick={() => scrollToTarget(0)}
            className="group inline-flex items-center gap-3 uppercase tracking-[0.16em] transition-colors hover:text-on-dark"
          >
            Back to the top
            {/* the round arrow is the one part with no words: the cursor labels it, and rings it */}
            <span data-cursor-label="TOP" className="grid h-8 w-8 place-items-center rounded-full border border-rule-dark transition-colors group-hover:border-on-dark">↑</span>
          </button>
        </div>
        <p className="border-t border-rule-dark pt-5 uppercase tracking-[0.14em]">
          {SUBMISSION.event} · {SUBMISSION.track}
        </p>
      </div>

      {/* the name, running off the page */}
      <div
        ref={word}
        onPointerMove={onMove}
        onPointerLeave={(e) => e.currentTarget.style.setProperty('--lit', '0')}
        className="footer-word relative select-none overflow-hidden"
        aria-hidden
      >
        <div data-wordmark="" className="wrap grid">
          <span className="footer-word-base">
            Vouch<span className="text-seal">.</span>
          </span>
          <span className="footer-word-lit">
            Vouch<span className="opacity-0">.</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
