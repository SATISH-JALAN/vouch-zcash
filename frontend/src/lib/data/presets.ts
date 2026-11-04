import type { Preset } from './types.ts'
import { DEMO_AUDIENCE } from './chain.ts'

// Every preset is a real proof served from /proofs. The first was made by `pof-prove prove` from a
// real Zcash testnet wallet, against a testnet anchor rebuilt by pof-anchor. The rest were written
// by `pof-prove demo fixtures` (backend) and verify against the demo anchor: real Ironwood notes and
// real Halo2 proofs, in a published demo tree rather than the chain's. The page says so wherever a
// demo or testnet anchor is used.

const A = DEMO_AUDIENCE.id

export const PRESETS: Preset[] = [
  {
    id: 'testnet-dormant',
    label: 'Real testnet: unmoved since 4,410,000',
    note: 'Holds ≥ 1 TAZ in notes from a real testnet wallet that were in the chain at block 4,410,000 and are still unspent at block 4,459,000.',
    audience: 'vouch:testnet-demo',
    file: 'testnet-dormant.pof',
  },
  { id: 'testnet-valid', label: 'A real Zcash testnet proof', note: 'Holds ≥ 1 TAZ, from a real testnet wallet as of block 4,410,000, valid until 26 Jan 2027.', audience: 'vouch:testnet-demo', file: 'testnet-valid.pof' },
  {
    id: 'testnet-exit',
    label: 'Real testnet: an exit certificate',
    note: 'At least 1 TAZ at block 4,460,391, made with circuit 2 so it names its notes. The testnet deposit that spends exactly them (ff0a2488…) is matched on /rail.',
    audience: 'rail:testnet-demo',
    file: 'testnet-exit.pof',
  },
  { id: 'valid', label: 'A valid proof', note: 'Holds ≥ 500 ZEC, made for the demo pool, valid until 1 Jan 2027.', audience: A, file: 'valid.pof' },
  {
    id: 'dormant',
    label: 'Unmoved since block 3,481,000',
    note: 'Holds ≥ 500 ZEC in notes that were already in the demo ledger at block 3,481,000 and have not moved since: the tree from one block, the spent set from a later one.',
    audience: A,
    file: 'dormant.pof',
  },
  {
    id: 'dormant-too-young',
    label: 'Not unmoved long enough',
    note: 'The same proof, checked by a verifier that requires the notes unmoved since block 3,480,000 or earlier.',
    audience: A,
    file: 'dormant-too-young.pof',
    policy: { dormantSince: 3_480_000 },
  },
  {
    id: 'anchor-too-old',
    label: 'Too old for this verifier',
    note: 'A valid proof, checked by a verifier that knows the chain is at block 3,493,040 and wants the spent set at most 1,000 blocks old.',
    audience: A,
    file: 'anchor-too-old.pof',
    policy: { tipHeight: 3_493_040, maxAnchorAge: 1_000 },
  },
  { id: 'tampered', label: 'A tampered proof', note: 'The same proof with one byte of Halo2 evidence flipped, then re-sealed like a forger would.', audience: A, file: 'tampered.pof' },
  { id: 'expired', label: 'An expired proof', note: 'A real proof whose expiry passed on 22 Sep 2026.', audience: A, file: 'expired.pof' },
  { id: 'revoked', label: 'A revoked proof', note: 'Its holder published the revocation secret. Nothing else about it changed.', audience: A, file: 'revoked.pof' },
  { id: 'wrong-audience', label: 'Made for someone else', note: 'A valid proof addressed to an OTC desk, checked here by the demo pool.', audience: A, file: 'wrong-audience.pof' },
  { id: 'forged-claim', label: 'A forged claim', note: '“500 ZEC” edited to “5,000 ZEC” after proving, then re-sealed.', audience: A, file: 'forged-claim.pof' },
  { id: 'readdressed', label: 'A re-addressed proof', note: 'Someone handed a proof edits the audience to themselves. Checked as that someone.', audience: 'otc-desk:someone-else', file: 'readdressed.pof' },
]
