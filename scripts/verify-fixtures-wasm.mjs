// WASM ≡ native: run every committed vector through the WebAssembly verifier the site serves
// (frontend/public/wasm) and compare with fixtures/expected.json — the same list the native
// test (pof-verify/tests) checks. Every result is also checked against /schema/pof-v1.json.
import { existsSync, readFileSync } from 'node:fs'
import * as wasm from '../frontend/public/wasm/pof_wasm.js'
wasm.initSync({ module: readFileSync(new URL('../frontend/public/wasm/pof_wasm_bg.wasm', import.meta.url)) })
const dir = new URL('../fixtures/', import.meta.url)
// the table the site and the attestor ship: every network's records, merged as sync-fixtures.sh does
const table = (net) => (existsSync(new URL(`anchors.${net}.json`, dir)) ? JSON.parse(readFileSync(new URL(`anchors.${net}.json`, dir), 'utf8')) : [])
const anchors = JSON.stringify(['mainnet', 'testnet', 'demo'].flatMap(table))
const revoked = JSON.stringify(JSON.parse(readFileSync(new URL('revocations.demo.json', dir), 'utf8')).secrets)
// expected.json: the demo vectors; expected.testnet.json: real Zcash testnet proofs (kept by hand)
const sets = ['expected.json', 'expected.testnet.json'].filter((f) => existsSync(new URL(f, dir))).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
// Every result must also match the published schema (frontend/public/schema/pof-v1.json). A small
// checker for the keywords that schema uses, so the test needs no dependency.
const schema = JSON.parse(readFileSync(new URL('../frontend/public/schema/pof-v1.json', import.meta.url), 'utf8'))
const TYPES = { null: (v) => v === null, object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: (v) => typeof v === 'string', integer: Number.isSafeInteger }
function conforms(v, s, at = '$') {
  if (s.$ref) return conforms(v, schema.$defs[s.$ref.replace('#/$defs/', '')], at)
  if (s.oneOf) {
    const n = s.oneOf.filter((o) => conforms(v, o, at) === null).length
    return n === 1 ? null : `${at}: matches ${n} of oneOf`
  }
  if (s.type && !TYPES[s.type](v)) return `${at}: not ${s.type}`
  if ('const' in s && v !== s.const) return `${at}: not ${JSON.stringify(s.const)}`
  if (s.enum && !s.enum.includes(v)) return `${at}: not one of ${s.enum.join(', ')}`
  if (s.pattern && !new RegExp(s.pattern).test(v)) return `${at}: does not match ${s.pattern}`
  if (s.minimum !== undefined && v < s.minimum) return `${at}: below ${s.minimum}`
  if (s.maximum !== undefined && v > s.maximum) return `${at}: above ${s.maximum}`
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return `${at}: fewer than ${s.minItems} items`
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${at}: more than ${s.maxItems} items`
    for (const [i, x] of v.entries()) { const e = s.items && conforms(x, s.items, `${at}[${i}]`); if (e) return e }
  } else if (TYPES.object(v)) {
    for (const k of s.required ?? []) if (!(k in v)) return `${at}: missing ${k}`
    for (const [k, x] of Object.entries(v)) {
      if (!s.properties?.[k]) { if (s.additionalProperties === false) return `${at}: unexpected ${k}`; continue }
      const e = conforms(x, s.properties[k], `${at}.${k}`)
      if (e) return e
    }
  }
  return null
}

let t = performance.now()
wasm.warm()
console.log(`warm (params + verifying key): ${(performance.now() - t).toFixed(0)} ms`)
let fail = 0
for (const meta of sets) {
  for (const [name, want] of Object.entries(meta.expected)) {
    const bytes = readFileSync(new URL(`proofs/${name}.pof`, dir))
    t = performance.now()
    // a vector may name what its verifier requires (freshness, dormancy), as the native test reads it
    const r = JSON.parse(
      wasm.verify(bytes, want.audience, BigInt(meta.evaluatedAt), anchors, revoked, want.policy ? JSON.stringify(want.policy) : undefined, want.seen ? JSON.stringify(want.seen) : undefined),
    )
    const ms = (performance.now() - t).toFixed(0)
    const bad = conforms(r, schema)
    const ok = r.verdict.kind === want.verdict && (!want.network || r.anchor?.network === want.network) && !bad
    if (!ok) fail++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${r.verdict.kind.padEnd(20)} ${want.network ? `${r.anchor?.network ?? '-'} ` : ''}${ms} ms${bad ? ` · schema: ${bad}` : ''}`)
  }
}
// reserves batches: the summed verdict and the member at fault, as the native test checks them;
// every member's result must match the schema too
for (const meta of sets) {
  for (const [name, want] of Object.entries(meta.batches ?? {})) {
    const bytes = readFileSync(new URL(`proofs/${name}.pofb`, dir))
    t = performance.now()
    const r = JSON.parse(wasm.verifyBatch(bytes, want.audience, BigInt(meta.evaluatedAt), anchors, revoked))
    const ms = (performance.now() - t).toFixed(0)
    const bad = r.members.map((m) => conforms(m, schema)).find(Boolean)
    const ok = ['kind', 'totalZatoshi', 'member'].every((k) => !(k in want) || r.verdict[k] === want[k]) && !bad
    if (!ok) fail++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${r.verdict.kind.padEnd(20)} ${r.verdict.totalZatoshi ?? `member ${r.verdict.member}`} · ${ms} ms${bad ? ` · schema: ${bad}` : ''}`)
  }
}
// a file that never parses still returns a result in the published shape
const junk = conforms(JSON.parse(wasm.verify(new TextEncoder().encode('not a proof'), 'x', 0n, anchors, revoked)), schema)
if (junk) fail++
console.log(`${junk ? 'FAIL' : 'ok  '} ${'(not a proof)'.padEnd(18)} Malformed${junk ? ` · schema: ${junk}` : ''}`)
console.log(wasm.version(), fail ? `${fail} FAILED` : 'all match native and the schema')
process.exit(fail ? 1 : 0)
