// Builds the Vouch Receipt test vectors from the committed exit certificates and their matched
// deposits (fixtures/*exit-deposits.json): nothing here is proven anew, and nothing is invented.
// Writes fixtures/receipts/*.json and copies them to frontend/public/receipts/.
//
//   node scripts/make-receipts.mjs
//
// The real Bitrefill receipts come from the agent (agent/), which makes a certificate bound to the
// Bitrefill invoice before paying; these vectors show the format and every refusal on known data.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const fx = (p) => new URL(`fixtures/${p}`, root)
const b64url = (b) => Buffer.from(b).toString('base64url')

function receipt(depositsFile, deposit, over = {}) {
  const d = JSON.parse(readFileSync(fx(depositsFile), 'utf8'))
  const dep = d.deposits[deposit]
  const network = d.network ?? 'demo'
  const base = {
    type: 'vouch.receipt',
    version: 1,
    order: { merchant: network === 'demo' ? 'demo rail' : 'rail:testnet-demo', id: d.intent, intent: d.intent, description: 'Exit to a rail, kept as a receipt' },
    rail: { audience: d.audience, epoch: d.epoch },
    certificate: b64url(readFileSync(fx(`proofs/${d.certificate}`))),
    payment: { network, ...(dep.txid ? { txid: dep.txid } : {}), ...(dep.height ? { height: dep.height } : {}), nullifiers: dep.nullifiers },
    issuedAt: 1793750400,
  }
  return { ...base, ...over, order: { ...base.order, ...over.order }, payment: { ...base.payment, ...over.payment } }
}

const vectors = {
  // A real Zcash testnet payment: the certificate testnet-exit.pof, bound to intent c1ea4e7e5a1f0002,
  // and transaction ff0a2488…, which spends exactly the two certified notes.
  'testnet-paid': receipt('testnet-exit-deposits.json', 'matched', {
    note: 'Real Zcash testnet artefacts: certificate testnet-exit.pof and transaction ff0a2488…, mined at 4,460,517. The payment is a self-send standing in for a merchant.',
  }),
  // The demo ledger: the same flow, no real chain.
  'demo-paid': receipt('exit-deposits.json', 'matched', { note: 'Demo ledger: no real transaction.' }),
  // Refused: the order was edited after the fact. The certificate is bound to another intent.
  'testnet-wrong-order': receipt('testnet-exit-deposits.json', 'matched', {
    order: { id: 'c1ea4e7e5a1f0003', intent: 'c1ea4e7e5a1f0003', description: 'Edited: claims a different order' },
    note: 'Refused on purpose: the order id was changed after the certificate was made.',
  }),
  // Refused: the payment spends a note the certificate never named.
  'demo-not-certified': receipt('exit-deposits.json', 'mismatch', { note: 'Refused on purpose: the payment spends a note the certificate did not name.' }),
}

mkdirSync(fx('receipts'), { recursive: true })
mkdirSync(new URL('frontend/public/receipts/', root), { recursive: true })
for (const [name, r] of Object.entries(vectors)) {
  const out = fx(`receipts/${name}.json`)
  writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`)
  copyFileSync(out, new URL(`frontend/public/receipts/${name}.json`, root))
  console.log(`wrote fixtures/receipts/${name}.json`)
}
