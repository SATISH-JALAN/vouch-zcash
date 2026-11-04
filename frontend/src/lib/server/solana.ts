// Solana side of the demo: instruction builders for pof-gate and pof-credit (encoded by hand
// from the IDL discriminators, Borsh layout), and the relayer that sends them. Server-only:
// it holds devnet demo keys. Also imported by scripts/solana-setup.ts.

import {
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Commitment,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import bs58 from 'bs58'
import gateIdl from '../../data/idl/pof_gate.json' with { type: 'json' }
import creditIdl from '../../data/idl/pof_credit.json' with { type: 'json' }

const disc = (idl: { instructions: { name: string; discriminator: number[] }[] }, name: string) =>
  Buffer.from(idl.instructions.find((i) => i.name === name)!.discriminator)

export const GATE_ID = new PublicKey(process.env.POF_GATE_ID ?? gateIdl.address)
export const CREDIT_ID = new PublicKey(process.env.POF_CREDIT_ID ?? creditIdl.address)

const u8 = (n: number) => Buffer.from([n])
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: bigint | number) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
const vecBytes = (b: Uint8Array) => Buffer.concat([u32(b.length), Buffer.from(b)])

export const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0]
export const configPda = () => pda([Buffer.from('config')], GATE_ID)
export const receiptPda = (subject: Uint8Array) => pda([Buffer.from('receipt'), subject], GATE_ID)
export const poolPda = (mint: PublicKey) => pda([Buffer.from('pool'), mint.toBuffer()], CREDIT_ID)
export const vaultPda = (pool: PublicKey) => pda([Buffer.from('vault'), pool.toBuffer()], CREDIT_ID)
/** One line per proof: keyed by the receipt's subject (the proof id) and the borrower. */
export const linePda = (subject: Uint8Array, borrower: PublicKey) => pda([Buffer.from('line'), subject, borrower.toBuffer()], CREDIT_ID)
export const consumerPda = () => pda([Buffer.from('consumer')], CREDIT_ID)
const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
/** pof-gate's ProgramData, which names its upgrade authority: only that key may initialize. */
export const gateProgramDataPda = () => pda([GATE_ID.toBuffer()], UPGRADEABLE_LOADER)

// ── pof-gate ──────────────────────────────────────────────────────────────

/** The (attestors, threshold, max_age_slots) arguments shared by initialize and set_attestors. */
const attestorSet = (name: string, attestors: PublicKey[], threshold: number, maxAgeSlots: number) =>
  Buffer.concat([disc(gateIdl, name), u32(attestors.length), ...attestors.map((a) => a.toBuffer()), u8(threshold), u64(maxAgeSlots)])

/** `admin` must be pof-gate's upgrade authority (the deployer). */
export function initializeIx(admin: PublicKey, attestors: PublicKey[], threshold: number, maxAgeSlots: number) {
  return new TransactionInstruction({
    programId: GATE_ID,
    keys: [
      { pubkey: configPda(), isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: GATE_ID, isSigner: false, isWritable: false },
      { pubkey: gateProgramDataPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: attestorSet('initialize', attestors, threshold, maxAgeSlots),
  })
}

export function setAttestorsIx(admin: PublicKey, attestors: PublicKey[], threshold: number, maxAgeSlots: number) {
  return new TransactionInstruction({
    programId: GATE_ID,
    keys: [
      { pubkey: configPda(), isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
    ],
    data: attestorSet('set_attestors', attestors, threshold, maxAgeSlots),
  })
}

export function submitIx(payer: PublicKey, message: Uint8Array) {
  const subject = message.slice(13, 45)
  return new TransactionInstruction({
    programId: GATE_ID,
    keys: [
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: receiptPda(subject), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc(gateIdl, 'submit_attestation'), Buffer.from(subject), vecBytes(message)]),
  })
}

// ── pof-credit ────────────────────────────────────────────────────────────

export function initPoolIx(authority: PublicKey, mint: PublicKey, audience: Uint8Array, requiredZat: bigint, lineLimit: bigint) {
  const pool = poolPda(mint)
  return new TransactionInstruction({
    programId: CREDIT_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultPda(pool), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc(creditIdl, 'init_pool'), Buffer.from(audience), u64(requiredZat), u64(lineLimit)]),
  })
}

/** `payer` funds the CreditLine's rent; the borrower only signs. */
export function openLineIx(pool: PublicKey, borrower: PublicKey, payer: PublicKey, receipt: PublicKey, subject: Uint8Array) {
  return new TransactionInstruction({
    programId: CREDIT_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: linePda(subject, borrower), isSigner: false, isWritable: true },
      { pubkey: borrower, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: consumerPda(), isSigner: false, isWritable: false },
      { pubkey: CREDIT_ID, isSigner: false, isWritable: false },
      { pubkey: GATE_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc(creditIdl, 'open_line'),
  })
}

