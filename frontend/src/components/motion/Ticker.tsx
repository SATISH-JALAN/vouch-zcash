'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { motionOK } from '@/lib/motion'
import { ANCHOR, SHIELDED_POOL_USD } from '@/lib/data/chain'
import { formatInt } from '@/lib/format'
import { BRAND } from '@/lib/site'
import { useLoops } from '@/lib/store'

// The claims counter is 0 because no production proof has been made yet. Keep it honest.
const ITEMS: { label: string; value?: string }[] = [
  { label: BRAND.toUpperCase() },
  { label: 'SHIELDED POOL', value: SHIELDED_POOL_USD },
  { label: 'CLAIMS PROVEN', value: '0' },
  { label: 'VIEWING KEYS SURRENDERED', value: '0' },
  { label: 'IRONWOOD' },
  { label: 'BLOCK', value: formatInt(ANCHOR.height) },
]

function Run() {
  return (
    <span className="flex shrink-0 items-center">
      {Array.from({ length: 3 }).map((_, k) => (
        <Fragment key={k}>
          {ITEMS.map((it) => (
            <span key={it.label} className="flex items-center whitespace-nowrap">
              <span>{it.label}</span>
              {it.value && <span className="ml-[0.6em] text-on-dark">{it.value}</span>}
              <span className="mx-[1.4em] text-on-dark-2" aria-hidden>
                ·
              </span>
            </span>
          ))}
        </Fragment>
      ))}
    </span>
  )
}

/** 40px marquee. Two identical runs, translated -50% forever. Never a CSS marquee.
 *  Its pause button also holds the hero film: nothing on the landing loops once a visitor says stop. */
export function Ticker() {
  const track = useRef<HTMLDivElement>(null)
  const tween = useRef<gsap.core.Tween | null>(null)
  const [moving, setMoving] = useState(false)
  const { loopsPaused, toggleLoops } = useLoops()

  useGSAP(
    () => {
      if (!motionOK()) return
      tween.current = gsap.to(track.current, { xPercent: -50, ease: 'none', duration: 32, repeat: -1, paused: useLoops.getState().loopsPaused })
      setMoving(true)
      return () => {
        tween.current = null
      }
    },
    { scope: track },
  )

  useEffect(() => {
    tween.current?.paused(loopsPaused)
  }, [loopsPaused])

  return (
    <div data-ticker="" className="relative z-20 h-10 overflow-hidden border-b border-rule-dark bg-shielded" data-band="shielded">
      <p className="sr-only">
        Vouch · shielded pool {SHIELDED_POOL_USD} · claims proven 0 · viewing keys surrendered 0 · Ironwood · block {formatInt(ANCHOR.height)}
      </p>
      <div ref={track} className="t-data-sm flex h-full w-max items-center text-on-dark-2" aria-hidden>
        <Run />
        <Run />
      </div>
      {moving && (
        <button
          type="button"
          onClick={toggleLoops}
          aria-pressed={loopsPaused}
          className="t-data-sm absolute inset-y-0 right-0 flex items-center gap-2 border-l border-rule-dark bg-shielded px-[var(--gutter)] uppercase tracking-[0.12em] text-on-dark-2 hover:text-on-dark focus-visible:text-on-dark"
        >
          <span aria-hidden>{loopsPaused ? '▶' : '❚❚'}</span>
          {loopsPaused ? 'Play' : 'Pause'}
          <span className="sr-only"> the ticker and the hero film</span>
        </button>
      )}
    </div>
  )
}
