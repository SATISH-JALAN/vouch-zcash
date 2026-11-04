import type { Metadata } from 'next'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { ReceiptConsole } from '@/components/receipt/ReceiptConsole'

export const metadata: Metadata = {
  title: 'Check a receipt',
  description: 'A Vouch Receipt shows one party that one order was paid by the holder of certain shielded notes, without the wallet.',
}

export default function ReceiptPage() {
  return (
    <>
      <PageHead eyebrow="VOUCH RECEIPTS" title="Show one payment. Not the wallet.">
        <p>
          Your accountant, employer or a merchant’s support desk needs proof that you paid one order. A viewing key would show them every payment
          you have ever made. A Vouch Receipt shows them this one, checked in this browser.
        </p>
      </PageHead>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <ReceiptConsole />
      </div>
    </>
  )
}
