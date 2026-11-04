import type { Claim } from '@/lib/data/types'
import { claimParts, formatInt } from '@/lib/format'
import { cx } from './primitives'

/**
 * A claim as a sentence. Only the disclosed value takes --seal, and only when the fact
 * has actually been established. An unverified claim renders without the seal.
 * A disclosed value carries a bar ([data-claim-bar]) that rests lifted; a verdict lowers and lifts it
 * as the fact is disclosed.
 */
export function ClaimLine({
  claim,
  anchorHeight,
  dormantSince,
  network,
  disclosed = true,
  className,
}: {
  claim: Claim
  anchorHeight?: number
  /** The block since which the notes have not moved, when the proof says so. */
  dormantSince?: number
  network?: string
  disclosed?: boolean
  className?: string
}) {
  const p = claimParts(claim, network)
  return (
    <p className={cx('t-body text-ink', className)}>
      {p.before}{' '}
      <span className="relative inline-block">
        <span data-claim-value="" className={cx('font-mono', disclosed ? 'text-seal' : 'text-ink-2')}>
          {p.value}
        </span>
        {disclosed && <span data-claim-bar="" className="redact-bar" style={{ transform: 'scaleX(0)' }} aria-hidden />}
      </span>
      {p.after && ` ${p.after}`}
      {anchorHeight !== undefined && (
        <>
          {' '}as of {network === 'testnet' ? 'testnet ' : ''}block <span className="font-mono">{formatInt(anchorHeight)}</span>
        </>
      )}
      {dormantSince !== undefined && (
        <>
          , unmoved since block <span className="font-mono">{formatInt(dormantSince)}</span>
        </>
      )}
      .
    </p>
  )
}
