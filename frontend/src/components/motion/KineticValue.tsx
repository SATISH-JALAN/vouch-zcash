'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from '@/lib/gsap'
import { EASE, motionOK } from '@/lib/motion'

/**
 * Kinetic insertion (MOTION.md §7.4): a sentence edits itself as you watch. When `commit` changes,
 * a bar slides over the old value, the gap resizes to the new value's real width (so the words after
 * it move along the actual layout, not a guess), and the bar lifts off the new value. Between commits
 * the sentence keeps saying what was last committed, so it never flickers per keystroke.
 */
export function KineticValue({ value, commit, className }: { value: string; commit: number; className?: string }) {
  const [shown, setShown] = useState(value)
  const wrap = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const from = useRef<number | null>(null)
  const lastCommit = useRef(commit)

  // a commit: cover the old value, then swap it
  useLayoutEffect(() => {
    if (commit === lastCommit.current) return
    lastCommit.current = commit
    if (value === shown) return
    if (!motionOK()) {
      setShown(value)
      return
    }
    gsap.killTweensOf([wrap.current, bar.current])
    gsap.fromTo(bar.current, { scaleX: 0, transformOrigin: '0% 50%' }, {
      scaleX: 1,
      duration: 0.22,
      ease: EASE.camera,
      onComplete: () => {
        from.current = wrap.current!.getBoundingClientRect().width
        setShown(value)
      },
    })
  }, [commit, value, shown])

  // the new value is in: resize the gap from the old width, then lift the bar
  useLayoutEffect(() => {
    const w0 = from.current
    if (w0 === null || !wrap.current) return
    from.current = null
    const w1 = wrap.current.getBoundingClientRect().width
    gsap
      .timeline()
      .fromTo(wrap.current, { width: w0 }, { width: w1, duration: 0.32, ease: EASE.camera, clearProps: 'width' })
      .to(bar.current, { scaleX: 0, transformOrigin: '100% 50%', duration: 0.4, ease: EASE.arrive }, '+=0.04')
  }, [shown])

  return (
    <span ref={wrap} className={`relative inline-block whitespace-nowrap align-bottom ${className ?? ''}`}>
      {shown}
      <span ref={bar} className="redact-bar" style={{ transform: 'scaleX(0)' }} aria-hidden />
    </span>
  )
}
