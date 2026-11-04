'use client'

import { Fragment, useRef } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { MQ, READ } from '@/lib/motion'
import { onMeaningfulResize } from '@/lib/resize'

type Kind = 'open' | 'never' | 'fact' | 'plain'
interface Token {
  word: string
  kind: Kind
  /** punctuation that follows the word outside its bar */
  tail: string
}

/**
 * Parses the sentence: [[the disclosed fact]] and {{a withheld word}}; everything else is open.
 * Punctuation stays outside the bars, so a withheld noun's comma still reads.
 */
function parse(text: string): Token[] {
  const out: Token[] = []
  const re = /\[\[(.+?)\]\]|\{\{(.+?)\}\}|([^\s[{]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[1]) m[1].split(/\s+/).forEach((w) => out.push({ word: w, kind: 'fact', tail: '' }))
    else if (m[2]) out.push({ word: m[2], kind: 'never', tail: '' })
    else {
      const w = m[3]!
      // a bare punctuation run belongs to the word before it (after a withheld noun, say);
      // a dash is a pause in the sentence, not a word: it never carries a bar
      if (/^[,.;:!?]+$/.test(w) && out.length) out[out.length - 1]!.tail += w
      else out.push({ word: w, kind: /^[—–-]+$/.test(w) ? 'plain' : 'open', tail: '' })
    }
  }
  return out
}

/**
 * The redaction read (MOTION.md §5.4): the product, read as a sentence. Every word starts under an
 * ink bar; scrolling lifts the open words in reading order, at reading pace. The withheld words
 * stay shut for good: their bars never animate, have no hover, and carry no text underneath. Last,
 * after a pause, the fact's bars lift and it turns seal red, underlined. A readout keeps count.
 * Pinned and scrubbed, so it reads backwards too. Without JS or with reduced motion it renders
 * finished: the open words and the fact readable, the withheld ones barred.
 *
 * After a short hold on "1 of 1 disclosed", the section closes like a curtain: the dark ground
 * sweeps in from the right edge with a curved leading edge (a circle centred off-screen right),
 * accelerating, over the sentence, until the screen is only dark. What follows (the section's
 * [data-rr-rise], dark itself) is laid out to meet the stage exactly: it slips in under the dark,
 * unseen, and its content ([data-rr-rise-to] and what is beside it) waits in place, centred. The dark
 * holds still while that content fades in where it stands, then the page scrolls on. While it runs
 * the stage is exactly one viewport tall, so nothing of what follows shows before the dark is
 * complete. The stage reports itself as dark from the middle of the sweep, so the header crosses.
 */
export function RedactionRead({ text, className }: { text: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const tokens = parse(text)
  const plain = text.replace(/\[\[|\]\]|\{\{|\}\}/g, '')

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ desktop: `${MQ.desktop} and ${MQ.motion}`, mobile: `${MQ.mobile} and ${MQ.motion}` }, (ctx) => {
        const el = root.current!
        const desktop = !!ctx.conditions?.desktop
        let stage = build(el, desktop)
        const off = onMeaningfulResize(() => {
          stage.revert()
          stage = build(el, desktop)
          ScrollTrigger.sort()
          ScrollTrigger.refresh()
        })
        return () => {
          off()
          stage.revert()
        }
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div ref={root} className={className} data-redaction-read="" data-band="paper">
      <p className="sr-only">{plain}</p>
      <Sentence tokens={tokens} />
      {/* the dark that closes the section: full viewport, centred on the stage, above the sentence */}
      <div data-rr-wipe="" aria-hidden className="rr-wipe" />
    </div>
  )
}

function build(el: HTMLElement, desktop: boolean) {
  return gsap.context(() => {
    const wipe = el.querySelector<HTMLElement>('[data-rr-wipe]')!
    // the stage is the whole viewport while it runs, the sentence centred in it: at the pin's end the
    // section below starts exactly at the bottom edge, so it can only arrive once the dark is complete
    gsap.set(el, { minHeight: window.innerHeight, display: 'flex', flexDirection: 'column', justifyContent: 'center' })
    const copies = Array.from(el.querySelectorAll<HTMLElement>('[data-rr-sentence]')).map((c) => ({
      open: gsap.utils.toArray<HTMLElement>('[data-rw="open"]', c).map((w) => w.querySelector('[data-rbar]')!),
      factBars: gsap.utils.toArray<HTMLElement>('[data-rw="fact"]', c).map((w) => w.querySelector('[data-rbar]')!),
      factText: gsap.utils.toArray<HTMLElement>('[data-rw="fact"]', c).map((w) => w.querySelector('[data-rt]')!),
      under: c.querySelector('[data-ru]')!,
      readN: c.querySelector<HTMLElement>('[data-read]')!,
      sealN: c.querySelector<HTMLElement>('[data-disclosed]')!,
      ink: getComputedStyle(c).color,
    }))
    const seal = getComputedStyle(document.documentElement).getPropertyValue('--color-seal').trim()
    const n = copies[0]!.open.length
    // what follows: pulled up by a viewport so its top meets the stage's top, hidden until the dark is
    // complete (dark on dark, so its arrival is never seen), its content centred in one viewport and
    // pinned there while it fades in. No transforms on the layout: everything after it measures true
    const rise = el.closest('section')?.querySelector<HTMLElement>('[data-rr-rise]') ?? null
    const riseTo = rise?.querySelector<HTMLElement>('[data-rr-rise-to]') ?? null
    const riseIn = riseTo?.parentElement ?? null
    if (rise && riseTo && riseIn) {
      const vh = window.innerHeight
      gsap.set(rise, { marginTop: -vh, visibility: 'hidden' })
      gsap.set(riseIn, { paddingTop: Math.max(READ.riseTop, (vh - riseTo.offsetHeight) / 2), minHeight: vh })
      const items = Array.from(riseIn.children)
      const fade = gsap.timeline({ defaults: { ease: 'power2.out' } })
      fade
        .fromTo(items, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7, stagger: 0.1 }, 0)
        .fromTo(riseTo, { scale: READ.fadeFrom }, { scale: 1, duration: 0.8 }, 0)
        // a beat with it fully there before the page moves on
        .to({}, { duration: 0.35 })
      ScrollTrigger.create({ id: 'rr-rise', trigger: riseIn, start: 'top top', end: READ.fadePin, pin: true, scrub: READ.scrub, animation: fade })
    }

    // the arc: one circle, centred off-screen right, in the wipe's own coordinates (a viewport)
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cx = vw * 1.3
    const rEnd = Math.hypot(cx, vh / 2) + 8
    const arc = (r: number) => `circle(${r.toFixed(1)}px at ${cx.toFixed(1)}px ${(vh / 2).toFixed(1)}px)`
    const wipeFrom = { clipPath: arc(0) }
    gsap.set(wipe, { ...wipeFrom, visibility: 'visible' })

    for (const c of copies) {
      gsap.set([...c.open, ...c.factBars], { scaleX: 1 })
      gsap.set(c.factText, { color: c.ink })
      gsap.set(c.under, { scaleX: 0 })
      c.readN.textContent = '0'
      c.sealN.textContent = '0'
    }

    const tl = gsap.timeline({ defaults: { ease: 'none' } })
    const tEnd = 0.2 + READ.each * (n - 1) + READ.word
    const tFact = tEnd + READ.pause
    for (const c of copies) {
      tl.to(c.open, { scaleX: 0, duration: READ.word, stagger: READ.each, ease: 'power2.inOut' }, 0.2)
        .to(c.factBars, { scaleX: 0, duration: 0.8, stagger: 0.07, ease: 'power3.inOut' }, tFact)
        // late and fast: a slow fade into red goes muddy
        .to(c.factText, { color: seal, duration: 0.2, stagger: 0.04 }, tFact + 0.55)
        .to(c.under, { scaleX: 1, duration: 0.9, ease: 'power3.out' }, tFact + 0.9)
    }
    // hold on the disclosed fact (about a tenth of the stage), then the dark sweeps in over the
    // sentence: an arc from the right edge, accelerating. A beat of dark alone before the pin lets go
    const readDur = tFact + 1.8
    const sweep = readDur * READ.wipe
    const wipeAt = readDur + readDur * READ.hold
    tl.fromTo(wipe, wipeFrom, { clipPath: arc(rEnd), duration: sweep, ease: 'power2.in' }, wipeAt)
    if (rise) tl.set(rise, { visibility: 'visible' }, wipeAt + sweep)
    tl.to({}, { duration: readDur * READ.dark })

    let dark = false
    const ground = (d: boolean) => {
      if (d === dark) return
      dark = d
      el.dataset.band = d ? 'shielded' : 'paper'
      window.dispatchEvent(new Event('vouch:ground'))
    }
    const sealAt = tFact + 0.6
    let lastRead = -1
    let lastSeal = -1
    tl.eventCallback('onUpdate', () => {
      const t = tl.time()
      const read = Math.round(gsap.utils.clamp(0, 1, (t - 0.2) / (tEnd - 0.2)) * n)
      const sealed = t >= sealAt ? 1 : 0
      if (read !== lastRead) copies.forEach((c) => (c.readN.textContent = String(read)))
      if (sealed !== lastSeal) copies.forEach((c) => (c.sealN.textContent = String(sealed)))
      lastRead = read
      lastSeal = sealed
      // the scrubbed playhead lags the scroll, so the ground follows the timeline, not the trigger
      ground(t >= wipeAt + sweep * 0.55)
    })

    gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top top', end: desktop ? READ.pinDesktop : READ.pinMobile, pin: true, scrub: READ.scrub, anticipatePin: 1 },
    }).add(tl)

    return () => {
      ground(false)
      gsap.set(wipe, { clearProps: 'clipPath,visibility' })
      gsap.set(el, { clearProps: 'minHeight,display,flexDirection,justifyContent' })
      if (rise) gsap.set(rise, { clearProps: 'marginTop,visibility' })
      if (riseIn) {
        gsap.set(riseIn, { clearProps: 'paddingTop,minHeight' })
        gsap.set(Array.from(riseIn.children), { clearProps: 'opacity,visibility,transform' })
      }
    }
  }, el)
}

