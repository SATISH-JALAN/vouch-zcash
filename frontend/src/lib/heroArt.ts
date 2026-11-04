/**
 * The hero painting, as the iris needs to know it: where the seal sits and how big the card is, in
 * source pixels. Swap a source here (or add a `detail` crop) and the iris follows; nothing else
 * hard-codes these numbers. Coordinates were measured from the files' own pixels.
 */
export interface HeroArt {
  src: string
  w: number
  h: number
  /** the wax seal's centre, as fractions of the image */
  seal: [number, number]
  /** the card's larger side, in source px: the end circle is sized to frame it */
  card: number
  /** the wax seal's diameter, in source px: the vector seal takes over at exactly this size */
  wax: number
  /** the CSS object-position the painting rests at, so the hand layout matches it exactly */
  position: [number, number]
  /**
   * Optional sharper crop of the card, drawn over the painting as it pushes in.
   * `rect` is where the crop sits, in this image's source px.
   */
  detail?: { src: string; rect: [x: number, y: number, w: number, h: number] }
  /**
   * The loop over it. It is a crop of this painting: one of its pixels is `k` of the painting's, and
   * its top-left corner sits at `at` in the painting's px (registered from the files' own pixels).
   * The iris lays the painting out under the loop exactly, so pausing the loop never changes the picture.
   */
  loop?: { clip: string; w: number; h: number; k: number; at: [x: number, y: number] }
}

/** ≥768px: the landscape painting. Seal measured at (1034, 302) of 1536×1024; card 42×44. */
export const HERO_WIDE: HeroArt = {
  src: '/visuals/hero.webp',
  w: 1536,
  h: 1024,
  seal: [0.6732, 0.2947],
  card: 48,
  wax: 16,
  position: [0.5, 0.4],
  loop: { clip: 'hero', w: 1280, h: 720, k: 1.2, at: [0, 79.2] },
}

/** <768px: the portrait painting. Seal measured at (617, 585) of 1122×1402; card 51×69. */
export const HERO_PORTRAIT: HeroArt = {
  src: '/visuals/hero-mobile.webp',
  w: 1122,
  h: 1402,
  seal: [0.5499, 0.417],
  card: 69,
  wax: 11,
  position: [0.5, 0.3],
  loop: { clip: 'hero-mobile', w: 720, h: 1280, k: 1.09, at: [170, 4.4] },
}

/**
 * The closing painting: the through-line object lands on its seal. Seal measured at (768, 451) of
 * 1536×1024; the wax is 1.7% of the painting's width. `position` matches its object-position.
 */
export const CLOSING_ART = {
  w: 1536,
  h: 1024,
  seal: [0.4999, 0.4408] as [number, number],
  wax: 0.017,
  position: [0.5, 0] as [number, number],
}

/** Must match the <source media> in HeroMedia. */
export const HERO_WIDE_MQ = '(min-width: 768px)'
