import type { Metadata } from 'next'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { ProveConsole } from '@/components/prove/ProveConsole'

export const metadata: Metadata = {
  title: 'Answer a proof request',
  description: 'See exactly what a verifier will and will not learn, then prove one fact about your shielded ZEC. Keys never leave your machine.',
}

export default function ProvePage() {
  return (
    <>
      <PageHead eyebrow="PROVER" title="See what they learn. Then decide.">
        <p>
          Nothing is generated until you approve. The proof says one thing, to one party, until one date, and you can revoke it. Your keys never
          leave your machine and nothing is broadcast.
        </p>
      </PageHead>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <ProveConsole />
      </div>
    </>
  )
}
