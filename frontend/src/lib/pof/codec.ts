// The .pof wire format, as specified in /docs/format:
//
//   magic     "POF1"                 4 bytes
//   version   u16 little-endian      2 bytes
//   body      postcard(Body)         variable
//   checksum  blake2b-256(body)      32 bytes
//
// Version 2 adds the circuit, the verifier's epoch and a second anchor height (the tree at
// ncHeight, the spent set at height). Version 1 files still decode and re-encode byte for byte.
//
// Travels as base64url wherever it is text. This is a TypeScript mirror used for display and
// parsing; pof-verify (Rust, compiled to WASM) is the reference and the only thing that
// decides a verdict. `scripts/verify-fixtures.ts` checks this mirror byte-for-byte against the
// proofs the Rust prover wrote to fixtures/.

import type { Claim, Envelope } from '../data/types.ts'
import { blake2b } from './blake2b.ts'
import { concat, equal, fromHex, hex } from './bytes.ts'

export const MAGIC = new Uint8Array([0x50, 0x4f, 0x46, 0x31]) // "POF1"
/** Latest wire version. Version 1 files still decode. */
export const FORMAT_VERSION = 2
export const FORMAT_V1 = 1
export const CIRCUIT_THRESHOLD = 1
export const CIRCUIT_REVEAL = 2
/** Hard cap on public inputs (pof_core::MAX_PUBLIC_INPUTS). */
export const MAX_PUBLIC_INPUTS = 24
/** 1 unit = 0.125 ZEC. Threshold claims are proven in whole units. */
export const ZAT_PER_UNIT = 12_500_000n
/** Total supply bound, in zatoshi (pof_core::MAX_ZATOSHI). */
export const MAX_ZATOSHI = 2_100_000_000_000_000
const MAX_U32 = 0xffffffff

const CLAIM_TAG: Record<Claim['kind'], number> = {
  HoldsAtLeast: 0,
  HoldsExactly: 1,
  ReceivedPayment: 2,
  ReceivedAtLeastSince: 3,
}

// ── writer ────────────────────────────────────────────────────────────────

class Writer {
  parts: number[] = []
  varint(n: number) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`varint out of range: ${n}`)
    do {
      let byte = n % 128
      n = Math.floor(n / 128)
      if (n > 0) byte |= 0x80
      this.parts.push(byte)
    } while (n > 0)
  }
  fixed(b: Uint8Array) {
    for (const x of b) this.parts.push(x)
  }
  bytes(b: Uint8Array) {
    this.varint(b.length)
    this.fixed(b)
  }
  done() {
    return new Uint8Array(this.parts)
  }
}

/** Whether the envelope says nothing version 1 cannot: circuit 1, no epoch, one height. */
export const fitsV1 = (e: Envelope) => e.circuit === CIRCUIT_THRESHOLD && e.epoch === 0 && e.anchor.ncHeight === e.anchor.height

/** The version actually written: 1 only for a version 1 envelope that still fits it. */
export const wireVersion = (e: Envelope) => (e.version === FORMAT_V1 && fitsV1(e) ? FORMAT_V1 : FORMAT_VERSION)

function writeClaim(w: Writer, e: Envelope) {
  const c = e.claim
  w.varint(CLAIM_TAG[c.kind])
  switch (c.kind) {
    case 'HoldsAtLeast':
    case 'HoldsExactly':
      w.varint(c.zatoshi)
      break
    case 'ReceivedPayment':
      w.fixed(fromHex(c.txid))
      w.varint(c.zatoshi)
      break
    case 'ReceivedAtLeastSince':
      w.varint(c.zatoshi)
      w.varint(c.fromHeight)
      break
  }
}

function writeHead(w: Writer, e: Envelope) {
  if (wireVersion(e) === FORMAT_V1) {
    writeClaim(w, e)
    w.fixed(fromHex(e.audience))
    w.fixed(fromHex(e.binding))
    w.varint(e.anchor.height)
    w.fixed(fromHex(e.anchor.ncRoot))
    w.fixed(fromHex(e.anchor.nfRoot))
  } else {
    w.varint(e.circuit)
    writeClaim(w, e)
    w.fixed(fromHex(e.audience))
    w.varint(e.epoch)
    w.fixed(fromHex(e.binding))
    w.varint(e.anchor.ncHeight)
    w.fixed(fromHex(e.anchor.ncRoot))
    w.varint(e.anchor.height)
    w.fixed(fromHex(e.anchor.nfRoot))
  }
  w.varint(e.issuedAt)
  w.varint(e.expiresAt)
  w.fixed(fromHex(e.revocation))
}

export function encodeBody(e: Envelope): Uint8Array {
  const w = new Writer()
  writeHead(w, e)
  w.varint(e.evidence.publicInputs.length)
  for (const pi of e.evidence.publicInputs) w.fixed(fromHex(pi))
  w.bytes(e.evidence.proof)
  w.fixed(fromHex(e.evidence.signature))
  return w.done()
}

export function encode(e: Envelope): Uint8Array {
  const body = encodeBody(e)
  const v = wireVersion(e)
  const version = new Uint8Array([v & 0xff, v >> 8])
  return concat(MAGIC, version, body, blake2b(body))
}

/** Re-seal a body with a fresh checksum — what a forger would do after editing it. */
export function reseal(file: Uint8Array): Uint8Array {
  const body = file.subarray(6, file.length - 32)
  return concat(file.subarray(0, 6), body, blake2b(body))
}

// ── reader ────────────────────────────────────────────────────────────────

