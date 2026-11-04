'use client'

import { useEffect, useRef, useState } from 'react'
import { loadVerifier, verify } from '@/lib/data/verifier'
import { checkReceipt, type ReceiptResult, type ReceiptVerdict } from '@/lib/vouch-receipt'
import { formatInt, formatStamp, formatZecExact } from '@/lib/format'
import { DataTable } from '@/components/ui/DataTable'
import { Chip, cx, Panel, TrustNote } from '@/components/ui/primitives'
import { BtnLabel } from '@/components/motion/BtnLabel'

const VECTORS = [
  { file: 'testnet-paid.json', label: 'Real testnet payment' },
  { file: 'bitrefill-agent.json', label: 'Agent: Bitrefill order' },
  { file: 'demo-paid.json', label: 'Demo ledger payment' },
  { file: 'testnet-wrong-order.json', label: 'Edited order (refused)' },
  { file: 'demo-not-certified.json', label: 'Uncertified note (refused)' },
] as const

/** What pof-attest answers after reading the payment from lightwalletd. */
interface ChainAnswer {
  verdict?: { kind: string }
  chain?: { source: string; height?: number; receiptAgrees?: boolean; note?: string }
  error?: string
}

function headline(v: ReceiptVerdict): { word: string; detail: string; tone: 'valid' | 'invalid' } {
  switch (v.kind) {
    case 'Valid':
      return { word: 'Paid.', detail: `The holder of the certified notes paid this order${v.asOfPayment ? ' (certificate checked as of the payment)' : ''}.`, tone: 'valid' }
    case 'WrongOrder':
      return { word: 'Not this order.', detail: 'The certificate was signed for a different order. Someone edited this receipt, or built it from another one.', tone: 'invalid' }
    case 'NotPaidByCertifiedNotes':
      return { word: 'Not paid by these notes.', detail: `${v.notCertified.length} note(s) the payment spends were never certified.`, tone: 'invalid' }
    case 'NoShieldedSpend':
      return { word: 'No shielded payment.', detail: 'The payment spends no shielded notes, so there is nothing to match.', tone: 'invalid' }
    case 'NotACertificate':
      return { word: 'Not a receipt.', detail: 'The proof is valid but names no notes, so no payment can be tied to it.', tone: 'invalid' }
    case 'CertificateRefused':
      return { word: 'Certificate refused.', detail: `The certificate inside is ${v.certificate.kind}.`, tone: 'invalid' }
    case 'Malformed':
      return { word: 'Unreadable.', detail: v.reason, tone: 'invalid' }
  }
}

/**
 * The accountant's side of a Vouch Receipt: drop the file, get one answer. Everything runs in this
 * browser with the WASM verifier. For a real chain, pof-attest can also re-read the payment's
 * nullifiers from lightwalletd, so the receipt's own copy of them is not trusted.
 */
