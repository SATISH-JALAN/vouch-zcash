# Vouch Shopper

An AI shopping agent for people who keep their money in shielded Zcash. It finds and buys through **Bitrefill**, pays from **shielded ZEC** through a swap rail, and hands you a **Vouch Receipt** for each order: proof the order was paid by you, without your wallet.

```
you ▸ Buy a 500 INR Swiggy gift card
  bitrefill · search-products
  bitrefill · get-product-details

  The agent wants to buy:
    { "cart_items": [{ "product_id": "<swiggy product>", "package_id": "500" }], "payment_method": "usdc_base", … }
  Approve this purchase? [y/N] y
  bitrefill · buy-products
  vouch · certifying the notes for invoice <id> (offline)…
  vouch · certificate out/<id>.pof verifies (351 ms)
  vouch · receipt out/receipt-<id>.json · Valid
  bitrefill · get-invoice-by-id
```

*(The shape of a run, with ids elided. The timing is from `npm run selftest` on a laptop.)*

## What it does, step by step

| Step | Tool | Where it runs |
| --- | --- | --- |
| Find the product | `search-products`, `get-product-details` (Bitrefill MCP) | Bitrefill |
| **Ask you** | approval prompt before every `buy-products` | this process: it cannot be skipped |
| Create the invoice | `buy-products` | Bitrefill |
| Certify the notes for this invoice | `vouch_certify` → `pof-prove … --exit --intent bitrefill:invoice:<id>`, then `pof-verify` | your machine, offline |
| Pay, and write the receipt | `vouch_settle` → payment, `receipt-<id>.json`, attestor verdict | your wallet / rail, then pof-attest |
| Report | `get-invoice-by-id` | Bitrefill |

The agent never sees a seed or a viewing key. It sees file paths and verdicts. Bitrefill’s MCP server is reached from this process (with the MCP TypeScript SDK) rather than from the model provider’s side, so the purchase gate is enforced here.

The model is whichever key you have (`src/models.ts`): **Claude** with `ANTHROPIC_API_KEY`, or any **OpenAI-compatible API with tool calling** with `LLM_API_KEY`: Google Gemini (default `gemini-3.5-flash`, free key at aistudio.google.com/apikey), Groq, OpenRouter or OpenAI.

## Run it

```bash
# once: the CLIs the agent drives
(cd ../backend && cargo build --release -p pof-prove -p pof-verify -p pof-attest)
npm install

# the Vouch half alone, no keys needed
npm run selftest

# the agent
export LLM_API_KEY=…                          # free Gemini key: aistudio.google.com/apikey
# or: LLM_PROVIDER=groq|openrouter|openai with that provider’s key · or ANTHROPIC_API_KEY=sk-ant-… for Claude
export BITREFILL_API_KEY=…                     # bitrefill.com/account/developers
npm start -- "Buy a 500 INR Swiggy gift card"  # add --yes to skip the approval prompt (not recommended)
```

Run the attestor for receipt verdicts and for reading testnet payments: see the root README, *Running it*. Without it, the agent still writes the receipt, and you can check it at `/receipt`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `gemini` (or `anthropic` when `ANTHROPIC_API_KEY` is set) | `gemini`, `groq`, `openrouter`, `openai` or `anthropic` |
| `LLM_API_KEY` | — | the key for that provider (not needed for `anthropic`) |
| `LLM_MODEL`, `LLM_BASE_URL` | the provider’s default | any model with tool calling; any OpenAI-compatible endpoint |
| `VOUCH_NETWORK` | `demo` | `demo`, `testnet` or `mainnet` |
| `VOUCH_RAIL` | `rail:demo` / `rail:testnet-demo` | the swap rail’s Vouch identifier: the certificate’s audience |
| `VOUCH_EPOCH` | this month, `YYYYMM` | the rail’s period, in which it sees reuse |
| `VOUCH_ATTEST_URL` | `http://127.0.0.1:8787` | pof-attest |
| `VOUCH_SNAPSHOT`, `VOUCH_SEED_FILE` | — | testnet / mainnet: the chain snapshot from `pof-anchor scan`, and your seed file |
| `VOUCH_OUT` | `agent/out` | where certificates and receipts are written |
| `BITREFILL_PAYMENT_METHOD` | `usdc_base` | the invoice’s payment method. `balance` pays from your Bitrefill balance at once: real money |

## The three ledgers, honestly

| `VOUCH_NETWORK` | Certificate | ZEC payment | Bitrefill invoice |
| --- | --- | --- | --- |
| `demo` | a real Halo2 proof over the demo chain | **simulated**: spends the first certified note on the demo ledger | real; not paid by demo coins |
| `testnet` | from your testnet wallet | you send TAZ, paste the txid; nullifiers read from lightwalletd | real; not settled by TAZ |
| `mainnet` | from your wallet | through a rail that takes shielded ZEC and pays the invoice | paid by the rail |

Bitrefill does not list ZEC as a payment method, which is why a rail sits in the middle. That is also the venue where shielded deposits get held as “unknown” today, and where an exit certificate lets one through.
