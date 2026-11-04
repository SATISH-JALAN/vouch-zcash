// The demo relayer: pays for and sends the demo's Solana transactions with devnet keys held
// here, so a visitor needs no wallet. It holds the borrower key the demo proof is bound to,
// and a "stranger" key for the wrong-wallet run. Everything it does is on a public explorer.
import { Keypair, PublicKey, type Connection } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { formatUnits } from '@/lib/server/units'
import {
  connection, decodePool, drawIx, ed25519Ix, explain, refusedByChain, unconfirmed, explorer, keypairFrom, linePda, openLineIx, receiptPda, receiptSubject, send, submitIx, GATE_ID, CREDIT_ID,
} from '@/lib/server/solana'
import { readJson } from '@/lib/server/http'
import { clientKey, durable, rateLimit, reserve } from '@/lib/server/store'
import type { CreditLine, GateTransaction } from '@/lib/data/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body =
  | { action: 'borrower' }
  | { action: 'submit'; attestation: { message: string; signature: string; attestor: string }; tamper?: boolean }
  | { action: 'open-line'; receipt: string; wallet?: 'borrower' | 'stranger' }
  | { action: 'draw'; line: string }

/** What one draw pays out: 1,000 dUSDC (6 decimals). */
const DRAW = 1_000_000_000n

// Every transaction that lands costs the relayer a fee plus rent (a ClaimReceipt, a CreditLine,
// a token account), and anyone can ask for one. Each send takes a unit of both budgets first (per
// client, and for the whole deployment); a transaction the chain refused in preflight cost
// nothing and gives its unit back. One whose fate is unknown (a timeout) keeps it.
const HOUR = 3_600_000
const PER_CLIENT_PER_HOUR = 20
const ALL_PER_HOUR = 120

// The 139-byte attestation message (pof-attest attestation_message): byte ranges.
const SUBJECT = [13, 45] as const
const BENEFICIARY = [45, 77] as const
const AUDIENCE = [77, 109] as const

let poolCache: { at: number; pool: ReturnType<typeof decodePool> } | null = null
async function poolTerms(conn: Connection, pool: PublicKey) {
  if (poolCache && Date.now() - poolCache.at < 60_000) return poolCache.pool
  const acc = await conn.getAccountInfo(pool)
  if (!acc || !acc.owner.equals(CREDIT_ID)) throw new Error('the configured pool (POF_POOL) is not a pof-credit pool')
  poolCache = { at: Date.now(), pool: decodePool(acc.data) }
  return poolCache.pool
}

/** One unit of both budgets, or the 429 to send. */
async function takeBudget(client: string): Promise<{ release: () => Promise<void> } | Response> {
  const all = await reserve('relay:all', ALL_PER_HOUR, HOUR)
  if (!all) return Response.json({ error: 'the demo relayer has spent its hourly budget; try again later', failedAt: 'relayer' }, { status: 429 })
  const mine = await reserve(`relay:${client}`, PER_CLIENT_PER_HOUR, HOUR)
  if (!mine) {
    await all()
    return Response.json({ error: 'you have used this hour’s demo transactions; try again later', failedAt: 'relayer' }, { status: 429 })
  }
  return { release: async () => void (await Promise.all([all(), mine()])) }
}
const NONE = { release: async () => {} }

/** A send that the chain did not refuse: either it never got there, or it did and we stopped waiting. */
function sendFailure(err: unknown, why: string): Response {
  if (unconfirmed(err)) {
    return Response.json({ error: `Sent, but not confirmed in time, so it may still land. Check the explorer before trying again. (${why})`, failedAt: 'relayer' }, { status: 504 })
  }
  return Response.json({ error: `The transaction did not reach Solana: ${why}`, failedAt: 'relayer' }, { status: 502 })
}

function configured() {
  const { SOLANA_RPC_URL, POF_POOL, RELAYER_SECRET_KEY, BORROWER_SECRET_KEY } = process.env
  // On serverless, limits kept in memory are per instance and a burst gets many instances: the
  // spend budget above means nothing without the shared store, so the relayer stays off.
  return Boolean(SOLANA_RPC_URL && POF_POOL && RELAYER_SECRET_KEY && BORROWER_SECRET_KEY) && (durable || !process.env.VERCEL)
}

