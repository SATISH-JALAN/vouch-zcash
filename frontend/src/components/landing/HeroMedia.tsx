'use client'

import { getImageProps } from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { motionOK } from '@/lib/motion'
import { HERO_PORTRAIT, HERO_WIDE, type HeroArt } from '@/lib/heroArt'
import { useLoops } from '@/lib/store'

const ALT = 'Oil painting: in a gaslit iron-and-glass hall, a notary raises a single card sealed in red wax while a crowd watches. Everything else in the hall is covered.'

type Clip = 'hero' | 'hero-mobile'

/**
 * The painting is the base layer and the LCP: art-directed (portrait below 768px), prioritised.
 * The video loop is added client-side only when motion is allowed and data saver is off, and only
 * after the page has loaded, so it never competes with the painting for bandwidth. It fades in once
 * it is actually playing, and pauses whenever the hero is off-screen or the visitor
 * paused the landing's loops (the ticker's button).
 * The iris (useIris) drives the data-iris-* parts: it clips the frame, lays the plate out by hand
 * and pushes in on the seal, and holds the video (data-held) while the still does the work.
 */
export function HeroMedia() {
  const [clip, setClip] = useState<Clip | null>(null)
  const [playing, setPlaying] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const loopsPaused = useLoops((s) => s.loopsPaused)

  const common = { alt: ALT, sizes: '100vw', priority: true, quality: 80 }
  const { props: { srcSet: wide } } = getImageProps({ ...common, src: '/visuals/hero.webp', width: 1536, height: 1024 })
  const { props: portrait } = getImageProps({ ...common, src: '/visuals/hero-mobile.webp', width: 1122, height: 1402 })

  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (!motionOK() || saveData) return
    const add = () => setClip(window.matchMedia('(min-width: 768px)').matches ? 'hero' : 'hero-mobile')
    if (document.readyState === 'complete') return add()
    window.addEventListener('load', add, { once: true })
    return () => window.removeEventListener('load', add)
  }, [])

  useEffect(() => {
    const el = video.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting && !el.dataset.held && !loopsPaused ? el.play().catch(() => {}) : el.pause()), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [clip, loopsPaused])

  return (
    <div data-iris="" className="absolute inset-0 overflow-hidden">
      <div data-iris-plate="" className="absolute inset-0">
        <picture>
          <source media="(min-width: 768px)" srcSet={wide} sizes="100vw" />
          <img {...portrait} fetchPriority="high" alt={ALT} className="h-full w-full object-cover object-[50%_30%] md:object-[50%_40%]" />
        </picture>
        <Detail art={HERO_WIDE} className="hidden md:block" />
        <Detail art={HERO_PORTRAIT} className="md:hidden" />
      </div>

      {clip && (
        <video
          ref={video}
          key={clip}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? 'opacity-100' : 'opacity-0'}`}
          autoPlay={!loopsPaused}
          muted
          loop
          playsInline
          preload="auto"
          poster={`/visuals/${clip}-poster.webp`}
          onPlaying={() => setPlaying(true)}
          aria-hidden
          data-iris-video=""
          data-clip={clip}
        >
          <source src={`/visuals/${clip}.webm`} type="video/webm" />
          <source src={`/visuals/${clip}.mp4`} type="video/mp4" />
        </video>
      )}

      {/* a flat scrim, not a gradient: the painting's dark side does most of the work */}
      <div data-iris-scrim="" className="absolute inset-0 bg-shielded/45 md:bg-shielded/30" aria-hidden />
    </div>
  )
}

/** A sharper crop of the card, if one is configured, pinned over its place on the plate. Decorative. */
function Detail({ art, className }: { art: HeroArt; className: string }) {
  if (!art.detail) return null
  const [x, y, w, h] = art.detail.rect
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-iris-detail=""
      src={art.detail.src}
      alt=""
      aria-hidden
      decoding="async"
      className={`pointer-events-none absolute opacity-0 ${className}`}
      style={{ left: `${(x / art.w) * 100}%`, top: `${(y / art.h) * 100}%`, width: `${(w / art.w) * 100}%`, height: `${(h / art.h) * 100}%` }}
    />
  )
}
