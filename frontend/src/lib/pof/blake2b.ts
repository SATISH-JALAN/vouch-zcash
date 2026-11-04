// BLAKE2b (RFC 7693), unkeyed, variable output length.
// Used for the .pof body checksum and for deterministic fixture material.
// BigInt lanes: slow in absolute terms, but proofs are a few KB and this runs in < 5ms.

const M64 = (1n << 64n) - 1n

const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
]

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]

const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & M64

function g(v: bigint[], a: number, b: number, c: number, d: number, x: bigint, y: bigint) {
  v[a] = (v[a]! + v[b]! + x) & M64
  v[d] = rotr(v[d]! ^ v[a]!, 32n)
  v[c] = (v[c]! + v[d]!) & M64
  v[b] = rotr(v[b]! ^ v[c]!, 24n)
  v[a] = (v[a]! + v[b]! + y) & M64
  v[d] = rotr(v[d]! ^ v[a]!, 16n)
  v[c] = (v[c]! + v[d]!) & M64
  v[b] = rotr(v[b]! ^ v[c]!, 63n)
}

function compress(h: bigint[], block: Uint8Array, t: bigint, last: boolean) {
  const m: bigint[] = new Array(16)
  const dv = new DataView(block.buffer, block.byteOffset, 128)
  for (let i = 0; i < 16; i++) {
    const lo = BigInt(dv.getUint32(i * 8, true))
    const hi = BigInt(dv.getUint32(i * 8 + 4, true))
    m[i] = (hi << 32n) | lo
  }
  const v = [...h, ...IV]
  v[12] = v[12]! ^ (t & M64)
  v[13] = v[13]! ^ (t >> 64n)
  if (last) v[14] = v[14]! ^ M64
  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r % 10]!
    const w = (i: number) => m[s[i]!]!
    g(v, 0, 4, 8, 12, w(0), w(1))
    g(v, 1, 5, 9, 13, w(2), w(3))
    g(v, 2, 6, 10, 14, w(4), w(5))
    g(v, 3, 7, 11, 15, w(6), w(7))
    g(v, 0, 5, 10, 15, w(8), w(9))
    g(v, 1, 6, 11, 12, w(10), w(11))
    g(v, 2, 7, 8, 13, w(12), w(13))
    g(v, 3, 4, 9, 14, w(14), w(15))
  }
  for (let i = 0; i < 8; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!
}

export function blake2b(input: Uint8Array, outlen = 32): Uint8Array {
  if (outlen < 1 || outlen > 64) throw new RangeError('blake2b: outlen must be 1..64')
  const h = [...IV]
  h[0] = h[0]! ^ (0x01010000n ^ BigInt(outlen))

  let t = 0n
  let offset = 0
  const block = new Uint8Array(128)
  // every full block except the final one
  while (input.length - offset > 128) {
    block.set(input.subarray(offset, offset + 128))
    t += 128n
    compress(h, block, t, false)
    offset += 128
  }
  block.fill(0)
  block.set(input.subarray(offset))
  t += BigInt(input.length - offset)
  compress(h, block, t, true)

  const out = new Uint8Array(64)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) {
    dv.setUint32(i * 8, Number(h[i]! & 0xffffffffn), true)
    dv.setUint32(i * 8 + 4, Number(h[i]! >> 32n), true)
  }
  return out.slice(0, outlen)
}
