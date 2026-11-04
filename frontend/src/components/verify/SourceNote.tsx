import type { VerificationResult } from '@/lib/data/types'
import { TrustNote } from '@/components/ui/primitives'

const PROOF = {
  pass: 'The Halo2 proof and the holder’s signature were checked here.',
  fail: 'The holder’s signature or the Halo2 proof failed here.',
  'not-run': 'An earlier check failed, so the Halo2 proof and the holder’s signature were not checked.',
} as const

/** Every verdict surface carries this. It must be truthful about what actually ran. */
export function SourceNote({ result, className }: { result: VerificationResult; className?: string }) {
  const proof = result.checks.find((c) => c.id === 'proof')?.status ?? 'not-run'
  return (
    <div className={className}>
      <TrustNote label="WASM">
        Verified in this browser by {result.verifier} compiled to WebAssembly: the same Rust code as the CLI and the attestor. {PROOF[proof]} The
        proof was not sent anywhere.
      </TrustNote>
      {result.anchor?.network === 'demo' && (
        <TrustNote label="DEMO ANCHOR" tone="strong" className="mt-3">
          This proof is anchored to the published demo ledger, not to Zcash mainnet: the notes are real Ironwood notes under a real key and the
          proof is real, but the commitment tree and nullifier set are ours. Mainnet anchors are rebuilt from public chain data by pof-anchor.
        </TrustNote>
      )}
      {result.anchor?.network === 'testnet' && (
        <TrustNote label="ZCASH TESTNET" tone="strong" className="mt-3">
          This proof is anchored to Zcash testnet: real Ironwood notes on the public testnet chain, with roots rebuilt from testnet lightwalletd
          data by pof-anchor. Testnet coins (TAZ) have no monetary value, so it says nothing about mainnet funds.
        </TrustNote>
      )}
    </div>
  )
}
