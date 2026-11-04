// The one place for shared shapes. Mirrors the JSON projection of pof-core / pof-verify
// (backend/crates). If the Rust types change, this file changes in the same commit.

export type ClaimKind = 'HoldsAtLeast' | 'HoldsExactly' | 'ReceivedPayment' | 'ReceivedAtLeastSince'

export type Claim =
  | { kind: 'HoldsAtLeast'; zatoshi: number }
  | { kind: 'HoldsExactly'; zatoshi: number }
  | { kind: 'ReceivedPayment'; txid: string; zatoshi: number }
  | { kind: 'ReceivedAtLeastSince'; zatoshi: number; fromHeight: number }

export interface Anchor {
  /** Finalised block height the proof is "as of": the spent set there does not hold the notes. */
  height: number
  /** Ironwood note-commitment tree root at `ncHeight`, hex. */
  ncRoot: string
  /** Spent-nullifier indexed Merkle tree root at `height`, hex. */
  nfRoot: string
  /** The block whose tree holds the notes. Equal to `height` in version 1; earlier when the proof
   *  says the notes have not moved since then. */
  ncHeight: number
}

export interface Evidence {
  /** Public inputs the verifier cannot derive, 32 bytes each, hex. */
  publicInputs: string[]
  /** Halo2 proof bytes. */
  proof: Uint8Array
  /** RedPallas spend-authorisation signature over the statement, hex. */
  signature: string
}

export interface Envelope {
  version: number
  /** 1: the threshold circuit. 2: threshold plus revealed nullifiers (exit certificates). */
  circuit: number
  claim: Claim
  /** blake2b-256 of the verifier identifier, hex. Never the plaintext name. */
  audience: string
  /** The verifier's period (version 2); with the audience it fixes the scope reuse is seen in. */
  epoch: number
  /** 32 bytes the proof is bound to (e.g. a Solana pubkey), hex. All zero when unbound. */
  binding: string
  anchor: Anchor
  /** Unix seconds. */
  issuedAt: number
  /** Unix seconds, absolute. */
  expiresAt: number
  /** Opaque 16-byte tag, hex. */
  revocation: string
  evidence: Evidence
}

/** An authenticated anchor: both roots at a finalised height, and which ledger they belong to. */
export interface AnchorRecord {
  network: 'mainnet' | 'testnet' | 'demo' | string
  height: number
  blockHash?: string | null
  ncRoot: string
  nfRoot: string
}

/** pof-verify's Verdict. */
export type Verdict =
  | { kind: 'Valid'; claim: Claim; anchorHeight: number; dormantSince?: number }
  | { kind: 'Expired'; at: number }
  | { kind: 'Revoked' }
  | { kind: 'WrongAudience' }
  | { kind: 'AnchorNotFound' }
  | { kind: 'AnchorTooOld'; anchorHeight: number }
  | { kind: 'NotDormantLongEnough'; dormantSince: number; required: number }
  | { kind: 'WrongScope'; epoch: number; required: number }
  | { kind: 'AlreadyUsed' }
  | { kind: 'ProofInvalid'; detail: string }
  | { kind: 'Malformed'; reason: string }

export type CheckId = 'format' | 'expiry' | 'revocation' | 'audience' | 'anchor' | 'proof'

export type CheckStatus = 'pass' | 'fail' | 'not-run'

export interface Check {
  id: CheckId
  label: string
  status: CheckStatus
  detail: string
}

export interface VerificationResult {
  verdict: Verdict
  checks: Check[]
  envelope: Envelope | null
  sizeBytes: number
  checksum: string | null
  /** The authenticated anchor the proof was checked against, when one matched. */
  anchor: AnchorRecord | null
  /** The scope the proof's tags belong to (hex), when it parsed. */
  scope: string | null
  /** The five per-note tags (hex): record them for a Valid verdict as the reuse registry. */
  tags: string[]
  /** An exit certificate's revealed nullifiers (hex); empty for any other proof. */
  revealed: string[]
  elapsedMs: number
  /** Unix seconds the verification was evaluated at. */
  now: number
  /** e.g. "pof-verify 0.1.0" */
  verifier: string
}

