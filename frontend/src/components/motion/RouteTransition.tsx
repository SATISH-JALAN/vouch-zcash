'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { gsap } from '@/lib/gsap'
import { E, motionOK } from '@/lib/motion'
import { Mark } from '@/components/brand/Mark'

// 12.9 — the mark covers, the route swaps, the cover releases as a circle. ≤ 700ms of motion:
// cover 0.26s + release 0.42s. (D.sm + D.md would be 1.06s, over budget.)
const COVER = 0.26
const RELEASE = 0.42

export function RouteTransition() {
  const overlay = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const pending = useRef<string | null>(null)
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!motionOK() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest('a')
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.noTransition !== undefined) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin || url.pathname === location.pathname) return

      e.preventDefault()
      const el = overlay.current!
      const from = document.querySelector('[data-nav-mark]')?.getBoundingClientRect()
      const inset = from
        ? `inset(${from.top}px ${innerWidth - from.right}px ${innerHeight - from.bottom}px ${from.left}px)`
        : `inset(50% 50% 50% 50%)`
      pending.current = url.pathname
      gsap.killTweensOf(el)
      gsap.set(el, { display: 'flex', clipPath: inset })
      gsap.to(el, {
        clipPath: 'inset(0px 0px 0px 0px)',
        duration: COVER,
        ease: E.inOut,
        onComplete: () => router.push(url.pathname + url.search + url.hash),
      })
      // never leave the cover up if navigation stalls
      clearTimeout(fallback.current)
      fallback.current = setTimeout(() => {
        if (pending.current) release()
      }, 3000)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      clearTimeout(fallback.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const release = () => {
    const el = overlay.current
    if (!el) return
    pending.current = null
    clearTimeout(fallback.current)
    gsap.fromTo(
      el,
      { clipPath: 'circle(142% at 50% 50%)' },
      { clipPath: 'circle(0% at 50% 50%)', duration: RELEASE, ease: E.big, onComplete: () => gsap.set(el, { display: 'none' }) },
    )
  }

  useEffect(() => {
    if (pending.current) requestAnimationFrame(release)
  }, [pathname])

  return (
    <div
      ref={overlay}
      aria-hidden
      data-band="shielded"
      className="fixed inset-0 z-[80] hidden items-center justify-center bg-shielded"
    >
      <Mark size={60} tone="shielded" />
    </div>
  )
}
