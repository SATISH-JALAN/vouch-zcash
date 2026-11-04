import type { Metadata } from 'next'
import { PageHead } from '@/components/site/PageHead'
import { Rule } from '@/components/ui/primitives'
import { RequestBuilder } from '@/components/request/RequestBuilder'

export const metadata: Metadata = {
  title: 'Request a proof',
  description: 'Ask a holder for exactly one fact. Choose the claim, the audience and the expiry, and send a link.',
}

export default function RequestPage() {
  return (
    <>
      <PageHead eyebrow="PROOF REQUEST" title="Ask for exactly one fact.">
        <p>Choose the threshold, name yourself as the audience, set an expiry. Send the link. It opens the holder’s review screen, which shows precisely what you will learn before they approve.</p>
      </PageHead>
      <Rule />
      <div className="wrap pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <RequestBuilder />
      </div>
    </>
  )
}
