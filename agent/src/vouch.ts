// The agent's Vouch side: certify the notes it is about to spend for one order, pay, and write the
// receipt. Everything here shells out to the same CLIs a person would use (pof-prove, pof-verify);
// the agent never sees a seed or a viewing key, and nothing here broadcasts a transaction.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EXE = process.platform === 'win32' ? '.exe' : ''
const bin = (name: string) => process.env[`VOUCH_${name.toUpperCase().replace('-', '_')}`] ?? join(ROOT, 'backend/target/release', name + EXE)

export type Network = 'demo' | 'testnet' | 'mainnet'

export interface Config {
  network: Network
  /** The rail that turns shielded ZEC into the merchant's payment (its Vouch identifier). */
  rail: string
  /** The rail's period: reuse is visible to it within one. */
  epoch: number
  outDir: string
  /** pof-attest, for reading payments from lightwalletd (testnet and mainnet). */
  attestUrl: string
  /** testnet / mainnet: the public chain snapshot and the holder's seed, both local files. */
  snapshot?: string
  seedFile?: string
}

export function configFromEnv(): Config {
  const network = (process.env.VOUCH_NETWORK ?? 'demo') as Network
  if (!['demo', 'testnet', 'mainnet'].includes(network)) throw new Error(`VOUCH_NETWORK must be demo, testnet or mainnet, not ${network}`)
  const d = new Date()
  return {
    network,
    rail: process.env.VOUCH_RAIL ?? (network === 'demo' ? 'rail:demo' : 'rail:testnet-demo'),
    epoch: Number(process.env.VOUCH_EPOCH ?? d.getUTCFullYear() * 100 + d.getUTCMonth() + 1),
    outDir: resolve(process.env.VOUCH_OUT ?? join(ROOT, 'agent/out')),
    attestUrl: (process.env.VOUCH_ATTEST_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
    snapshot: process.env.VOUCH_SNAPSHOT,
    seedFile: process.env.VOUCH_SEED_FILE,
  }
}

/** The intent an order's certificate is bound to. The receipt checker requires the order id in it. */
export const orderIntent = (merchant: string, orderId: string) => `${merchant}:invoice:${orderId}`

const ZAT = 100_000_000
/** Thresholds are multiples of 0.125 ZEC: round the amount up to the next one. */
export function thresholdZatoshi(zec: number): number {
  const step = ZAT / 8
  return Math.max(step, Math.ceil((zec * ZAT) / step) * step)
}

function requestLink(c: Config, zatoshi: number): string {
  const req = { v: 1, claim: 'HoldsAtLeast', zatoshi: String(zatoshi), audience: c.rail, expiryDays: 7, kind: 'exit', epoch: c.epoch }
  return Buffer.from(JSON.stringify(req)).toString('base64url')
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

export interface Certified {
  file: string
  intent: string
  zatoshi: number
  /** Every nullifier the certificate names: the notes it certifies, then padding. */
  revealed: string[]
  verifyMs: number
}

/**
 * An exit certificate for the rail, bound to this order, proven offline from the holder's notes,
 * then checked with the verifier before anything is paid. Throws if it does not verify.
 */
export async function certify(c: Config, merchant: string, orderId: string, amountZec: number): Promise<Certified> {
  mkdirSync(c.outDir, { recursive: true })
  const intent = orderIntent(merchant, orderId)
  const zatoshi = thresholdZatoshi(amountZec)
  const file = join(c.outDir, `${safe(orderId)}.pof`)
  const common = ['--request', requestLink(c, zatoshi), '--exit', '--intent', intent, '--out', file, '--yes']
  const args =
    c.network === 'demo'
      ? ['demo', 'prove', '--world', join(ROOT, 'fixtures/demo-world.json'), ...common]
      : (() => {
          if (!c.snapshot || !c.seedFile) throw new Error('testnet and mainnet need VOUCH_SNAPSHOT (from pof-anchor scan) and VOUCH_SEED_FILE')
          return ['prove', '--snapshot', c.snapshot, '--seed-file', c.seedFile, '--network', c.network, ...common]
        })()
  await run(bin('pof-prove'), args, { maxBuffer: 16 << 20, timeout: 300_000 })
  const checked = await verifyCertificate(c, file)
  if (checked.verdict.kind !== 'Valid') throw new Error(`the certificate did not verify: ${checked.verdict.kind}`)
  return { file, intent, zatoshi, revealed: checked.revealed ?? [], verifyMs: checked.ms }
}

interface CliResult {
  verdict: { kind: string }
  revealed?: string[]
  ms: number
}

async function verifyCertificate(c: Config, file: string): Promise<CliResult> {
  const anchors = join(c.outDir, 'anchors.json')
  if (!existsSync(anchors)) {
    const table = ['mainnet', 'testnet', 'demo'].flatMap((n) => {
      const f = join(ROOT, `fixtures/anchors.${n}.json`)
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as unknown[]) : []
    })
    writeFileSync(anchors, JSON.stringify(table))
  }
  const started = performance.now()
  let out: string
  try {
    out = (await run(bin('pof-verify'), ['check', file, '--audience', c.rail, '--anchors', anchors, '--json'], { maxBuffer: 16 << 20 })).stdout
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  return { ...(JSON.parse(out) as Omit<CliResult, 'ms'>), ms: Math.round(performance.now() - started) }
}

export interface Payment {
  network: Network
  txid?: string
  height?: number
  paidAt: number
  nullifiers: string[]
}

/**
 * The payment's shielded spends. Demo ledger: there are no transactions, so the payment spends the
 * certificate's first (largest) note, as the demo vectors do, and says so. Testnet / mainnet: the
 * holder's wallet sends to the rail and gives the txid; pof-attest reads the spent nullifiers from
 * lightwalletd, so they come from the chain, not from the agent.
 */
export async function payment(c: Config, cert: Certified, txid?: string): Promise<Payment> {
  const paidAt = Math.floor(Date.now() / 1000)
  if (c.network === 'demo') {
    const first = cert.revealed[0]
    if (!first) throw new Error('the certificate names no notes')
    return { network: 'demo', paidAt, nullifiers: [first] }
  }
  if (!txid) throw new Error('send from the certified notes to the rail, then give the txid')
  const nfs = await chainNullifiers(c, cert, txid)
  return { network: c.network, txid, height: nfs.height, paidAt, nullifiers: nfs.nullifiers }
}

/** pof-attest reads the transaction from lightwalletd: its answer carries the spent nullifiers. */
async function chainNullifiers(c: Config, cert: Certified, txid: string): Promise<{ height?: number; nullifiers: string[] }> {
  const probe = receiptJson(c, { merchant: 'probe', id: 'probe', intent: 'probe' }, cert, { network: c.network, txid, paidAt: 0, nullifiers: [] })
  const res = await fetch(`${c.attestUrl}/v1/receipts/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt: probe }), signal: AbortSignal.timeout(60_000) })
  type Chain = { height?: number; nullifiers?: string[] }
  const body = (await res.json().catch(() => null)) as { chain?: Chain; detail?: { chain?: Chain }; error?: string } | null
  // a refused probe (it names no real order) still carries what the chain said
  const chain = body?.chain ?? body?.detail?.chain
  if (!chain?.nullifiers) throw new Error(`could not read ${txid}: ${body?.error ?? `HTTP ${res.status}`}`)
  return { height: chain.height, nullifiers: chain.nullifiers }
}

interface Order {
  merchant: string
  id: string
  intent: string
  description?: string
  price?: string
}

function receiptJson(c: Config, order: Order, cert: Certified, pay: Payment) {
  return {
    type: 'vouch.receipt',
    version: 1,
    order,
    rail: { audience: c.rail, epoch: c.epoch },
    certificate: readFileSync(cert.file).toString('base64url'),
    payment: { network: pay.network, ...(pay.txid ? { txid: pay.txid } : {}), ...(pay.height ? { height: pay.height } : {}), paidAt: pay.paidAt, nullifiers: pay.nullifiers },
    issuedAt: Math.floor(Date.now() / 1000),
    note:
      pay.network === 'demo'
        ? 'Demo ledger: the certificate is a real proof over the demo chain; the ZEC payment is simulated (it spends the first certified note).'
        : `Payment read from ${pay.network} lightwalletd by pof-attest.`,
  }
}

/** Write the receipt the user hands to their accountant: one order, not the wallet. */
export function writeReceipt(c: Config, order: Omit<Order, 'intent'>, cert: Certified, pay: Payment): string {
  const file = join(c.outDir, `receipt-${safe(order.id)}.json`)
  writeFileSync(file, `${JSON.stringify(receiptJson(c, { ...order, intent: cert.intent }, cert, pay), null, 2)}\n`)
  return file
}

/** Ask pof-attest for the verdict, as the accountant's tools would. Optional: the browser checks it too. */
export async function checkWithAttestor(c: Config, receiptFile: string): Promise<string> {
  try {
    const res = await fetch(`${c.attestUrl}/v1/receipts/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receipt: JSON.parse(readFileSync(receiptFile, 'utf8')) }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = (await res.json().catch(() => null)) as { verdict?: { kind: string }; error?: string } | null
    return body?.verdict?.kind ?? `no verdict (${body?.error ?? `HTTP ${res.status}`})`
  } catch (e) {
    return `attestor unreachable at ${c.attestUrl} (${(e as Error).message}); open the receipt at /receipt instead`
  }
}