export function ReceiptConsole() {
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReceiptResult | null>(null)
  const [raw, setRaw] = useState<unknown>(null)
  const [chain, setChain] = useState<ChainAnswer | 'checking' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadVerifier()
      .then(() => setReady('ready'))
      .catch(() => setReady('failed'))
  }, [])

  const run = async (json: unknown) => {
    setError(null)
    setChain(null)
    setBusy(true)
    setRaw(json)
    try {
      setResult(await checkReceipt(json, (bytes, audience, o) => verify(bytes, audience, { policy: o.policy, now: o.now })))
    } catch (e) {
      setResult(null)
      setError(`The verifier could not run: ${(e as Error).message}.`)
    } finally {
      setBusy(false)
    }
  }

  const loadVector = async (file: string) => {
    try {
      const r = await fetch(`/receipts/${file}`)
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
      await run(await r.json())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const readChain = async () => {
    setChain('checking')
    try {
      const r = await fetch('/api/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt: raw }), signal: AbortSignal.timeout(45_000) })
      setChain(((await r.json().catch(() => null)) as ChainAnswer | null) ?? { error: `HTTP ${r.status}` })
    } catch (e) {
      setChain({ error: (e as Error).message })
    }
  }

  const rec = result?.receipt
  const env = result?.certificate?.envelope
  const h = result ? headline(result.verdict) : null
  const unit = result?.certificate?.anchor?.network === 'testnet' ? 'TAZ' : 'ZEC'

  return (
    <div className="space-y-6">
      <Panel label="Check a receipt" chip={<Chip status={ready === 'failed' ? 'invalid' : 'neutral'}>{ready === 'ready' ? 'WASM · READY' : ready === 'failed' ? 'VERIFIER FAILED' : 'LOADING'}</Chip>}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 sm:px-6">
          <span className="t-eyebrow mr-2 text-ink-3">TEST VECTORS · REAL CERTIFICATES</span>
          {VECTORS.map((v) => (
            <button key={v.file} type="button" disabled={busy} className="pick btn btn-sm border border-border hover:border-ink" onClick={() => void loadVector(v.file)}>
              {v.label}
            </button>
          ))}
          <label className="btn btn-sm btn-secondary cursor-pointer">
            <BtnLabel>Open a receipt…</BtnLabel>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) {
                  try {
                    await run(JSON.parse(await f.text()))
                  } catch {
                    setError('That file is not JSON.')
                  }
                }
                if (fileInput.current) fileInput.current.value = ''
              }}
            />
          </label>
        </div>
      </Panel>

      {error && (
        <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
          {error}
        </div>
      )}

      <div aria-live="polite">
        {result && h ? (
          <div className={cx('rounded-panel border bg-bone px-5 py-6 sm:px-8', h.tone === 'valid' ? 'border-valid' : 'border-invalid')}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="t-display-m text-ink">{h.word}</p>
              <Chip status={h.tone}>{result.verdict.kind.toUpperCase()}</Chip>
            </div>
            <p className="t-body mt-3 max-w-[72ch] text-ink-2">{h.detail}</p>
            {rec && (
              <dl className="t-data mt-6 grid gap-x-8 gap-y-3 border-t border-border pt-5 sm:grid-cols-2">
                <div>
                  <dt className="t-eyebrow text-ink-3">ORDER</dt>
                  <dd className="text-ink [overflow-wrap:anywhere]">
                    {rec.order.id} · {rec.order.merchant}
                    {rec.order.price ? ` · ${rec.order.price}` : ''}
                  </dd>
                  {rec.order.description && <dd className="text-ink-3">{rec.order.description}</dd>}
                </div>
                <div>
                  <dt className="t-eyebrow text-ink-3">PAYMENT</dt>
                  <dd className="font-mono text-ink [overflow-wrap:anywhere]">{rec.payment.txid ?? 'demo ledger'}</dd>
                  <dd className="text-ink-3">
                    {rec.payment.network}
                    {rec.payment.height ? ` · block ${formatInt(rec.payment.height)}` : ''}
                    {rec.payment.paidAt ? ` · ${formatStamp(rec.payment.paidAt)}` : ''}
                  </dd>
                </div>
                {env && (
                  <div>
                    <dt className="t-eyebrow text-ink-3">THE HOLDER ALSO SHOWED</dt>
                    <dd className="text-ink">
                      At least <span className="font-mono text-seal">{formatZecExact(env.claim.zatoshi)}</span> {unit} as of block {formatInt(env.anchor.height)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="t-eyebrow text-ink-3">NOT SHOWN</dt>
                  <dd className="text-ink-2">The wallet, its balance, its address, any other payment.</dd>
                </div>
              </dl>
            )}

            {result.verdict.kind === 'Valid' && rec && rec.payment.network !== 'demo' && (
              <div className="mt-6 space-y-2 border-t border-border pt-5">
                <button type="button" className="btn btn-sm btn-secondary" disabled={chain === 'checking'} onClick={() => void readChain()}>
                  <BtnLabel>{chain === 'checking' ? 'Reading the chain…' : 'Re-read the payment from the chain'}</BtnLabel>
                </button>
                {chain && chain !== 'checking' && (
                  <p className={cx('t-data', chain.verdict?.kind === 'Valid' && chain.chain?.receiptAgrees ? 'text-valid' : 'text-ink-2')}>
                    {chain.error
                      ? `Not checked against the chain: ${chain.error}.`
                      : chain.chain?.source === 'lightwalletd'
                        ? `lightwalletd: transaction mined at block ${formatInt(chain.chain.height ?? 0)}; ${chain.chain.receiptAgrees ? 'its nullifiers are exactly the ones in the receipt' : 'its nullifiers differ from the receipt’s'}. Verdict from the chain: ${chain.verdict?.kind}.`
                        : `Verdict: ${chain.verdict?.kind}.`}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-panel border border-dashed border-border px-5 py-8 sm:px-8">
            <p className="t-data text-ink-3">{busy ? 'Checking the receipt…' : 'No receipt yet. Run a test vector, or open a receipt file the agent wrote.'}</p>
          </div>
        )}
      </div>

      {result && (
        <DataTable
          caption="Receipt checks"
          rowKey={(c) => c.id}
          rows={result.checks}
          columns={[
            { key: 'label', header: 'Check', className: 'w-72', cell: (c) => c.label },
            { key: 'status', header: 'Result', className: 'w-24', cell: (c) => c.status },
            { key: 'detail', header: 'Detail', cell: (c) => c.detail },
          ]}
        />
      )}

      <TrustNote label="WHAT IT PROVES">
        The holder made an exit certificate bound to this order before paying, signed with the spend authority of the notes it names. The payment
        spends exactly those notes. So whoever paid this order controls the certified notes, and nothing about the rest of the wallet is shown. It
        does not prove what the merchant delivered, and the price is as the merchant listed it. On the demo ledger the payment’s nullifiers come
        from the receipt; on testnet and mainnet, “Re-read the payment” takes them from lightwalletd instead.
      </TrustNote>
    </div>
  )
}
