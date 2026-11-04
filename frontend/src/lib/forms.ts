'use client'

import { gsap } from './gsap'
import { D, EASE, VERIFY } from './motion'

/**
 * Fields that refuse their input (MOTION.md §6.4), delegated so every .field behaves the same:
 * when one becomes aria-invalid it nudges once (never a shake loop) and its message rises from a
 * mask. The message is whatever the field names in aria-describedby, else the element right after it.
 * Returns the cleanup.
 */
export function installForms(): () => void {
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement
      if (!el.classList.contains('field') || el.getAttribute('aria-invalid') !== 'true' || r.oldValue === 'true') continue
      gsap.fromTo(el, { x: -VERIFY.fieldNudge }, { x: 0, duration: 0.35, ease: 'power3.out', clearProps: 'transform' })
      const ids = el.getAttribute('aria-describedby')?.split(/\s+/) ?? []
      const messages = ids.length ? ids.map((id) => document.getElementById(id)).filter(Boolean) : [el.nextElementSibling]
      gsap.fromTo(messages, { clipPath: 'inset(0 0 100% 0)', y: 6 }, { clipPath: 'inset(0 0 0% 0)', y: 0, duration: D.sm, ease: EASE.arrive, clearProps: 'clipPath,transform' })
    }
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-invalid'], attributeOldValue: true })
  return () => observer.disconnect()
}
