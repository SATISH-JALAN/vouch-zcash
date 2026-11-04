// Byte helpers shared by the codec and the fixtures. No dependencies.

import { blake2b } from './blake2b.ts'

export const utf8 = (s: string) => new TextEncoder().encode(s)

export function hex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/^0x/, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Deterministic byte stream: blake2b(seed ‖ counter) blocks. Fixture material only. */
export function stream(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let o = 0
  for (let ctr = 0; o < length; ctr++) {
    const block = blake2b(utf8(`${seed}#${ctr}`), 64)
    out.set(block.subarray(0, Math.min(64, length - o)), o)
    o += 64
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function toBase64Url(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    if (i + 1 < b.length) s += B64[(n >> 6) & 63]!
    if (i + 2 < b.length) s += B64[n & 63]!
  }
  return s
}

/** Returns null on any character outside the base64url alphabet (standard base64 is accepted too). */
export function fromBase64Url(s: string): Uint8Array | null {
  // Same rule as pof_core::from_base64url: trim, drop trailing '=', skip ASCII whitespace inside.
  const clean = s.trim().replace(/=+$/, '').replace(/[ \t\n\f\r]+/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) return null
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function toBase58(b: Uint8Array): string {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  let s = ''
  while (n > 0n) {
    s = B58[Number(n % 58n)]! + s
    n /= 58n
  }
  for (const x of b) {
    if (x !== 0) break
    s = '1' + s
  }
  return s
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/** A unified-address-shaped string for fixture display. Not a valid address; never presented as one. */
export function fixtureUnifiedAddress(seed: string): string {
  const b = stream(`ua:${seed}`, 106)
  let s = 'u1'
  for (let i = 0; i < 140; i++) s += BECH32[b[i % b.length]! % 32]
  return s
}
