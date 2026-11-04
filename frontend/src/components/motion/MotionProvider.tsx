'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { gsap, ScrollTrigger } from '@/lib/gsap'
import { startLenis, stopLenis, getLenis, scrollToTarget } from '@/lib/lenis'
import { motionOK } from '@/lib/motion'
import { pageEffects } from '@/lib/effects'
import { installButtons } from '@/lib/buttons'
import { installForms } from '@/lib/forms'

declare global {
  interface Window {
    __vouchReady?: boolean
    /** QA: live ScrollTrigger count (MOTION.md §9 budget) */
    __st?: () => number
  }
}

/**
 * Runs before first paint (inline in <head>). Decides, once:
 *  - js-ready: motion is allowed, so pre-animation states may apply
 *  - preload:  the first landing load this session, on a desktop-width screen → show the preloader
 *              (never under reduced motion; on a phone the headline is already static, so it shows at once)
 * If the app has not hydrated in 4s, both are removed so nothing stays hidden.
 */
export const HEAD_SCRIPT = `(function(){var d=document.documentElement;try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.add('js-ready');if(location.pathname==='/'&&matchMedia('(min-width: 1024px)').matches&&!sessionStorage.getItem('vouch:intro')){d.classList.add('preload')}}}catch(e){}setTimeout(function(){if(!window.__vouchReady){d.classList.remove('js-ready','preload')}},4000)})();`

export function MotionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    window.__vouchReady = true
    window.__st = () => ScrollTrigger.getAll().length
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let buttons: (() => void) | undefined
    let forms: (() => void) | undefined
    if (reduced || !motionOK()) {
      // Fully static. Anything that still tweens finishes effectively instantly.
      gsap.globalTimeline.timeScale(100)
      stopLenis()
    } else {
      startLenis()
      buttons = installButtons()
      forms = installForms()
    }
    // Masks and triggers must measure against the real fonts, not fallback metrics.
    document.fonts?.ready.then(() => ScrollTrigger.refresh())
    // Pins measured while the preloader held the page still: measure again once it lets go.
    const html = document.documentElement
    const released = new MutationObserver(() => {
      if (html.classList.contains('preload')) return
      released.disconnect()
      ScrollTrigger.refresh()
    })
    if (html.classList.contains('preload')) released.observe(html, { attributes: true, attributeFilter: ['class'] })
    return () => {
      released.disconnect()
      buttons?.()
      forms?.()
      stopLenis()
    }
  }, [])

  useEffect(() => {
    // a link like /docs/trust#credits lands on its section; anything else starts at the top
    const target = hashTarget()
    if (!target) getLenis()?.scrollTo(0, { immediate: true, force: true })
    // after the page's own triggers (children's effects run first), so refresh order stays top to bottom
    const kill = motionOK() ? pageEffects() : undefined
    // new route, new layout: recompute trigger positions after paint, then measure the target against them
    const id = requestAnimationFrame(() => {
      ScrollTrigger.refresh()
      if (target) scrollToTarget(target, true)
    })
    return () => {
      cancelAnimationFrame(id)
      kill?.()
    }
  }, [pathname])

  return <>{children}</>
}

/** The element the URL's #fragment names, if any. /verify's #p=… payload names none. */
function hashTarget(): HTMLElement | null {
  const id = window.location.hash.slice(1)
  if (!id) return null
  try {
    return document.getElementById(decodeURIComponent(id))
  } catch {
    return null
  }
}
