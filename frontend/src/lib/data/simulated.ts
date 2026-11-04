// SIMULATED stand-ins for the attestor and the Solana programs, used on /demo only when
// /api/status reports they are not configured for this deployment. Every surface that shows
// their output carries a SIMULATED label. Step 1 of the demo — verifying the proof — is never
// simulated: it always runs the real WASM verifier.

import type { Attestation, AttestOutcome, CreditLine, Envelope, GateTransaction, SubmitOutcome, VerificationResult } from './types.ts'
import { DEMO_THRESHOLD_ZAT, ED25519_PROGRAM } from './chain.ts'
import { blake2b } from '../pof/blake2b.ts'
import { concat, fromHex, hex, stream, toBase58, utf8 } from '../pof/bytes.ts'
import { encodeBody } from '../pof/codec.ts'

export const SIM_ATTESTOR = toBase58(stream('attestor:ed25519:pub', 32))
export const SIM_GATE_ID = toBase58(stream('program:pof-gate', 32))
export const SIM_CREDIT_ID = toBase58(stream('program:pof-credit', 32))
const SIM_SLOT = 441_208_337

/** The same byte layout pof-attest signs; see backend/crates/pof-attest. */
export function attestationMessage(a: Omit<Attestation, 'message' | 'signature' | 'attestor' | 'domain'> & { audience: string }): Uint8Array {
  const msg = new Uint8Array(139)
  const dv = new DataView(msg.buffer)
  msg.set(utf8('POF-ATTEST-v1'), 0)
  msg.set(fromHex(a.subject), 13)
  msg.set(fromHex(a.beneficiary.length === 64 ? a.beneficiary : '00'.repeat(32)), 45)
  msg.set(fromHex(a.audience), 77)
  dv.setUint8(109, a.claimKind)
  dv.setBigUint64(110, BigInt(a.claimValue), true)
  dv.setUint32(118, a.anchorHeight, true)
  dv.setBigUint64(122, BigInt(a.expiresAt), true)
  dv.setUint8(130, a.verdict)
  dv.setBigUint64(131, BigInt(a.slot), true)
  return msg
}

function subjectOf(env: Envelope) {
  return hex(blake2b(concat(utf8('sim-subject:'), encodeBody({ ...env, evidence: { publicInputs: [], proof: new Uint8Array(), signature: '00'.repeat(64) } }))))
}

export async function attest(result: VerificationResult, attestorDown: boolean): Promise<AttestOutcome> {
  if (attestorDown) {
    return { ok: false, reason: 'unreachable', message: 'Attestor unreachable (simulated): connection refused. Nothing was signed and nothing reached Solana.' }
  }
  if (result.verdict.kind !== 'Valid' || !result.envelope) {
    return { ok: false, reason: 'refused', verdict: result.verdict, message: `The attestor ran pof-verify, got ${result.verdict.kind}, and refused to sign.` }
  }
  const env = result.envelope
  const base = { subject: subjectOf(env), beneficiary: env.binding, claimKind: 0, claimValue: env.claim.zatoshi, anchorHeight: env.anchor.height, expiresAt: env.expiresAt, verdict: 0, slot: SIM_SLOT }
  const msg = attestationMessage({ ...base, audience: env.audience })
  return {
    ok: true,
    attestation: { domain: 'POF-ATTEST-v1', ...base, beneficiary: toBase58(fromHex(env.binding)), message: hex(msg), signature: hex(stream(`attestor:sig:${hex(msg)}`, 64)), attestor: SIM_ATTESTOR },
  }
}

export async function submit(att: Attestation, opts: { tamperAttestation?: boolean }): Promise<SubmitOutcome> {
  if (opts.tamperAttestation) {
    return {
      ok: false,
      failedAt: 'Instruction 0 · Ed25519SigVerify',
      message: 'The Ed25519 native program rejected the signature: one byte of the attestation message was changed after signing. The transaction failed before pof-gate ran. No receipt exists.',
    }
  }
  const receipt = toBase58(blake2b(utf8(`receipt:${att.subject}`)))
  const tx: GateTransaction = {
    signature: toBase58(stream(`tx:${att.message}`, 64)),
    slot: att.slot + 3,
    receipt,
    instructions: [
      { index: 0, program: 'Ed25519 native program', programId: ED25519_PROGRAM, summary: `verify sig by ${att.attestor.slice(0, 6)}… over ${att.message.length / 2} bytes` },
      { index: 1, program: 'pof-gate', programId: SIM_GATE_ID, summary: 'submit_attestation → ClaimReceipt created' },
    ],
  }
  return { ok: true, tx }
}

/** The vault pays 1,000 into the borrower's account; the line's limit caps the total. */
export async function draw(line: CreditLine): Promise<{ ok: true; amount: string; drawn: string } | { ok: false; message: string; failedAt: string }> {
  const n = (s: string) => Number(s.replace(/[^0-9.]/g, ''))
  const drawn = n(line.drawn) + 1_000
  if (drawn > n(line.limit)) return { ok: false, failedAt: 'pof-credit · draw', message: 'Simulated: the draw would exceed the line’s limit, so pof-credit refuses.' }
  return { ok: true, amount: '1,000.00 USDC', drawn: `${drawn.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC` }
}

export async function openLine(tx: GateTransaction): Promise<CreditLine> {
  return {
    account: toBase58(blake2b(utf8(`line:${tx.receipt}`))),
    pool: toBase58(blake2b(utf8('pool:usdc-1'))),
    limit: '25,000.00 USDC',
    drawn: '0.00 USDC',
    openedAgainst: tx.receipt,
    requiredZatoshi: DEMO_THRESHOLD_ZAT,
  }
}