class Reader {
  o = 0
  private b: Uint8Array
  constructor(b: Uint8Array) {
    this.b = b
  }
  /** Also the timestamp bound: pof_core refuses issue and expiry times above 2^53 − 1. */
  varint(): number {
    let n = 0
    let mul = 1
    for (let i = 0; i < 8; i++) {
      const byte = this.u8()
      n += (byte & 0x7f) * mul
      if (!(byte & 0x80)) {
        // A zero last group pads a shorter encoding of the same value; decoding stays injective.
        if (byte === 0 && i > 0) throw new Error('non-canonical varint')
        if (!Number.isSafeInteger(n)) throw new Error('value exceeds 2^53')
        return n
      }
      mul *= 128
    }
    throw new Error('varint too long')
  }
  u32(): number {
    const n = this.varint()
    if (n > MAX_U32) throw new Error('value overflows u32')
    return n
  }
  amount(): number {
    const n = this.varint()
    if (n > MAX_ZATOSHI) throw new Error('amount exceeds the 21M ZEC supply')
    return n
  }
  u8(): number {
    if (this.o >= this.b.length) throw new Error('unexpected end of body')
    return this.b[this.o++]!
  }
  fixed(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error('unexpected end of body')
    const out = this.b.slice(this.o, this.o + n)
    this.o += n
    return out
  }
  bytes(max: number): Uint8Array {
    const n = this.varint()
    if (n > max) throw new Error(`field of ${n} bytes exceeds the ${max}-byte limit`)
    return this.fixed(n)
  }
  get rest() {
    return this.b.length - this.o
  }
}

export type DecodeResult =
  | { ok: true; envelope: Envelope; checksum: string }
  | { ok: false; reason: string }

export function decode(file: Uint8Array): DecodeResult {
  if (file.length < 4 + 2 + 32 + 1) return { ok: false, reason: 'Too short to be a proof. The paste may be truncated.' }
  if (!equal(file.subarray(0, 4), MAGIC)) return { ok: false, reason: 'Not a proof file: the POF1 magic bytes are missing.' }
  const version = file[4]! | (file[5]! << 8)
  if (version !== FORMAT_V1 && version !== FORMAT_VERSION) {
    return { ok: false, reason: `Unknown format version ${version}. This verifier reads versions 1 and 2.` }
  }

  const body = file.subarray(6, file.length - 32)
  const checksum = file.subarray(file.length - 32)
  if (!equal(blake2b(body), checksum)) {
    return { ok: false, reason: 'Checksum mismatch. The file was truncated or damaged in transit — this is not the same as a forgery.' }
  }

  try {
    const r = new Reader(body)
    const readClaim = (): Claim => {
      const tag = r.varint()
      switch (tag) {
        case 0: return { kind: 'HoldsAtLeast', zatoshi: r.amount() }
        case 1: return { kind: 'HoldsExactly', zatoshi: r.amount() }
        case 2: { const txid = hex(r.fixed(32)); return { kind: 'ReceivedPayment', txid, zatoshi: r.amount() } }
        case 3: { const zatoshi = r.amount(); return { kind: 'ReceivedAtLeastSince', zatoshi, fromHeight: r.u32() } }
        default: throw new Error(`unknown claim tag ${tag}`)
      }
    }
    let circuit = CIRCUIT_THRESHOLD
    let epoch = 0
    let claim: Claim, audience: string, binding: string, height: number, ncHeight: number, ncRoot: string, nfRoot: string
    if (version === FORMAT_V1) {
      claim = readClaim()
      audience = hex(r.fixed(32))
      binding = hex(r.fixed(32))
      height = ncHeight = r.u32()
      ncRoot = hex(r.fixed(32))
      nfRoot = hex(r.fixed(32))
    } else {
      circuit = r.varint()
      if (circuit !== CIRCUIT_THRESHOLD && circuit !== CIRCUIT_REVEAL) throw new Error(`unknown circuit ${circuit}`)
      claim = readClaim()
      audience = hex(r.fixed(32))
      epoch = r.varint() // the varint reader already refuses anything above 2^53 − 1
      binding = hex(r.fixed(32))
      ncHeight = r.u32()
      ncRoot = hex(r.fixed(32))
      height = r.u32()
      nfRoot = hex(r.fixed(32))
      if (ncHeight > height) throw new Error('the note-commitment block is after the spent-set block')
    }
    const issuedAt = r.varint()
    const expiresAt = r.varint()
    if (issuedAt > expiresAt) throw new Error('issued after it expires')
    const revocation = hex(r.fixed(16))
    const n = r.varint()
    if (n > MAX_PUBLIC_INPUTS) throw new Error('too many public inputs')
    const publicInputs: string[] = []
    for (let i = 0; i < n; i++) publicInputs.push(hex(r.fixed(32)))
    const proof = r.bytes(16 * 1024)
    const signature = hex(r.fixed(64))
    if (r.rest !== 0) throw new Error('trailing bytes after the envelope')
    return {
      ok: true,
      envelope: {
        version,
        circuit,
        claim,
        audience,
        epoch,
        binding,
        anchor: { height, ncRoot, nfRoot, ncHeight },
        issuedAt,
        expiresAt,
        revocation,
        evidence: { publicInputs, proof, signature },
      },
      checksum: hex(checksum),
    }
  } catch (err) {
    return { ok: false, reason: `Envelope does not parse: ${(err as Error).message}.` }
  }
}

/** The block since which the notes have not moved, when the proof says more than "as of". */
export const dormantSince = (e: Envelope) => (e.anchor.ncHeight < e.anchor.height ? e.anchor.ncHeight : undefined)

/** True when `binding` is the all-zero "unbound" value. */
export const isUnbound = (binding: string) => /^0{64}$/.test(binding)
