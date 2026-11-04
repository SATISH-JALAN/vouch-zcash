import type { Metadata } from 'next'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { ReservesConsole } from '@/components/reserves/ReservesConsole'

export const metadata: Metadata = {
  title: 'Verify reserves',
  description: 'Check a Vouch reserves batch: several proofs from one holder, summed, with no note counted twice. Read in your browser.',
}

export default function ReservesPage() {
  return (
    <>
      <PageHead eyebrow="RESERVES" title="Shielded reserves, added up.">
        <p>
          A treasury, a fund or a desk proves its shielded reserves in a batch of proofs. You get one total, as of one block, with no note
          counted twice, and never the balance itself or a single address.
        </p>
      </PageHead>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <ReservesConsole />
      </div>
    </>
  )
}
