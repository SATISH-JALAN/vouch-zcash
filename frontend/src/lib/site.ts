// Site-wide copy constants and links. A dead link is worse than no link:
// anything set to null is not rendered until it has a real URL.

export const BRAND = 'Vouch'

export const TAGLINE = 'Prove what you hold. Reveal nothing else.'

export const DESCRIPTION =
  'The disclosure layer for shielded Zcash. Instead of a viewing key, prove one fact to one party: at least X ZEC, in notes unmoved since block H, and these are the notes in the deposit. Anyone can check it against the public chain.'

export const SUBMISSION = {
  event: "CRYPTO WORLD'S FAIR 2026",
  track: 'ZCASH TRACK',
  date: '12 OCT 2026',
} as const

export const LINKS = {
  /** The public repository. */
  repo: 'https://github.com/SATISH-JALAN/Vouch' as string | null,
  /** TODO: set when the Zcash forum thread is posted. */
  forum: null as string | null,
  formatSpec: '/docs/format',
  verifier: '/verify',
  zip311: 'https://zips.z.cash/zip-0311',
  votingCircuits: 'https://github.com/valargroup/voting-circuits',
  zcashVoting: 'https://github.com/chainapsis/zcash_voting',
  ironwood: 'https://www.coindesk.com/tech/2026/07/28/zcash-seals-usd1-7-billion-shielded-pool-as-ironwood-upgrade-activates',
} as const

export const NAV = [
  { href: '/verify', label: 'Verify' },
  { href: '/request', label: 'Request' },
  { href: '/prove', label: 'Prove' },
  // wide: only from the md breakpoint; phones reach them from the footer
  { href: '/rail', label: 'Rail', wide: true },
  { href: '/reserves', label: 'Reserves', wide: true },
  { href: '/demo', label: 'Demo' },
  // the docs are their own site: a new tab, so the page you were on stays open
  { href: '/docs', label: 'Docs', external: true },
] as const
