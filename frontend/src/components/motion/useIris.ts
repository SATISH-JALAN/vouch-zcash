'use client'

import type { RefObject } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { EASE, IRIS, MQ } from '@/lib/motion'
import { onMeaningfulResize } from '@/lib/resize'
import { HERO_PORTRAIT, HERO_WIDE, HERO_WIDE_MQ } from '@/lib/heroArt'
import { registerSlot } from '@/lib/through'
import { useLoops } from '@/lib/store'

/**
 * The iris handoff (MOTION.md §5.1). The whole scene narrows to one sealed fact.
 * A pinned, scrubbed stage: the copy lifts away, the picture closes like an aperture onto the wax
 * seal while it pushes in on it (never past IRIS.pushMax: the source is soft beyond that), and the
 * closing circle glides to rest beside the coda, whose redacted lines then open. Only then does the
 * pin let go; the paper section below then rises against a hard edge.
 *
 * The loop is a crop of the painting (heroArt `loop`), so the painting is laid out exactly under it:
 * the loop freezes where it is as the pin starts and is itself what the iris closes on, and the
 * sharper painting shows through only once the circle is small. Nothing ever visibly swaps.
 *
 * Markup, inside the section passed in (whose own background is the ground):
 *   [data-iris]            the frame that is clipped
 *   [data-iris-plate]      the painting's plate, laid out here by hand so the seal's screen position is known
 *   [data-iris-detail]     optional sharper crop on the plate, faded in as it pushes in
 *   [data-iris-video]      the loop (data-clip names which one)
 *   [data-iris-scrim]      the flat scrim, lifted with the copy
 *   [data-iris-lift]       copy that lifts away first, in DOM order
 *   [data-iris-slot]       placed exactly over the painted wax where it comes to rest: the through-line
 *                          object's first slot. The vector seal replaces the wax there, in one frame
 *   [data-iris-coda]       hidden unless the iris runs; its [data-iris-coda-text] decides where the
 *                          circle rests, its [data-reveal] bars open once it has
 * Built only once `ready` (the preloader has handed off). Reduced motion: nothing runs, the hero
 * stays exactly as authored and nothing pins.
 */
export function useIris(ref: RefObject<HTMLElement | null>, ready: boolean) {
  useGSAP(
    () => {
      const section = ref.current
      if (!ready || !section) return
      const mm = gsap.matchMedia()
      mm.add({ desktop: `${MQ.desktop} and ${MQ.motion}`, mobile: `${MQ.mobile} and ${MQ.motion}` }, (mctx) => {
        const desktop = !!mctx.conditions?.desktop
        let stage = build(section, desktop)
        const off = onMeaningfulResize(() => {
          stage.revert()
          stage = build(section, desktop)
          ScrollTrigger.sort()
          ScrollTrigger.refresh()
        })
        ScrollTrigger.sort()
        ScrollTrigger.refresh()
        return () => {
          off()
          stage.revert()
        }
      })
      return () => mm.revert()
    },
    { scope: ref, dependencies: [ready] },
  )
}

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v))