/** The sentence and its readout, drawn finished; a stage animates it from barred. */
function Sentence({ tokens }: { tokens: Token[] }) {
  const never = tokens.filter((t) => t.kind === 'never').length
  // the fact's words travel as one group, so its underline runs under all of them
  type Seg = { fact: false; t: Token } | { fact: true; words: Token[]; tail: string }
  const segs: Seg[] = []
  for (const t of tokens) {
    const last = segs[segs.length - 1]
    if (t.kind === 'fact' && last?.fact) {
      last.words.push(t)
      last.tail = t.tail
    } else if (t.kind === 'fact') segs.push({ fact: true, words: [t], tail: t.tail })
    else segs.push({ fact: false, t })
  }

  return (
    <div data-rr-sentence="">
      <p aria-hidden className="rr-text">
        {segs.map((seg, i) => (
          <Fragment key={i}>
            {seg.fact ? (
              <span className="rr-fact">
                {seg.words.map((w, j) => (
                  <Fragment key={j}>
                    {j > 0 && ' '}
                    <Word t={w} />
                  </Fragment>
                ))}
                <span data-ru="" className="rr-u" />
              </span>
            ) : seg.t.kind === 'plain' ? (
              seg.t.word
            ) : (
              <Word t={seg.t} />
            )}
            {seg.fact ? seg.tail : seg.t.tail}
            {i < segs.length - 1 && ' '}
          </Fragment>
        ))}
      </p>
      <p aria-hidden className="rr-readout t-data-sm">
        <span>
          <b data-read="">{tokens.filter((t) => t.kind === 'open').length}</b> words read
        </span>
        <span>
          <b>{never}</b> facts withheld
        </span>
        <span>
          <b data-disclosed="" className="text-seal">
            1
          </b>{' '}
          of 1 disclosed
        </span>
      </p>
    </div>
  )
}

function Word({ t }: { t: Token }) {
  return (
    <span className="rr-w" data-rw={t.kind}>
      <span data-rt="" className="rr-t">
        {t.word}
      </span>
      <span data-rbar="" className="rr-bar" />
    </span>
  )
}
