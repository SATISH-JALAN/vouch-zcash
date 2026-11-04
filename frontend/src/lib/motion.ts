// Never hand-write a duration.
export const D = { xs: 0.22, sm: 0.38, md: 0.68, lg: 1.05, xl: 1.7 } as const
export const E = {
  out: 'power3.out',
  big: 'expo.out',
  inOut: 'power2.inOut',
  snap: 'back.out(1.6)',
} as const
export const STAGGER = { line: 0.075, row: 0.045, bar: 0.06, card: 0.09 } as const

/**
 * The motion pass (docs/MOTION.md §4). Eases by job, not by taste:
 * arrivals land, camera moves travel, exits accelerate away, scrubbed timelines stay linear.
 * No elastic or bounce anywhere; `pop` is for sub-10px pops only.
 */
export const EASE = {
  arrive: 'expo.out',
  camera: 'power3.inOut',
  leave: 'power2.in',
  scrub: 'none',
  pop: 'back.out(1.4)',
} as const

/** Micro-interactions (§6). All inside the 0.12–0.38s band. */
export const MICRO = {
  /** press: down fast, released on EASE.arrive over D.sm */
  press: 0.09,
  pressScale: 0.97,
  /** a button's fill flooding in from the pointer, and draining out toward it */
  fill: 0.38,
  /** the label roll: per-character stagger and each character's travel */
  roll: 0.38,
  rollStagger: 0.012,
  /** cursor state changes (grow, shrink, show a ring) */
  cursor: 0.3,
  /** header crossing between grounds */
  ground: 0.3,
} as const

export const CURSOR = {
  /** fraction of the remaining distance covered per 60fps frame; frame-rate corrected in Cursor */
  lerp: 0.32,
  dot: 12,
  /** over a link or button: the dot grows to this disc */
  hover: 36,
  /** lens and label states: a thin ring this wide */
  ring: 72,
} as const

export const MAGNET = {
  /** px: the shell never travels further than this */
  max: 6,
  /** the label travels this much further than the shell, so the button has depth */
  labelDepth: 0.4,
  pull: 0.3,
  radius: 110,
} as const

/** The iris handoff (§5.1). Pin lengths are scroll distance past the hero's top. */
export const IRIS = {
  pinDesktop: '+=230%',
  pinMobile: '+=175%',
  scrub: 0.65,
  /** the painting is only 1536px wide: push in no further than this, and end on a larger circle */
  pushMax: 1.8,
  /** the portrait source is softer still on a 2× phone screen: a gentler push and a larger end circle */
  pushMobile: 1.4,
  endMinMobile: 56,
  /** the end circle frames the whole card, not just the wax: this much of the pushed-in card size */
  endFrame: 0.62,
  endMin: 44,
  endMax: 120,
  /** where the closed circle comes to rest beside the coda: this gap (px) left of its text on desktop */
  codaGap: 96,
  /** without a registered loop, the video hands over to the laid-out still as the pin starts */
  videoFade: 0.3,
} as const

/** The through-line object (§5.5). Distances in viewport heights unless noted. */
export const THROUGH = {
  /** leaving or arriving at a waypoint (a bare slot), it scales over this much of the transit */
  bareSpan: 0.3,
  /** hold the source colour this far into a transit, then switch over `colorSpan` (a linear blend goes through mud) */
  colorHold: 0.58,
  colorSpan: 0.24,
  /** seconds: the switch itself is a short step in time, not a blend spread across the scroll */
  colorStep: 0.06,
  /** a transit longer than this does not drag the object across the sections in between: it leaves, and arrives */
  longTransit: 1.2,
  fade: 0.35,
  /** after the landing the object disappears into the painting within this */
  landFade: 0.14,
  /** phones: in transit the object parks in the right margin at this size (px) */
  marginSize: 12,
} as const

/** The anchor tree (§5.2), inside Mechanism's pin. */
export const TREE = {
  pin: '+=300%',
  rootSize: 40,
  ringGap: 8,
} as const

/** The redaction read (§5.4): a pinned sentence read at reading pace. */
export const READ = {
  pinDesktop: '+=245%',
  pinMobile: '+=190%',
  /** the hold on "1 of 1 disclosed", the sweep of dark that covers the sentence, and the beat of dark
   *  alone, as fractions of the read */
  hold: 0.16,
  wipe: 0.4,
  dark: 0.1,
  /** then what follows fades in where it stands, on the still dark, over this much scroll */
  fadePin: '+=90%',
  /** it settles from this scale as it fades in */
  fadeFrom: 0.985,
  /** where it stands: centred, but never higher than this from the top (the header) */
  riseTop: 96,
  scrub: 0.65,
  /** per open word: its bar's travel, and the gap to the next word */
  word: 0.9,
  each: 0.26,
  /** the deliberate pause before the fact */
  pause: 0.6,
} as const

/** The verify event and the form details (§7.1, §6.4). */
export const VERIFY = {
  /** the seal stamps: from this scale back to 1, with a one-frame press shadow and one ripple */
  stampFrom: 1.12,
  stamp: 0.28,
  ripple: 0.7,
  /** invalid: one nudge, never a shake loop */
  nudge: 4,
  /** a field refusing input nudges less than a verdict does */
  fieldNudge: 3,
  /** a copied label holds before it returns */
  copyHold: 1.6,
  scramble: 0.6,
} as const

/** Seams between a dark band and paper (§7.2). */
export const SEAM = {
  scrub: 0.65,
  /** px: content on the far side of a seam moves at its own rate as the edge passes */
  drift: 56,
} as const

/** The hero's scroll cue (§6.5): degrees per second at rest, and how hard scrolling pushes it. */
export const CUE = {
  spin: 14,
  push: 0.06,
} as const

/** Rebuild layout-dependent timelines only on a meaningful resize (§8); ignores address-bar jitter. */
export const RESIZE = { dx: 2, dy: 150 } as const

/** Budgets (§4, §9), checked in QA rather than enforced at runtime. */
export const BUDGET = {
  pinsLanding: 4,
  pinnedViewportsDesktop: 9,
  pinnedViewportsMobile: 5,
  liveTriggers: 40,
} as const

/** Media queries shared with gsap.matchMedia. */
export const MQ = {
  desktop: '(min-width: 1024px)',
  mobile: '(max-width: 1023.98px)',
  motion: '(prefers-reduced-motion: no-preference)',
  fine: '(pointer: fine)',
  /** a mouse, not a stylus or a finger: the custom cursor and hover-driven detail */
  hover: '(hover: hover) and (pointer: fine)',
} as const

/**
 * True when entrance animations should run. The `js-ready` class is set by an inline
 * head script only when motion is allowed, so without JS (or with reduced motion)
 * every pre-animation state is simply never applied.
 */
export function motionOK(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('js-ready')
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MQ.desktop).matches
}