export async function POST(req: Request) {
  if (!configured()) return Response.json({ error: 'the Solana relayer is not configured on this deployment' }, { status: 503 })
  const client = clientKey(req)
  if (await rateLimit(`relay:${client}`, 20, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  const body = await readJson<Body>(req)
  if (body instanceof Response) return body
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad request' }, { status: 400 })

  let relayer: Keypair, borrower: Keypair
  try {
    relayer = keypairFrom(process.env.RELAYER_SECRET_KEY, 'RELAYER_SECRET_KEY')
    borrower = keypairFrom(process.env.BORROWER_SECRET_KEY, 'BORROWER_SECRET_KEY')
  } catch (err) {
    console.error((err as Error).message)
    return Response.json({ error: 'the Solana relayer is misconfigured on this deployment' }, { status: 503 })
  }
  if (body.action === 'borrower') return Response.json({ borrower: borrower.publicKey.toBase58() })

  const conn = connection()
  if (body.action === 'submit') {
    const a = body.attestation
    if (typeof a?.message !== 'string' || typeof a.signature !== 'string' || typeof a.attestor !== 'string') {
      return Response.json({ error: 'submit needs an attestation {message, signature, attestor}' }, { status: 400 })
    }
    const message = Buffer.from(a.message, 'hex')
    const signature = Buffer.from(a.signature, 'hex')
    let attestor: PublicKey
    try {
      attestor = new PublicKey(a.attestor)
    } catch {
      return Response.json({ error: 'malformed attestation: attestor is not a base58 public key' }, { status: 400 })
    }
    if (message.length !== 139 || signature.length !== 64 || a.message.length !== 278 || a.signature.length !== 128) {
      return Response.json({ error: 'malformed attestation' }, { status: 400 })
    }
    // This relayer pays only for the demo: a receipt the demo borrower can take to the demo pool.
    // Anything else would be rent spent on someone else's account.
    if (!borrower.publicKey.toBuffer().equals(message.subarray(...BENEFICIARY))) {
      return Response.json({ error: 'this relayer only submits attestations bound to the demo borrower', failedAt: 'relayer' }, { status: 422 })
    }
    // "Flip one byte of the attestation": the claim value, changed after the attestor signed.
    const sent = Buffer.from(message)
    if (body.tamper) sent[110] = sent[110]! ^ 0x01
    const subject = sent.subarray(...SUBJECT)
    let budget = NONE
    try {
      const terms = await poolTerms(conn, new PublicKey(process.env.POF_POOL!))
      if (!terms.audience.equals(message.subarray(...AUDIENCE))) {
        return Response.json({ error: 'this relayer only submits attestations made for the demo pool’s audience', failedAt: 'relayer' }, { status: 422 })
      }
      const took = await takeBudget(client)
      if (took instanceof Response) return took
      budget = took
      const sig = await send(conn, [ed25519Ix(attestor, sent, signature), submitIx(relayer.publicKey, sent)], [relayer])
      // it landed: a failed status read must not turn that into an error
      const status = await conn.getSignatureStatus(sig).catch(() => null)
      const receipt = receiptPda(subject).toBase58()
      const tx: GateTransaction = {
        signature: sig,
        slot: status?.value?.slot ?? 0,
        receipt,
        explorer: explorer('tx', sig),
        instructions: [
          { index: 0, program: 'Ed25519 native program', programId: 'Ed25519SigVerify111111111111111111111111111', summary: `verify sig by ${attestor.toBase58().slice(0, 6)}… over 139 bytes` },
          { index: 1, program: 'pof-gate', programId: GATE_ID.toBase58(), summary: 'submit_attestation → ClaimReceipt created' },
        ],
      }
      return Response.json({ tx })
    } catch (err) {
      const why = explain(err)
      if (!refusedByChain(err)) return sendFailure(err, why)
      await budget.release()
      const failedAt = /already in use/i.test(why) || /already in use/i.test(String((err as Error).message))
        ? 'Instruction 1 · pof-gate · the receipt for this proof already exists'
        : body.tamper || /signature|precompile|0x2/i.test(why)
          ? 'Instruction 0 · Ed25519SigVerify'
          : 'Instruction 1 · pof-gate'
      const message = failedAt.startsWith('Instruction 0')
        ? `The Ed25519 native program rejected the signature: one byte of the attestation was changed after the attestor signed it. The transaction failed before pof-gate ran; no receipt exists. (${why})`
        : failedAt.includes('already exists')
          ? `Replay refused: the ClaimReceipt account for this proof id already exists, so pof-gate cannot create it again. One proof, one receipt. (${why})`
          : why
      return Response.json({ error: message, failedAt }, { status: 422 })
    }
  }

  if (body.action === 'open-line') {
    if (typeof body.receipt !== 'string') return Response.json({ error: 'open-line needs a receipt address' }, { status: 400 })
    const pool = new PublicKey(process.env.POF_POOL!)
    // Without a configured stranger, a fresh key: it can never be a receipt's beneficiary. (Using
    // the relayer here would let a receipt bound to the relayer open lines on the relayer's dime.)
    // A stranger's attempt is refused in preflight and costs nothing; only the borrower's lands.
    let receipt: PublicKey
    try {
      receipt = new PublicKey(body.receipt)
    } catch {
      return Response.json({ error: 'open-line needs a receipt address (base58)' }, { status: 400 })
    }
    let budget = NONE
    try {
      const who = body.wallet === 'stranger' ? (process.env.STRANGER_SECRET_KEY ? keypairFrom(process.env.STRANGER_SECRET_KEY, 'STRANGER_SECRET_KEY') : Keypair.generate()) : borrower
      const receiptAcc = await conn.getAccountInfo(receipt)
      if (!receiptAcc || !receiptAcc.owner.equals(GATE_ID)) {
        return Response.json({ error: 'There is no pof-gate receipt at this address. Submit the attestation first.', failedAt: 'pof-credit · open_line' }, { status: 422 })
      }
      if (receiptAcc.data.length < 72) return Response.json({ error: 'That account is not a pof-gate receipt.', failedAt: 'pof-credit · open_line' }, { status: 422 })
      // Only the demo's own receipts: the relayer pays the line's rent, so a receipt bound to any
      // other account (the stranger's, say) must never open a line here.
      if (!receiptAcc.data.subarray(40, 72).equals(borrower.publicKey.toBuffer())) {
        return Response.json({ error: 'This relayer only opens lines against receipts bound to the demo borrower.', failedAt: 'relayer' }, { status: 422 })
      }
      const subject = receiptSubject(receiptAcc.data)
      // the relayer pays the fee and the CreditLine's rent; the borrower only signs
      const p = await poolTerms(conn, pool)
      // a stranger's attempt is refused in preflight and costs nothing: it takes no budget
      if (body.wallet !== 'stranger') {
        const took = await takeBudget(client)
        if (took instanceof Response) return took
        budget = took
      }
      const sig = await send(conn, [openLineIx(pool, who.publicKey, relayer.publicKey, receipt, subject)], [relayer, who])
      const line = linePda(subject, who.publicKey)
      const out: CreditLine = {
        account: line.toBase58(),
        pool: pool.toBase58(),
        limit: `${formatUnits(p.lineLimit, 6)} dUSDC`,
        drawn: '0.00 dUSDC',
        openedAgainst: body.receipt,
        requiredZatoshi: Number(p.requiredZatoshi),
        explorer: explorer('tx', sig),
      }
      return Response.json({ line: out })
    } catch (err) {
      const why = explain(err)
      if (!refusedByChain(err)) return sendFailure(err, why)
      await budget.release()
      return Response.json({ error: why, failedAt: `pof-credit · open_line${body.wallet === 'stranger' ? ' (another wallet)' : ''}` }, { status: 422 })
    }
  }
  if (body.action === 'draw') {
    if (typeof body.line !== 'string') return Response.json({ error: 'draw needs a credit line address' }, { status: 400 })
    let line: PublicKey
    try {
      line = new PublicKey(body.line)
    } catch {
      return Response.json({ error: 'draw needs a credit line address (base58)' }, { status: 400 })
    }
    const pool = new PublicKey(process.env.POF_POOL!)
    let budget = NONE
    try {
      // Only the demo's own lines: CreditLine is [disc 8 | pool 32 | borrower 32 | limit 8 | drawn 8 | …]
      const acc = await conn.getAccountInfo(line)
      if (!acc || !acc.owner.equals(CREDIT_ID) || acc.data.length < 88) {
        return Response.json({ error: 'There is no pof-credit line at this address. Open one first.', failedAt: 'pof-credit · draw' }, { status: 422 })
      }
      if (!acc.data.subarray(8, 40).equals(pool.toBuffer()) || !acc.data.subarray(40, 72).equals(borrower.publicKey.toBuffer())) {
        return Response.json({ error: 'This relayer only draws on the demo borrower’s lines in the demo pool.', failedAt: 'relayer' }, { status: 422 })
      }
      const p = await poolTerms(conn, pool)
      const took = await takeBudget(client)
      if (took instanceof Response) return took
      budget = took
      // the borrower's dUSDC account, created on the first draw at the relayer's cost; the borrower only signs
      const to = getAssociatedTokenAddressSync(p.mint, borrower.publicKey)
      const sig = await send(
        conn,
        [createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, to, borrower.publicKey, p.mint), drawIx(pool, p.vault, line, borrower.publicKey, to, DRAW)],
        [relayer, borrower],
      )
      const after = await conn.getAccountInfo(line).catch(() => null)
      const drawn = after && after.data.length >= 88 ? after.data.readBigUInt64LE(80) : acc.data.readBigUInt64LE(80) + DRAW
      return Response.json({ amount: `${formatUnits(DRAW, 6)} dUSDC`, drawn: `${formatUnits(drawn, 6)} dUSDC`, explorer: explorer('tx', sig) })
    } catch (err) {
      const why = explain(err)
      if (!refusedByChain(err)) return sendFailure(err, why)
      await budget.release()
      return Response.json({ error: /0x1776|OverLimit|exceeds/i.test(why) ? `pof-credit refused: the draw would exceed the line’s limit. (${why})` : why, failedAt: 'pof-credit · draw' }, { status: 422 })
    }
  }
  return Response.json({ error: 'unknown action' }, { status: 400 })
}

export function GET() {
  return Response.json({ gate: GATE_ID.toBase58(), credit: CREDIT_ID.toBase58(), configured: configured() })
}
