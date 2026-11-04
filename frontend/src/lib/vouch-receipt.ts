// Vouch Receipts: "order N was paid by the holder of these notes", shown to one party, with the
// wallet kept private. A receipt is an exit certificate bound to the order (its intent), plus the
// payment transaction it was matched against. Nothing new is proven: the certificate already names
// the notes by their nullifiers and is signed with their spend authority; the payment reveals those
// nullifiers when it spends them. The receipt just keeps the two together with the order.
//
// The same rules run in pof-attest (`POST /v1/receipts/verify`), which also re-reads the payment's
// nullifiers from lightwalletd instead of trusting the ones the receipt carries.

import type { Check, CheckStatus, Policy, VerificationResult } from './data/types.ts'
import { fromBase64Url } from './pof/bytes.ts'
import { intentBinding } from './pof/hash.ts'

export const RECEIPT_TYPE = 'vouch.receipt'

export interface VouchReceipt {
  type: typeof RECEIPT_TYPE
  version: 1
  order: {
    /** Who sold it, as the holder names it ("bitrefill", "demo rail"). Not authenticated. */
    merchant: string
    /** The merchant's order or invoice id. Must appear in the intent. */
    id: string
    /** The string the certificate is bound to: blake2b("vouch-intent-v1", intent) == binding. */
    intent: string
    description?: string
    /** What the merchant charged, as the merchant shows it ("500 INR", "6.12 USDC"). Not proven. */
    price?: string
  }
  /** The rail the certificate was made for: its identifier and period. */
  rail: { audience: string; epoch: number }
  /** The exit certificate, base64url .pof. */
  certificate: string
  payment: {
    network: 'mainnet' | 'testnet' | 'demo'
    txid?: string
    height?: number
    /** Unix seconds. Used only to check a certificate that has since expired. */
    paidAt?: number
    /** The Ironwood nullifiers the payment reveals (hex). pof-attest re-reads them from the chain. */
    nullifiers: string[]
  }
  issuedAt: number
  note?: string
}

export type ReceiptVerdict =
  | { kind: 'Valid'; spent: number; asOfPayment: boolean }
  | { kind: 'Malformed'; reason: string }
  | { kind: 'CertificateRefused'; certificate: VerificationResult['verdict'] }
  | { kind: 'NotACertificate' }
  | { kind: 'WrongOrder' }
  | { kind: 'NoShieldedSpend' }
  | { kind: 'NotPaidByCertifiedNotes'; notCertified: string[] }

export type ReceiptCheckId = 'format' | 'certificate' | 'exit' | 'order' | 'payment'

export interface ReceiptResult {
  verdict: ReceiptVerdict
  checks: (Omit<Check, 'id'> & { id: ReceiptCheckId })[]
  certificate: VerificationResult | null
  receipt: VouchReceipt | null
}

const LABELS: Record<ReceiptCheckId, string> = {
  format: 'Receipt parses',
  certificate: 'Certificate verifies (all six checks)',
  exit: 'It is an exit certificate (names its notes)',
  order: 'Certificate is bound to this order',
  payment: 'Payment spends only certified notes',
}

const HEX32 = /^[0-9a-f]{64}$/

/** The receipt's shape, or why not. Unknown extra fields are ignored; required ones are checked. */
export function parseReceipt(input: unknown): VouchReceipt | string {
  const r = input as Partial<VouchReceipt> | null
  if (!r || typeof r !== 'object') return 'a receipt is a JSON object'
  if (r.type !== RECEIPT_TYPE || r.version !== 1) return `not a ${RECEIPT_TYPE} version 1 file`
  const o = r.order
  if (!o || typeof o.merchant !== 'string' || typeof o.id !== 'string' || typeof o.intent !== 'string' || !o.id.trim()) return 'the receipt names no order'
  if (!o.intent.includes(o.id)) return 'the order id does not appear in the intent the certificate is bound to'
  if (!r.rail || typeof r.rail.audience !== 'string' || !Number.isSafeInteger(r.rail.epoch)) return 'the receipt names no rail (audience and period)'
  if (typeof r.certificate !== 'string' || !fromBase64Url(r.certificate)) return 'the certificate is not base64url'
  const p = r.payment
  if (!p || !['mainnet', 'testnet', 'demo'].includes(p.network) || !Array.isArray(p.nullifiers)) return 'the receipt names no payment'
  if (!p.nullifiers.every((n) => typeof n === 'string' && HEX32.test(n.toLowerCase()))) return 'payment nullifiers are 32 bytes of hex'
  return r as VouchReceipt
}

