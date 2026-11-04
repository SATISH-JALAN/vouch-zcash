// Derive the testnet test vectors from one real Zcash testnet proof, the way `pof-prove demo
// fixtures` derives the demo ones: fixtures/proofs/testnet-valid.pof in, the edited copies and
// fixtures/expected.testnet.json out. Each edit is re-sealed like a forger would, so only the
// proof (not the checksum) can catch it.
//
//   node scripts/testnet-vectors.ts <audience>
import { readFileSync, writeFileSync } from 'node:fs'
import { decode, encode } from '../frontend/src/lib/pof/codec.ts'
import { audienceHash } from '../frontend/src/lib/pof/hash.ts'

const audience = process.argv[2]
if (!audience) throw new Error('usage: node scripts/testnet-vectors.ts <audience the proof was made for>')
const dir = new URL('../fixtures/', import.meta.url)
const proofs = new URL('proofs/', dir)

const d = decode(new Uint8Array(readFileSync(new URL('testnet-valid.pof', proofs))))
if (!d.ok) throw new Error(`testnet-valid.pof: ${d.reason}`)
const valid = d.envelope
if (valid.audience !== audienceHash(audience)) throw new Error(`testnet-valid.pof was not made for ${audience}`)
const other = 'otc-desk:someone-else'

const expected: Record<string, { verdict: string; audience: string; network?: string }> = {
  'testnet-valid': { verdict: 'Valid', audience, network: 'testnet' },
}
const write = (name: string, bytes: Uint8Array, verdict: string, as = audience) => {
  writeFileSync(new URL(`${name}.pof`, proofs), bytes)
  expected[name] = { verdict, audience: as }
}
const edit = (f: (e: typeof valid) => void) => {
  const e = structuredClone(valid)
  f(e)
  return encode(e)
}

// One byte of Halo2 evidence flipped.
write('testnet-tampered', edit((e) => { e.evidence.proof[777]! ^= 1 }), 'ProofInvalid')
// The claim raised a hundredfold after proving.
write('testnet-forged-claim', edit((e) => { if (e.claim.kind === 'HoldsAtLeast') e.claim.zatoshi *= 100 }), 'ProofInvalid')
// Someone handed the proof puts their own name in the audience field.
write('testnet-readdressed', edit((e) => { e.audience = audienceHash(other) }), 'ProofInvalid', other)
// The untouched proof, checked by a party it was not made for.
write('testnet-wrong-audience', encode(valid), 'WrongAudience', other)

const meta = { audience, evaluatedAt: valid.issuedAt + 86_400, expected }
writeFileSync(new URL('expected.testnet.json', dir), JSON.stringify(meta, null, 2) + '\n')
console.log(`wrote ${Object.keys(expected).length} testnet vectors (anchor ${valid.anchor.height}, expires ${new Date(valid.expiresAt * 1000).toISOString().slice(0, 10)})`)
