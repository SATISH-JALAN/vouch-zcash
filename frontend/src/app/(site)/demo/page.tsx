import type { Metadata } from 'next'
import Image from 'next/image'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { GateDemo } from '@/components/demo/GateDemo'

export const metadata: Metadata = {
  title: 'Credit line demo',
  description: 'A Solana lending pool opens a credit line against a shielded-ZEC threshold proof. Nothing is bridged.',
}

export default function DemoPage() {
  return (
    <>
      <PageHead eyebrow="GATED ACTION · SOLANA" title="Nothing is bridged. Only a proof moves.">
        <p>
          A lending pool on Solana requires proof of at least 500 ZEC. The borrower’s ZEC stays shielded on Zcash. Four steps take the proof to an
          open credit line. Run them, then break them.
        </p>
      </PageHead>
      <div className="wrap pb-[clamp(40px,4.4vw,64px)]">
        <div className="relative aspect-[2/1] overflow-hidden rounded-panel border border-border sm:aspect-[3/1]">
          <Image
            src="/visuals/demo-telegraph.webp"
            alt="Oil painting: a telegraph operator at night sends a message; beside his hand lies one card sealed in red wax, and the wires run out over a river."
            fill
            priority
            sizes="(min-width: 1760px) 1760px, 100vw"
            className="object-cover object-[50%_58%]"
          />
        </div>
      </div>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <GateDemo />
      </div>
    </>
  )
}
