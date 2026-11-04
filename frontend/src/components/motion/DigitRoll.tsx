'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, EASE, motionOK } from '@/lib/motion'

const DIGITS = '0123456789'

/**
 * A number that matters, rolled like a mechanical counter (MOTION.md §7.7). The resting state is the
 * real text, kerned like the rest of the type; the counter exists only while it rolls. For the roll,
 * each character becomes a column exactly one line box tall with its overflow clipped, measured to
 * its final glyph's width, all sharing the text's own baseline. Digits roll from 0, right to left;
 * when they land the columns are removed and the plain text is back.
 */
export function DigitRoll({ text, start = 'top 82%' }: { text: string; start?: string }) {
  const root = useRef<HTMLSpanElement>(null)

  useGSAP(
    () => {
      const el = root.current
      const final = el?.querySelector<HTMLElement>('[data-final]')
      if (!el || !final || !motionOK()) return
      const cs = getComputedStyle(final)
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize)

      // measure each glyph as it will finally sit
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
      el.appendChild(probe)
      const width = (ch: string) => {
        probe.textContent = ch
        return probe.getBoundingClientRect().width
      }

      const counter = document.createElement('span')
      counter.setAttribute('aria-hidden', 'true')
      counter.style.cssText = `position:absolute;left:0;top:0;display:flex;height:${lh}px;line-height:${lh}px`
      const strips: HTMLElement[] = []
      for (const ch of text) {
        const col = document.createElement('span')
        col.style.cssText = `display:block;width:${width(ch)}px;height:${lh}px;overflow:hidden`
        if (DIGITS.includes(ch)) {
          const strip = document.createElement('span')
          strip.style.cssText = 'display:block'
          strip.dataset.digit = ch
          for (const d of DIGITS) {
            const cell = document.createElement('span')
            cell.style.cssText = `display:block;height:${lh}px;text-align:center`
            cell.textContent = d
            strip.appendChild(cell)
          }
          col.appendChild(strip)
          strips.push(strip)
        } else col.textContent = ch
        counter.appendChild(col)
      }
      probe.remove()
      el.appendChild(counter)
      gsap.set(final, { visibility: 'hidden' })

      const done = () => {
        counter.remove()
        gsap.set(final, { clearProps: 'visibility' })
      }
      gsap.fromTo(
        strips.reverse(),
        { y: 0 },
        {
          y: (_i, s: HTMLElement) => -Number(s.dataset.digit) * lh,
          duration: D.lg,
          ease: EASE.arrive,
          stagger: 0.08,
          scrollTrigger: { trigger: el, start, once: true },
          onComplete: done,
        },
      )
      return done
    },
    { scope: root },
  )

  return (
    <span ref={root} className="relative inline-block">
      <span data-final="">{text}</span>
    </span>
  )
}