function build(section: HTMLElement, desktop: boolean) {
  return gsap.context(() => {
    const frame = section.querySelector<HTMLElement>('[data-iris]')
    const plate = section.querySelector<HTMLElement>('[data-iris-plate]')
    if (!frame || !plate) return
    const scrim = section.querySelector('[data-iris-scrim]')
    const lifts = gsap.utils.toArray<HTMLElement>('[data-iris-lift]', section)
    const details = section.querySelectorAll('[data-iris-detail]')
    const art = window.matchMedia(HERO_WIDE_MQ).matches ? HERO_WIDE : HERO_PORTRAIT
    const W = frame.clientWidth
    const H = frame.clientHeight

    // the loop, when it is the one registered on this painting: its framing is then the picture, and
    // the painting is laid out exactly under it
    const clip = section.querySelector<HTMLVideoElement>('[data-iris-video]')
    const loop = clip && art.loop && clip.dataset.clip === art.loop.clip ? art.loop : null
    const video = loop ? clip : null

    // lay the painting out by hand: under the loop, or at exactly the framing object-cover gave it at rest
    let s: number
    let ox: number
    let oy: number
    let sv = 0
    let vx = 0
    let vy = 0
    if (loop) {
      sv = Math.max(W / loop.w, H / loop.h)
      vx = (W - loop.w * sv) / 2
      vy = (H - loop.h * sv) / 2
      s = sv / loop.k
      ox = vx - loop.at[0] * s
      oy = vy - loop.at[1] * s
    } else {
      s = Math.max(W / art.w, H / art.h)
      ox = (W - art.w * s) * art.position[0]
      oy = (H - art.h * s) * art.position[1]
    }
    const rw = art.w * s
    const rh = art.h * s
    const px = art.seal[0] * rw
    const py = art.seal[1] * rh
    gsap.set(plate, { left: ox, top: oy, width: rw, height: rh, right: 'auto', bottom: 'auto', transformOrigin: `${px}px ${py}px` })
    const sx = ox + px
    const sy = oy + py
    if (video && loop) {
      // the same framing object-cover gives it, set by hand so it can push in about the same point.
      // Its box is wider than the viewport: the base styles' max-width: 100% would crop it off-centre
      gsap.set(video, {
        left: vx,
        top: vy,
        width: loop.w * sv,
        height: loop.h * sv,
        maxWidth: 'none',
        right: 'auto',
        bottom: 'auto',
        transformOrigin: `${sx - vx}px ${sy - vy}px`,
        transition: 'none',
      })
    }

    const z = desktop ? IRIS.pushMax : IRIS.pushMobile
    const rEnd = clamp(desktop ? IRIS.endMin : IRIS.endMinMobile, IRIS.endMax, art.card * s * z * IRIS.endFrame)

    // where the closed circle comes to rest, decided by the coda's text: on desktop left of it and
    // level with it, on smaller screens centred in the dark above it
    const coda = section.querySelector<HTMLElement>('[data-iris-coda]')
    const codaText = coda?.querySelector<HTMLElement>('[data-iris-coda-text]') ?? null
    let tx = sx
    let ty = sy
    if (coda && codaText) {
      const box = section.getBoundingClientRect()
      const t = codaText.getBoundingClientRect()
      if (desktop) {
        tx = Math.max(rEnd + 24, t.left - box.left - IRIS.codaGap - rEnd)
        ty = t.top - box.top + t.height / 2
      } else {
        tx = W / 2
        ty = Math.max(rEnd + 88, (t.top - box.top + 64) / 2)
      }
    }
    const rMax = Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy)) + 4
    const circle = (r: number, x: number, y: number) => `circle(${r.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px)`

    // the vector seal takes over on the painted wax itself: same centre, same size once pushed in.
    // The seal outline fills 88% of its box, so the box is that much larger than the wax
    const slot = section.querySelector<HTMLElement>('[data-iris-slot]')
    const waxBox = (art.wax * s * z) / 0.88
    if (slot) gsap.set(slot, { left: tx - waxBox / 2, top: ty - waxBox / 2, width: waxBox, height: waxBox })

    // the aperture closes on the card while the card glides to where it rests: circle, painting and
    // loop move together on one curve, so the card never slides inside the circle
    const ap = { r: rMax, x: sx, y: sy }
    const aperture = () => gsap.set(frame, { clipPath: circle(ap.r, ap.x, ap.y) })
    aperture()
    const close = { duration: 3.6, ease: 'power2.inOut' }
    const push = { scale: z, x: tx - sx, y: ty - sy, ...close }
    const tl = gsap.timeline({ defaults: { ease: EASE.scrub } })
    tl.to(lifts, { y: -48, autoAlpha: 0, duration: 0.9, stagger: 0.12, ease: EASE.leave }, 0)
      .to(scrim, { opacity: 0, duration: 1.2 }, 0.2)
      // (as numbers: a clip-path string whose centre moves too is not interpolated, it jumps)
      .fromTo(ap, { r: rMax, x: sx, y: sy }, { r: rEnd, x: tx, y: ty, ...close, onUpdate: aperture }, 0.4)
      .fromTo(plate, { scale: 1, x: 0, y: 0 }, push, 0.4)
      .to(details, { opacity: 1, duration: 1.2 }, 1.6)
    if (video) {
      tl.fromTo(video, { scale: 1, x: 0, y: 0 }, push, 0.4)
        // the loop is softer pushed in: once the circle is small, the sharper painting under it shows through
        .to(video, { opacity: 0, duration: 0.8, ease: 'none' }, 3.0)
    }
    // then the coda: it arrives redacted beside the sealed card and its bars open line by line, with a
    // beat of all of it there before the pin lets go
    if (coda) {
      const bars = Array.from(coda.querySelectorAll<HTMLElement>('[data-reveal]'))
      const label = coda.querySelector('[data-iris-coda-label]')
      gsap.set(bars, { scaleX: 1, transformOrigin: 'right center' })
      tl.fromTo(coda, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: 'none' }, 3.95)
        .to(bars, { scaleX: 0, duration: 0.7, stagger: 0.3, ease: EASE.leave }, 4.3)
        .fromTo(label, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 5.4)
        .to({}, { duration: 0.6 })
    }
    // the stage ends on the dark: no ground tween (a dark-to-paper blend passes through mud)

    // the registered loop freezes where it is as the pin starts (it is the picture, so nothing changes)
    // and plays again at the top. An unregistered one hands over to the laid-out still instead
    // a visitor who paused the landing's loops (the ticker's button) keeps the film paused
    const play = (v: HTMLVideoElement) => void (useLoops.getState().loopsPaused || v.play().catch(() => {}))
    const hold = (on: boolean) => {
      const v = clip
      if (!v) return
      if (on) v.dataset.held = '1'
      else delete v.dataset.held
      if (video) {
        if (on) v.pause()
        else play(v)
        return
      }
      gsap.set(v, { transition: 'none' })
      if (on) gsap.to(v, { opacity: 0, duration: IRIS.videoFade, ease: 'none', overwrite: true, onComplete: () => v.pause() })
      else {
        play(v)
        gsap.to(v, { opacity: 1, duration: IRIS.videoFade, ease: 'none', overwrite: true })
      }
    }

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: desktop ? IRIS.pinDesktop : IRIS.pinMobile,
      pin: true,
      scrub: IRIS.scrub,
      anticipatePin: 1,
      animation: tl,
      onEnter: () => hold(true),
      onLeaveBack: () => hold(false),
    })

    // layers only while the stage can be seen (§8): the hero is on screen from the first paint, so they
    // are promoted from the start (creating them as the pin began cost a frame). They are released
    // once the hero has scrolled fully away: dropping them as the pin let go re-rasterised the painting
    // in the same frame as the unpin
    const layers = video ? [frame, plate, video] : [frame, plate]
    const promote = (on: boolean) => gsap.set(layers, { willChange: on ? 'transform, clip-path' : 'auto' })
    promote(true)
    ScrollTrigger.create({ start: () => st.end + window.innerHeight, onEnter: () => promote(false), onLeaveBack: () => promote(true) })
    // the pin's first frames must not wait on a decode: it is the LCP image, so this is normally a no-op
    void plate.querySelector('img')?.decode().catch(() => {})

    const unslot = slot
      ? registerSlot(0, {
          el: slot,
          shape: 'seal',
          // a waypoint: the painted wax stays the seal, the object only grows out of it on its way
          bare: true,
          // it leaves from here once the pin lets go, and rides up with the dark hero for a short stretch
          range: () => [st.end, st.end + window.innerHeight * 0.3],
          // the scrubbed stage lags the scroll: take over only once it has come to rest
          ready: () => tl.progress() > 0.999,
        })
      : null

    return () => {
      unslot?.()
      gsap.set(frame, { clearProps: 'clipPath' })
      if (clip) {
        delete clip.dataset.held
        gsap.set(clip, { clearProps: 'opacity,transition,left,top,width,height,maxWidth,right,bottom,transform,transformOrigin,willChange' })
      }
      if (coda) {
        gsap.set(coda, { clearProps: 'opacity,visibility' })
        gsap.set(coda.querySelectorAll('[data-reveal]'), { clearProps: 'transform,transformOrigin' })
      }
    }
  }, section)
}