type VerifyFn = (bytes: Uint8Array, audience: string, o: { policy: Policy; now?: number }) => Promise<VerificationResult>

/**
 * Five checks, cheapest first; the first failure decides the verdict and the rest are not run.
 * `verify` is the WASM verifier (or anything with its contract). A certificate that has expired
 * since is checked as of the payment, when the receipt says when that was and it falls inside the
 * certificate's validity: a receipt is about the past.
 */
export async function checkReceipt(input: unknown, verify: VerifyFn): Promise<ReceiptResult> {
  const checks: ReceiptResult['checks'] = []
  const status = (id: ReceiptCheckId, s: CheckStatus, detail: string) => checks.push({ id, label: LABELS[id], status: s, detail })
  const finish = (verdict: ReceiptVerdict, receipt: VouchReceipt | null, certificate: VerificationResult | null): ReceiptResult => {
    for (const id of Object.keys(LABELS) as ReceiptCheckId[]) if (!checks.some((c) => c.id === id)) status(id, 'not-run', 'Not run — an earlier check failed.')
    return { verdict, checks, certificate, receipt }
  }

  const parsed = parseReceipt(input)
  if (typeof parsed === 'string') {
    status('format', 'fail', parsed)
    return finish({ kind: 'Malformed', reason: parsed }, null, null)
  }
  const r = parsed
  status('format', 'pass', `Order ${r.order.id} at ${r.order.merchant}; certificate for ${r.rail.audience}, period ${r.rail.epoch}.`)

  const bytes = fromBase64Url(r.certificate)!
  const policy: Policy = { epoch: r.rail.epoch }
  let cert = await verify(bytes, r.rail.audience, { policy })
  let asOfPayment = false
  const env = cert.envelope
  if (cert.verdict.kind === 'Expired' && env && r.payment.paidAt && r.payment.paidAt >= env.issuedAt && r.payment.paidAt < env.expiresAt) {
    cert = await verify(bytes, r.rail.audience, { policy, now: r.payment.paidAt })
    asOfPayment = true
  }
  if (cert.verdict.kind !== 'Valid' || !cert.envelope) {
    status('certificate', 'fail', `The certificate is ${cert.verdict.kind}.`)
    return finish({ kind: 'CertificateRefused', certificate: cert.verdict }, r, cert)
  }
  status('certificate', 'pass', asOfPayment ? 'Valid as of the payment (it has expired since).' : `Valid, in ${cert.elapsedMs} ms.`)

  if (!cert.revealed.length) {
    status('exit', 'fail', 'A valid proof, but it names no notes, so no payment can be matched to it.')
    return finish({ kind: 'NotACertificate' }, r, cert)
  }
  status('exit', 'pass', `It names ${cert.revealed.length} nullifiers (the notes it certifies, and padding).`)

  if (cert.envelope.binding !== intentBinding(r.order.intent)) {
    status('order', 'fail', 'The certificate is bound to a different order: this receipt was edited, or put together from another one.')
    return finish({ kind: 'WrongOrder' }, r, cert)
  }
  status('order', 'pass', `Bound to “${r.order.intent}”: the holder signed for this order, before paying.`)

  const nfs = r.payment.nullifiers.map((n) => n.toLowerCase())
  if (!nfs.length) {
    status('payment', 'fail', 'The payment spends no shielded notes.')
    return finish({ kind: 'NoShieldedSpend' }, r, cert)
  }
  const notCertified = nfs.filter((n) => !cert.revealed.includes(n))
  if (notCertified.length) {
    status('payment', 'fail', `${notCertified.length} of the ${nfs.length} notes it spends are not in the certificate.`)
    return finish({ kind: 'NotPaidByCertifiedNotes', notCertified }, r, cert)
  }
  const spent = new Set(nfs).size
  status('payment', 'pass', `Every note the payment spends (${spent}) is one the certificate named.`)
  return finish({ kind: 'Valid', spent, asOfPayment }, r, cert)
}