/** The borrower signs; the pool's vault pays `amount` (base units) into the borrower's token account. */
export function drawIx(pool: PublicKey, vault: PublicKey, line: PublicKey, borrower: PublicKey, borrowerToken: PublicKey, amount: bigint) {
  return new TransactionInstruction({
    programId: CREDIT_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: line, isSigner: false, isWritable: true },
      { pubkey: borrower, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: borrowerToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc(creditIdl, 'draw'), u64(amount)]),
  })
}

// ── accounts ──────────────────────────────────────────────────────────────

/** ClaimReceipt.subject: the first field after the discriminator. */
export const receiptSubject = (data: Buffer) => data.subarray(8, 40)

export interface PoolAccount {
  authority: PublicKey
  mint: PublicKey
  vault: PublicKey
  audience: Buffer
  requiredZatoshi: bigint
  lineLimit: bigint
}

export function decodePool(data: Buffer): PoolAccount {
  let o = 8
  const pk = () => new PublicKey(data.subarray(o, (o += 32)))
  const authority = pk()
  const mint = pk()
  const vault = pk()
  const audience = data.subarray(o, (o += 32))
  const requiredZatoshi = data.readBigUInt64LE(o)
  const lineLimit = data.readBigUInt64LE(o + 8)
  return { authority, mint, vault, audience, requiredZatoshi, lineLimit }
}

// ── keys and connection ───────────────────────────────────────────────────

export function keypairFrom(secret: string | undefined, name: string): Keypair {
  if (!secret) throw new Error(`${name} is not set`)
  const s = secret.trim()
  try {
    const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s) as number[]) : bs58.decode(s)
    return Keypair.fromSecretKey(bytes)
  } catch {
    // Never rethrow the parser's message: JSON.parse quotes the input, which is the key.
    throw new Error(`${name} is not a valid keypair (a JSON byte array or base58)`)
  }
}

export function connection(commitment: Commitment = 'confirmed') {
  const url = process.env.SOLANA_RPC_URL
  if (!url) throw new Error('SOLANA_RPC_URL is not set')
  return new Connection(url, commitment)
}

export function explorer(kind: 'tx' | 'address', id: string) {
  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet'
  // Only the origin: a path or query can carry an RPC provider's API key.
  const custom = cluster === 'localnet' ? `?cluster=custom&customUrl=${encodeURIComponent(rpcOrigin())}` : `?cluster=${cluster}`
  return `https://explorer.solana.com/${kind}/${id}${custom}`
}

/** The Ed25519 precompile instruction for one attestor signature; all offsets point into itself. */
export function ed25519Ix(attestor: PublicKey, message: Uint8Array, signature: Uint8Array) {
  return Ed25519Program.createInstructionWithPublicKey({ publicKey: attestor.toBytes(), message, signature })
}

export async function send(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs)
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed', skipPreflight: false })
}

function rpcOrigin(): string {
  try {
    return new URL(process.env.SOLANA_RPC_URL ?? '').origin
  } catch {
    return ''
  }
}

/**
 * Remove the RPC endpoint from a message bound for a browser. web3.js reports a network failure
 * as node-fetch's "request to <full url> failed", and a provider's URL carries its API key.
 */
export function redact(message: string): string {
  let out = message
  const url = process.env.SOLANA_RPC_URL
  if (url) out = out.split(url).join('<rpc>')
  const origin = rpcOrigin()
  if (origin) out = out.split(origin).join('<rpc>')
  return out.replace(/\b(?:https?|wss?):\/\/[^\s'"`)]+/gi, '<url>')
}

/**
 * Whether a failed send was refused by the chain (simulation or execution ran and said no), as
 * opposed to never getting there (RPC down, timeout, blockhash fetch failed). Only the first is
 * a program's refusal; the demo must not present an outage as one.
 */
export function refusedByChain(err: unknown): boolean {
  const e = err as { message?: string; logs?: unknown; transactionLogs?: unknown }
  if (Array.isArray(e.logs) || Array.isArray(e.transactionLogs)) return true
  return /simulation failed|custom program error|InstructionError|instruction \d+|already in use|signature verification|precompile/i.test(e.message ?? '')
}

/** Sent, but its fate is unknown: the confirmation timed out or the blockhash expired while waiting.
 *  It may have landed, so it must not be reported (or refunded) as refused. */
export function unconfirmed(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  return /TransactionExpired/.test(e.name ?? '') || /not confirmed in|block ?height exceeded|has expired/i.test(e.message ?? '')
}

/** Turn a failed send into the program error a person can read. Never carries the RPC URL. */
export function explain(err: unknown): string {
  const e = err as { message?: string; logs?: string[]; transactionLogs?: string[] }
  const logs = e.logs ?? e.transactionLogs ?? []
  const anchor = logs.find((l) => l.includes('Error Message:'))
  if (anchor) return redact(anchor.replace(/^.*Error Message: /, '').replace(/\.$/, ''))
  const custom = /custom program error: (0x[0-9a-f]+)/i.exec(e.message ?? '')
  if (custom) return `program error ${custom[1]}`
  return redact((e.message ?? String(err)).split('\n')[0]!)
}

export { bs58 }
