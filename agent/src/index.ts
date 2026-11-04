// Vouch Shopper: an AI agent that finds and buys through Bitrefill, pays from shielded ZEC, and hands
// over a Vouch Receipt for the order instead of a viewing key.
//
//   npm start -- "Buy a 500 INR Swiggy gift card"     the agent (a model key, and BITREFILL_API_KEY)
//   npm run selftest                                   the Vouch half alone: certify, pay, receipt (no keys)
//
// The model is Claude or any OpenAI-compatible API (models.ts). Bitrefill's MCP server is reached from
// here, not from the model provider's side, so every purchase passes an approval gate in this process
// before it is made. See agent/README.md.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createInterface } from 'node:readline/promises'
import { modelFromEnv, type ToolDef, type ToolResult } from './models.ts'
import { certify, checkWithAttestor, configFromEnv, payment, writeReceipt, type Certified, type Config } from './vouch.ts'

const BITREFILL_TOOLS = ['search-products', 'get-product-details', 'buy-products', 'get-invoice-by-id']
const MAX_TURNS = 30

const say = (s: string) => process.stdout.write(`${s}\n`)

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

const LOCAL_TOOLS: ToolDef[] = [
  {
    name: 'vouch_certify',
    description:
      'Before paying a Bitrefill invoice: make an exit certificate for the swap rail, bound to this invoice, from the shielded notes that will pay it. ' +
      'Proven offline from the user’s wallet; reveals only “at least this much, these notes” to the rail. Call once per invoice, after buy-products returns its invoice_id.',
    schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'The invoice_id buy-products returned.' },
        amount_zec: { type: 'number', description: 'The ZEC the payment needs: the rail’s quote for the invoice amount. On the demo ledger an estimate is fine.' },
      },
      required: ['invoice_id', 'amount_zec'],
      additionalProperties: false,
    },
  },
  {
    name: 'vouch_settle',
    description:
      'After vouch_certify: pay the invoice from the certified notes through the rail, then write the Vouch Receipt the user can give their accountant or employer. ' +
      'Returns the receipt file and its verdict.',
    schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        description: { type: 'string', description: 'What was bought, in a few words (e.g. “Swiggy gift card, 500 INR”).' },
        price: { type: 'string', description: 'The price as Bitrefill showed it, with its currency.' },
      },
      required: ['invoice_id', 'description', 'price'],
      additionalProperties: false,
    },
  },
]

function system(c: Config, paymentMethod: string): string {
  return [
    'You are Vouch Shopper, a shopping agent for someone who keeps their money in shielded Zcash and does not want any shop, rail or accountant to see their wallet.',
    'You buy through Bitrefill’s tools (gift cards, top-ups, eSIMs) and pay from shielded ZEC through a swap rail. You never ask for, accept or mention a seed phrase or a viewing key: the Vouch tools prove one fact instead.',
    '',
    'For each purchase, in this order:',
    '1. search-products, then get-product-details, to find exactly what the user asked for. Pick the package that matches their amount; if none does, say so and stop.',
    `2. buy-products with payment_method "${paymentMethod}" and return_payment_link false. The user approves every purchase before it is made; if they decline, stop and say so.`,
    '3. vouch_certify with the invoice_id and the ZEC needed.',
    '4. vouch_settle with the invoice_id, a short description and the price.',
    '5. get-invoice-by-id to report the invoice status, and any redemption details only if the invoice is complete.',
    '',
    `Ledger: ${c.network}${c.network === 'demo' ? ' (the ZEC payment is simulated on the demo ledger; the Bitrefill invoice is real but is not paid by it — say this plainly)' : ''}. Rail: ${c.rail}.`,
    'Finish with a short summary: what was bought, the invoice status, the receipt file, and what the receipt shows (this one order) and hides (the wallet, its balance, every other payment).',
  ].join('\n')
}

