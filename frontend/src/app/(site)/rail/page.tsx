import type { Metadata } from 'next'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { RailConsole } from '@/components/rail/RailConsole'

export const metadata: Metadata = {
  title: 'Rail console (demo)',
  description: 'A swap rail’s compliance desk, as a demo: receive an exit certificate, check it under your own policy, match the deposit when it lands.',
}

export default function RailPage() {
  return (
    <>
      <PageHead eyebrow="DEMO RAIL" title="A held deposit, with evidence.">
        <p>
          A shielded holder sends you coins and an exit certificate: at least this much, in notes unmoved since a block you choose, and these are
          the notes. Check it under your own period and policy, then match the deposit when it lands.
        </p>
      </PageHead>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <RailConsole />
      </div>
    </>
  )
}
