'use client'

import { gsap } from '@/lib/gsap'
import { D, EASE, MICRO, MQ } from '@/lib/motion'

/**
 * The button family's behaviour (MOTION.md §6.2), delegated from the document so every .btn on
 * every route behaves the same with no per-component code. Markup comes from <BtnLabel>.
 *  - primary: the fill floods in from where the pointer entered and drains toward where it left;
 *    the label rolls to its hover colour; the leading dot becomes an arrow
 *  - every .btn: press compresses, release settles; never a bounce
 *  - aria-busy="true": the button closes to a circle and a ring draws around inside it, holding
 *    its width; when it clears, it opens back out to the new label's width
 * Secondary underlines are pure CSS. Returns the cleanup.
 */

const PRIMARY = '.btn-primary, .btn-on-dark'
const hot = new Set<HTMLElement>()
const spins = new WeakMap<HTMLElement, gsap.core.Timeline>()

function edgePoint(el: HTMLElement, e: PointerEvent) {
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top, reach: Math.hypot(r.width, r.height) }
}

function heat(el: HTMLElement, e: PointerEvent) {
  if (hot.has(el)) return
  hot.add(el)
  el.classList.add('is-hot')
  const p = edgePoint(el, e)
  gsap.set(el, { '--fx': `${p.x}px`, '--fy': `${p.y}px` })
  gsap.fromTo(el, { '--fr': '0px' }, { '--fr': `${p.reach}px`, duration: MICRO.fill, ease: EASE.arrive, overwrite: 'auto' })
  gsap.to(el.querySelectorAll('.btn-c'), { yPercent: -100, duration: MICRO.roll, ease: EASE.arrive, stagger: MICRO.rollStagger, overwrite: 'auto' })
  gsap.to(el.querySelector('.btn-dot'), { scale: 0, transformOrigin: '50% 50%', duration: MICRO.roll * 0.6, ease: EASE.leave, overwrite: 'auto' })
  gsap.to(el.querySelector('.btn-arrow'), { strokeDashoffset: 0, duration: MICRO.roll, ease: EASE.arrive, delay: MICRO.roll * 0.3, overwrite: 'auto' })
}

function cool(el: HTMLElement, e?: PointerEvent) {
  if (!hot.delete(el)) return
  el.classList.remove('is-hot')
  // drain toward the exit; without a pointer (a stale button), toward the centre
  if (e) {
    const p = edgePoint(el, e)
    gsap.set(el, { '--fx': `${p.x}px`, '--fy': `${p.y}px` })
  }
  gsap.to(el, { '--fr': '0px', duration: MICRO.fill, ease: EASE.arrive, overwrite: 'auto' })
  gsap.to(el.querySelectorAll('.btn-c'), { yPercent: 0, duration: MICRO.roll, ease: EASE.arrive, stagger: MICRO.rollStagger, overwrite: 'auto' })
  gsap.to(el.querySelector('.btn-arrow'), { strokeDashoffset: 1, duration: MICRO.roll * 0.6, ease: EASE.leave, overwrite: 'auto' })
  gsap.to(el.querySelector('.btn-dot'), { scale: 1, duration: MICRO.roll, ease: EASE.arrive, delay: MICRO.roll * 0.3, overwrite: 'auto' })
}

function press(el: HTMLElement) {
  gsap.to(el, { scale: MICRO.pressScale, duration: MICRO.press, ease: 'power2.out', overwrite: 'auto' })
}
function release(el: HTMLElement) {
  gsap.to(el, { scale: 1, duration: D.sm, ease: EASE.arrive, overwrite: 'auto' })
}

function radius(el: HTMLElement) {
  return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
}

