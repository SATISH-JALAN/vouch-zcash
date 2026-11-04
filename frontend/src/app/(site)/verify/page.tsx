import type { Metadata } from 'next'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { VerifierConsole } from '@/components/verify/VerifierConsole'

export const metadata: Metadata = {
  title: 'Verify a proof',
  description: 'Paste or drop a Vouch proof and get one answer: valid, invalid, or expired. No signup, no wallet.',
}

export default function VerifyPage() {
  return (
    <>
      <PageHead eyebrow="VERIFIER" title="Paste a proof. Get one answer.">
        <p>
          Valid, invalid, or expired. Nothing to interpret, no account, no wallet. The proof is read in this browser and is not uploaded
          anywhere.
        </p>
      </PageHead>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <VerifierConsole />
      </div>
    </>
  )
}
