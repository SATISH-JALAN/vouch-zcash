// Chain facts used across the site. Everything here is either real and sourced,
// or explicitly a fixture value. Keep the two kinds labelled.

/**
 * A real, finalised Zcash mainnet block (checked on a public explorer, 21 Sep 2026).
 * The demo ledger's anchor uses this height; its roots are the demo tree's, and the anchor
 * table labels it `network: "demo"`. Mainnet anchors come from pof-anchor.
 */
export const ANCHOR = {
  height: 3_491_040,
  blockHash: '0000000000964cffafcc1c04c052903249273098acd68044a52361d58d4fdaae',
  time: '2026-09-21T11:01:48Z',
} as const

/** First block of the Ironwood pool (NU6.3). Source: The Block, 28 Jul 2026. */
export const IRONWOOD_ACTIVATION_HEIGHT = 3_428_143

/** First block of the Ironwood pool on Zcash testnet (NU6.3). Source: ZIP 258; zcash_protocol TEST_NETWORK. */
export const IRONWOOD_ACTIVATION_HEIGHT_TESTNET = 4_134_000

/** Ironwood network upgrade activation. Source: CoinDesk, 28 Jul 2026. */
export const IRONWOOD_ACTIVATION = '28 Jul 2026'

/** Value sealed into the shielded pool at Ironwood activation. Source: CoinDesk, 28 Jul 2026. */
export const SHIELDED_POOL_USD = '$1.7B'

/** The demo lending pool's verifier identifier. The proof carries only its hash. */
export const DEMO_AUDIENCE = {
  id: 'pof-credit:usdc-pool-1',
  label: 'pof-credit · USDC pool 1',
} as const

/** 500 ZEC — the demo pool's required threshold. */
export const DEMO_THRESHOLD_ZAT = 50_000_000_000

/** Real Solana native program and sysvar ids. */
export const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111'
export const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111'