function busyOn(el: HTMLElement) {
  if (spins.has(el)) return
  const { width: w, height: h } = el.getBoundingClientRect()
  const side = Math.max(0, (w - h) / 2)
  el.style.width = `${w}px` // the label is about to change; the box must not
  const parts = el.querySelectorAll('.btn-label, .btn-icon')
  const ring = el.querySelector('.btn-spin circle')
  const tl = gsap.timeline()
  tl.fromTo(
    el,
    { clipPath: `inset(0px 0px 0px 0px round ${radius(el)}px)` },
    { clipPath: `inset(0px ${side}px 0px ${side}px round ${h / 2}px)`, duration: D.sm, ease: EASE.camera },
  )
    .to(parts, { opacity: 0, duration: 0.15, ease: EASE.leave }, 0)
    .set(el.querySelector('.btn-spin'), { opacity: 1 }, D.sm * 0.6)
  if (ring) {
    // a button unmounted while busy never gets its aria-busy cleared: the loop ends itself instead
    const loop = gsap.timeline({
      repeat: -1,
      onRepeat: () => {
        if (el.isConnected) return
        tl.kill()
        spins.delete(el)
      },
    })
    loop.fromTo(ring, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.7, ease: 'power2.inOut' })
      .to(ring, { drawSVG: '100% 100%', duration: 0.7, ease: 'power2.inOut' })
    tl.add(loop, D.sm * 0.6)
  }
  spins.set(el, tl)
}

function busyOff(el: HTMLElement) {
  const tl = spins.get(el)
  if (!tl) return
  spins.delete(el)
  tl.kill()
  const from = el.getBoundingClientRect().width
  el.style.width = ''
  const to = el.getBoundingClientRect().width
  el.style.width = `${from}px`
  const round = radius(el)
  gsap.set(el.querySelector('.btn-spin'), { opacity: 0 })
  gsap
    .timeline({ onComplete: () => gsap.set(el, { clearProps: 'width,clipPath' }) })
    .to(el, { width: to, clipPath: `inset(0px 0px 0px 0px round ${round}px)`, duration: D.sm, ease: EASE.arrive })
    .to(el.querySelectorAll('.btn-label, .btn-icon'), { opacity: 1, duration: MICRO.fill, ease: EASE.arrive }, 0.12)
  if (!el.matches(':hover')) cool(el)
}

export function installButtons(): () => void {
  const canHover = window.matchMedia(MQ.hover).matches
  const btnOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.btn') : null)

  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const t = e.target as Node
    // a button that went disabled or busy under the pointer never got its leave: settle it now
    for (const el of hot) if (!el.contains(t)) cool(el)
    const el = btnOf(e.target)
    if (!el || el.contains(e.relatedTarget as Node | null)) return
    if (el.matches(PRIMARY) && !el.matches(':disabled, [aria-busy="true"]')) heat(el, e)
  }
  const onOut = (e: PointerEvent) => {
    const el = btnOf(e.target)
    if (!el || el.contains(e.relatedTarget as Node | null)) return
    cool(el, e)
    release(el)
  }
  const onDown = (e: PointerEvent) => {
    const el = btnOf(e.target)
    if (el && e.button === 0 && !el.matches(':disabled')) press(el)
  }
  // after a press ends, anything the browser swallowed along the way (a drag, a cancel) is settled
  // on the next frame: a button the pointer is no longer over does not stay filled
  const settle = (el: HTMLElement) => requestAnimationFrame(() => {
    if (!el.matches(':hover')) cool(el)
  })
  const onUp = (e: PointerEvent) => {
    const el = btnOf(e.target)
    if (!el) return
    release(el)
    settle(el)
  }
  // dragging a link off itself starts a native drag, which swallows pointerout (and, depending on
  // the browser, sends pointercancel or nothing): settle the button either way
  const onCancel = (e: Event) => {
    const el = btnOf(e.target)
    if (!el) return
    release(el)
    cool(el)
    settle(el)
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement
      if (!el.classList.contains('btn')) continue
      if (el.getAttribute('aria-busy') === 'true') busyOn(el)
      else busyOff(el)
    }
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] })

  if (canHover) {
    document.addEventListener('pointerover', onOver, { passive: true })
    document.addEventListener('pointerout', onOut, { passive: true })
  }
  document.addEventListener('pointerdown', onDown, { passive: true })
  document.addEventListener('pointerup', onUp, { passive: true })
  document.addEventListener('pointercancel', onCancel, { passive: true })
  document.addEventListener('dragstart', onCancel, { passive: true })
  document.addEventListener('dragend', onCancel, { passive: true })

  return () => {
    observer.disconnect()
    document.removeEventListener('pointerover', onOver)
    document.removeEventListener('pointerout', onOut)
    document.removeEventListener('pointerdown', onDown)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    document.removeEventListener('dragstart', onCancel)
    document.removeEventListener('dragend', onCancel)
    hot.clear()
  }
}
