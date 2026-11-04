import type { VerificationResult } from './data/types'
import { formatStamp } from './format'
import { downloadBytes } from './files'

/**
 * The verifier's audit record: what was checked, against what, by which verifier build, and
 * when. It holds the file's checksum, not the proof, so filing it discloses nothing new.
 */
export function receiptFor(result: VerificationResult, audience: string) {
  return {
    type: 'vouch.verification-receipt',
    version: 1,
    checkedAt: result.now,
    checkedAtUtc: formatStamp(result.now),
    verifier: result.verifier,
    verifiedAs: audience,
    verdict: result.verdict,
    claim: result.envelope?.claim ?? null,
    anchor: result.anchor ?? (result.envelope ? { height: result.envelope.anchor.height, network: 'unknown' } : null),
    expiresAt: result.envelope?.expiresAt ?? null,
    revocationTag: result.envelope?.revocation ?? null,
    file: { checksum: result.checksum, sizeBytes: result.sizeBytes },
    checks: result.checks.map(({ id, status, detail }) => ({ id, status, detail })),
  }
}

export function downloadReceipt(result: VerificationResult, audience: string) {
  downloadBytes(JSON.stringify(receiptFor(result, audience), null, 2), `vouch-receipt-${result.now}.json`, 'application/json')
}