export type PresetId =
  | 'valid' | 'tampered' | 'expired' | 'revoked' | 'wrong-audience' | 'forged-claim' | 'extended-expiry' | 'anchor-mismatch'
  | 'readdressed' | 'threshold-4000' | 'onchain' | 'testnet-valid' | 'testnet-dormant' | 'testnet-exit' | 'dormant' | 'dormant-too-young' | 'anchor-too-old'

/** What a verifier additionally requires (pof-verify's Policy). Empty: nothing beyond the six checks. */
export interface Policy {
  /** The chain tip the verifier knows of; with `maxAnchorAge`, refuses a stale spent set. */
  tipHeight?: number
  maxAnchorAge?: number
  /** Require the notes unmoved since this block or earlier. */
  dormantSince?: number
  /** Require this period (the epoch the request named). */
  epoch?: number
}

/** pof-verify's BatchVerdict: a reserves batch either establishes a total or names the member at fault. */
export type BatchVerdict =
  | { kind: 'Valid'; totalZatoshi: number; members: number; anchorHeight: number; dormantSince?: number; scope: string }
  | { kind: 'Invalid'; reason: string; member?: number }
  | { kind: 'Malformed'; reason: string }

export interface BatchResult {
  verdict: BatchVerdict
  members: VerificationResult[]
  sizeBytes: number
  now: number
  verifier: string
  elapsedMs: number
}

export interface Preset {
  id: PresetId
  label: string
  note: string
  /** Identifier to verify as. */
  audience: string
  /** Path under /proofs. */
  file: string
  /** What the verifier requires for this preset, if anything. */
  policy?: Policy
}

export interface ProofRequest {
  v: 1
  /** Random request id, hex. */
  id?: string
  claim: ClaimKind
  /** zatoshi as a decimal string, so large values survive JSON. */
  zatoshi: string
  audience: string
  expiryDays: number
  /** Unix seconds the verifier wants an answer by. */
  respondBy?: number
  /** "solana" when the proof must be bound to the holder's Solana account. */
  bind?: 'solana'
  /** What is asked for: one proof (default), an exit certificate, or a reserves batch. */
  kind?: 'proof' | 'exit' | 'reserves'
  /** The verifier's period: reuse of the same coins within it is visible to them. */
  epoch?: number
  /** The block the notes must be unmoved since (a multiple of 1,000). */
  dormantSince?: number
}

/** The domain-separated message pof-attest signs. */
export interface Attestation {
  domain: 'POF-ATTEST-v1'
  /** Stable proof id: blake2b(statement). One proof, one receipt. */
  subject: string
  /** Solana account the proof is bound to, base58. */
  beneficiary: string
  claimKind: number
  claimValue: number
  anchorHeight: number
  expiresAt: number
  verdict: number
  slot: number
  /** Serialised message bytes, hex. */
  message: string
  signature: string
  /** Attestor Ed25519 pubkey, base58. */
  attestor: string
}

export interface GateTransaction {
  signature: string
  slot: number
  instructions: { index: number; program: string; programId: string; summary: string }[]
  receipt: string
  explorer?: string
}

export interface CreditLine {
  account: string
  pool: string
  limit: string
  drawn: string
  openedAgainst: string
  requiredZatoshi: number
  explorer?: string
  /** The last draw's transaction, once the borrower has drawn. */
  drawExplorer?: string
}

export type AttestOutcome =
  | { ok: true; attestation: Attestation }
  | { ok: false; reason: 'unreachable' | 'refused'; message: string; verdict?: Verdict }

export type SubmitOutcome =
  | { ok: true; tx: GateTransaction }
  | { ok: false; message: string; failedAt: string }

/** What the deployment has configured: drives LIVE vs SIMULATED on /demo and /prove. */
export interface ServiceStatus {
  /** waking: configured but asleep or starting (a free host spins down when idle); ask again. */
  attestor: { ok: boolean; pubkey?: string; message?: string; waking?: boolean }
  demoProver: boolean
  /** No prover, but /demo's one request is answered from pre-made single-use proofs. */
  demoPool: boolean
  solana: { cluster: string; gate: string; credit: string; pool: string } | null
  /** Revocations, counters and rate limits are in a shared store, not one instance's temp file. */
  durable: boolean
}