/** Bitrefill's MCP tools, allowlisted, as tool definitions for the model. */
async function bitrefill(apiKey: string) {
  const client = new Client({ name: 'vouch-shopper', version: '0.1.0' })
  // the key goes in a header: Bitrefill has retired the /mcp/<key> form
  const url = new URL(process.env.BITREFILL_MCP_URL ?? 'https://api.bitrefill.com/mcp')
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${apiKey}` } } }))
  const { tools } = await client.listTools()
  const allowed = tools.filter((t) => BITREFILL_TOOLS.includes(t.name))
  const missing = BITREFILL_TOOLS.filter((n) => !allowed.some((t) => t.name === n))
  if (missing.length) say(`  (Bitrefill MCP does not list ${missing.join(', ')}; continuing without)`)
  const defs: ToolDef[] = allowed.map((t) => ({ name: t.name, description: t.description ?? t.name, schema: t.inputSchema as Record<string, unknown> }))
  const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
    const r = await client.callTool({ name, arguments: args })
    const parts = Array.isArray(r.content) ? r.content : []
    const text = parts.map((p: { type: string; text?: string }) => (p.type === 'text' ? p.text : JSON.stringify(p))).join('\n')
    return { text: text || JSON.stringify(r), isError: r.isError === true }
  }
  return { defs, call, close: () => client.close() }
}

async function agent(prompt: string, yes: boolean) {
  const bitrefillKey = process.env.BITREFILL_API_KEY
  if (!bitrefillKey) throw new Error('set BITREFILL_API_KEY (bitrefill.com/account/developers), or run `npm run selftest` for the Vouch half alone')
  const c = configFromEnv()
  const paymentMethod = process.env.BITREFILL_PAYMENT_METHOD ?? 'usdc_base'
  const br = await bitrefill(bitrefillKey)
  const certs = new Map<string, Certified>()

  const local = async (name: string, input: Record<string, unknown>): Promise<string> => {
    const invoice = String(input.invoice_id)
    if (name === 'vouch_certify') {
      say(`  vouch · certifying the notes for invoice ${invoice} (offline)…`)
      const cert = await certify(c, 'bitrefill', invoice, Number(input.amount_zec))
      certs.set(invoice, cert)
      say(`  vouch · certificate ${cert.file} verifies (${cert.verifyMs} ms)`)
      return JSON.stringify({ ok: true, intent: cert.intent, claim: `at least ${cert.zatoshi / 1e8} ZEC`, rail: c.rail, notesNamed: cert.revealed.length })
    }
    if (name === 'vouch_settle') {
      const cert = certs.get(invoice)
      if (!cert) return JSON.stringify({ ok: false, error: 'call vouch_certify for this invoice first' })
      let txid: string | undefined
      if (c.network !== 'demo') {
        say(`\n  Send at least ${cert.zatoshi / 1e8} ${c.network === 'testnet' ? 'TAZ' : 'ZEC'} to the rail for invoice ${invoice}, from the certified notes only.`)
        txid = (await ask('  Paste the transaction id once it is mined: ')) || undefined
      }
      const pay = await payment(c, cert, txid)
      const file = writeReceipt(c, { merchant: 'bitrefill', id: invoice, description: String(input.description), price: String(input.price) }, cert, pay)
      const verdict = await checkWithAttestor(c, file)
      say(`  vouch · receipt ${file} · ${verdict}`)
      return JSON.stringify({ ok: true, receipt: file, verdict, ledger: c.network, shows: 'this order was paid by the holder of the certified notes', hides: 'the wallet, its balance, every other payment' })
    }
    return JSON.stringify({ ok: false, error: `unknown tool ${name}` })
  }

  const gate = async (name: string, input: Record<string, unknown>): Promise<string | null> => {
    if (name !== 'buy-products' || yes) return null
    say(`\n  The agent wants to buy:\n${JSON.stringify(input, null, 2).replace(/^/gm, '    ')}`)
    return (await ask('  Approve this purchase? [y/N] ')).toLowerCase().startsWith('y') ? null : 'The user declined this purchase. Do not retry it.'
  }

  const model = modelFromEnv(system(c, paymentMethod), prompt, [...br.defs, ...LOCAL_TOOLS])
  say(`model · ${model.label}`)
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { text, calls } = await model.turn()
      for (const t of text) say(`\n${t}`)
      if (!calls.length) return
      const results: ToolResult[] = []
      for (const u of calls) {
        try {
          const declined = await gate(u.name, u.input)
          if (declined) {
            results.push({ id: u.id, content: declined, isError: true })
            continue
          }
          if (BITREFILL_TOOLS.includes(u.name)) {
            say(`  bitrefill · ${u.name}`)
            const r = await br.call(u.name, u.input)
            results.push({ id: u.id, content: r.text, isError: r.isError })
          } else {
            results.push({ id: u.id, content: await local(u.name, u.input), isError: false })
          }
        } catch (e) {
          results.push({ id: u.id, content: `error: ${(e as Error).message}`, isError: true })
        }
      }
      model.answer(results)
    }
    say(`\n(stopped after ${MAX_TURNS} turns)`)
  } finally {
    await br.close()
  }
}

/** The Vouch half on its own, with no API keys: certify for an order, pay on the demo ledger, write and check the receipt. */
async function selftest() {
  const c = { ...configFromEnv(), network: 'demo' as const, rail: 'rail:demo' }
  const id = `selftest-${Date.now()}`
  say(`selftest · order ${id} (not a real Bitrefill invoice) · demo ledger · rail ${c.rail}`)
  const cert = await certify(c, 'selftest', id, 0.3)
  say(`  certificate ${cert.file}: at least ${cert.zatoshi / 1e8} ZEC, bound to “${cert.intent}”, verifies in ${cert.verifyMs} ms`)
  const pay = await payment(c, cert)
  const file = writeReceipt(c, { merchant: 'selftest', id, description: 'selftest order', price: '0.3 ZEC' }, cert, pay)
  say(`  receipt ${file}`)
  say(`  pof-attest verdict: ${await checkWithAttestor(c, file)}`)
}

const [cmd, ...rest] = process.argv.slice(2)
const yes = rest.includes('--yes') || cmd === '--yes'
const main = cmd === 'selftest' ? selftest() : agent([cmd, ...rest].filter((a) => a && a !== '--yes').join(' ') || 'Buy a 500 INR Swiggy gift card.', yes)
main.catch((e: Error) => {
  console.error(`\nerror: ${e.message}`)
  process.exit(1)
})
