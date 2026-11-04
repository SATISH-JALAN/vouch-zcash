import type { Check, Envelope } from './data/types'
import { claimParts, formatDate, formatInt } from './format'
import { isUnbound } from './pof/codec'
import { fromHex, toBase58 } from './pof/bytes'

/** What a proof can never tell anyone, whoever holds it. */
export const NEVER = [
  { label: 'Exact balance', width: 16 },
  { label: 'Which notes', width: 11 },
  { label: 'How many notes', width: 7 },
  { label: 'Any address', width: 22 },
  { label: 'Payment history', width: 14 },
  { label: 'Counterparties', width: 9 },
  { label: 'Future payments', width: 12 },
]

const AUDIENCE = { pass: 'you — the audience hash matches', fail: 'someone else', 'not-run': 'not checked: an earlier check failed' } as const

/** What a verifier learns from one proof file, and what it can never learn. Only checks that ran are reported as facts. */
export function revealRows(env: Envelope, checks: Check[], network?: string) {
  const p = claimParts(env.claim, network)
  const established = checks.every((c) => c.status === 'pass')
  const audience = checks.find((c) => c.id === 'audience')?.status ?? 'not-run'
  return {
    learn: [
      { label: 'The claim', value: `${p.before} ${p.value}${p.after ? ` ${p.after}` : ''}${established ? '' : ' (not established)'}` },
      { label: 'As of', value: `block ${formatInt(env.anchor.height)}` },
      ...(env.anchor.ncHeight < env.anchor.height
        ? [{ label: 'Unmoved since', value: `block ${formatInt(env.anchor.ncHeight)}: the notes were in the chain then and have not been spent since` }]
        : []),
      { label: 'Made for', value: AUDIENCE[audience] },
      ...(isUnbound(env.binding) ? [] : [{ label: 'Bound to', value: `Solana account ${toBase58(fromHex(env.binding))}` }]),
      { label: 'Valid until', value: formatDate(env.expiresAt) },
      { label: 'Revocable', value: 'yes, by the holder, any time before expiry' },
    ],
    never: NEVER,
  }
}
