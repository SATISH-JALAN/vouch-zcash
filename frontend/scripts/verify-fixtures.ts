// The TypeScript mirror of the .pof format against the proofs the Rust prover wrote:
// every committed vector must decode, and re-encode to the identical bytes.
// Verdicts themselves are checked by the WASM verifier (scripts/verify-fixtures-wasm.mjs at
// the repo root) and the native one (cargo test -p pof-verify) against fixtures/expected.json.
import { readdirSync, readFileSync } from 'node:fs'
import { decode, encode, MAX_ZATOSHI, reseal } from '../src/lib/pof/codec.ts'
import { audienceHash } from '../src/lib/pof/hash.ts'
import { concat, fromBase64Url, toBase64Url } from '../src/lib/pof/bytes.ts'
import { decodeRequestDetailed, encodeRequest } from '../src/lib/request.ts'

const dir = new URL('../public/proofs/', import.meta.url)
let fail = 0
const expect = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

for (const f of readdirSync(dir).filter((f) => f.endsWith('.pof')).sort()) {
  const bytes = new Uint8Array(readFileSync(new URL(f, dir)))
  const d = decode(bytes)
  if (!d.ok) {
    expect(f, false, d.reason)
    continue
  }
  const again = encode(d.envelope)
  expect(`${f} round-trips byte-for-byte`, again.length === bytes.length && again.every((b, i) => b === bytes[i]), `${bytes.length} bytes, proof ${d.envelope.evidence.proof.length}`)
  const b64 = toBase64Url(bytes)
  const back = fromBase64Url(b64)!
  expect(`${f} base64url`, back.length === bytes.length && back.every((b, i) => b === bytes[i]))
}

// the audience hash the builder shows is the one the verifier compares
const valid = decode(new Uint8Array(readFileSync(new URL('valid.pof', dir))))
expect('audience hash matches pof_core', valid.ok && valid.envelope.audience === audienceHash('pof-credit:usdc-pool-1'))
expect('truncated file is refused', !decode(new Uint8Array(readFileSync(new URL('valid.pof', dir))).slice(0, 900)).ok)

// crafted files the decoder must refuse (null: must accept), each re-sealed like a forger would
if (valid.ok) {
  const file = new Uint8Array(readFileSync(new URL('valid.pof', dir)))
  const base = valid.envelope
  const seal = (body: Uint8Array) => reseal(concat(file.subarray(0, 6), body, new Uint8Array(32)))
  const bodyOf = (f: Uint8Array) => f.subarray(6, f.length - 32)
  // the first body offset where two encodings differ: where the field under test starts
  const at = (a: Uint8Array, b: Uint8Array) => a.findIndex((x, i) => x !== b[i])
  const refuses = (name: string, f: Uint8Array, want: string | null) => {
    const d = decode(f)
    expect(`codec: ${name}`, want === null ? d.ok : !d.ok && d.reason === `Envelope does not parse: ${want}.`, d.ok ? 'accepted' : d.reason)
  }
  const body = bodyOf(file)
  let end = 1 // zatoshi is the varint right after the claim tag
  while (body[end]! & 0x80) end++
  refuses('claim tag padded 0x80 0x00', seal(concat(new Uint8Array([0x80, 0x00]), body.subarray(1))), 'non-canonical varint')
  refuses('zatoshi with a trailing zero group', seal(concat(body.subarray(0, end), new Uint8Array([body[end]! | 0x80, 0x00]), body.subarray(end + 1))), 'non-canonical varint')
  refuses('zatoshi above supply', encode({ ...base, claim: { kind: 'HoldsAtLeast', zatoshi: MAX_ZATOSHI + 12_500_000 } }), 'amount exceeds the 21M ZEC supply')
  refuses('zatoshi at supply', encode({ ...base, claim: { kind: 'HoldsAtLeast', zatoshi: MAX_ZATOSHI } }), null)
  refuses('height 2^32', encode({ ...base, anchor: { ...base.anchor, height: 2 ** 32 } }), 'value overflows u32')
  refuses('fromHeight 2^32', encode({ ...base, claim: { kind: 'ReceivedAtLeastSince', zatoshi: 5, fromHeight: 2 ** 32 } }), 'value overflows u32')
  refuses('issued after expiry', encode({ ...base, issuedAt: base.expiresAt + 1 }), 'issued after it expires')
  refuses('issued at expiry', encode({ ...base, issuedAt: base.expiresAt }), null)
  refuses('expiry 2^53 - 1', encode({ ...base, expiresAt: Number.MAX_SAFE_INTEGER }), null)
  {
    // the writer refuses unsafe numbers, so splice the 8-byte varint for 2^53 in by hand
    const b = bodyOf(encode({ ...base, expiresAt: 1 }))
    const i = at(b, bodyOf(encode({ ...base, expiresAt: 0 })))
    refuses('expiry 2^53', seal(concat(b.subarray(0, i), new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10]), b.subarray(i + 1))), 'value exceeds 2^53')
  }
  {
    // 2^32 + 5 public inputs: a 32-bit `as usize` would read 5
    const input = (n: number) => bodyOf(encode({ ...base, evidence: { ...base.evidence, publicInputs: Array<string>(n).fill('00'.repeat(32)) } }))
    const i = at(input(0), input(1))
    const b5 = input(5)
    refuses('2^32 + 5 public inputs', seal(concat(b5.subarray(0, i), new Uint8Array([0x85, 0x80, 0x80, 0x80, 0x10]), b5.subarray(i + 1))), 'too many public inputs')
  }
}

// requests
const req = { v: 1 as const, claim: 'HoldsAtLeast' as const, zatoshi: '50000000000', audience: 'pof-credit:usdc-pool-1', expiryDays: 7 }
expect('request round-trips', decodeRequestDetailed(encodeRequest(req)).ok)
expect('0.125 ZEC granularity enforced', !decodeRequestDetailed(encodeRequest({ ...req, zatoshi: '50000000001' })).ok)
expect('roadmap claims refused', !decodeRequestDetailed(encodeRequest({ ...req, claim: 'ReceivedPayment' as never })).ok)
expect('garbage refused', !decodeRequestDetailed('!!!').ok)

// the links the Rust prover must judge the same way (crates/pof-prove/src/request.rs tests)
const shared = JSON.parse(readFileSync(new URL('../../fixtures/requests.json', import.meta.url), 'utf8')) as { cases: { name: string; r: string; ok: boolean; json?: string }[] }
for (const c of shared.cases) {
  const d = decodeRequestDetailed(c.r)
  const text = c.json === undefined || new TextDecoder().decode(fromBase64Url(c.r) ?? new Uint8Array()) === c.json
  expect(`request vector "${c.name}"`, d.ok === c.ok && text, d.ok ? 'accepted' : d.reason)
}

console.log(fail ? `${fail} FAILED` : 'all passed')
process.exit(fail ? 1 : 0)
