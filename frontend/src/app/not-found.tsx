import Image from 'next/image'
import Link from 'next/link'
import { Mark } from '@/components/brand/Mark'
import { Eyebrow } from '@/components/ui/primitives'
import { SiteChrome } from '@/components/site/SiteChrome'

export default function NotFound() {
  return (
    <SiteChrome>
      <div className="wrap grid min-h-[70vh] items-center gap-12 py-24 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="flex flex-col gap-8">
          <Mark size={56} state="void" tone="void" />
          <Eyebrow>404 · NOT FOUND</Eyebrow>
          <h1 className="t-display-l max-w-[16ch] text-ink">Nothing here to verify.</h1>
          <p>
            <Link href="/" className="link-draw t-data text-ink">
              Back to the start →
            </Link>
          </p>
        </div>
        <Image
          src="/visuals/not-found.webp"
          alt="Oil painting: an empty exhibition hall at dawn; on the floor lies one card with a broken red wax seal."
          width={640}
          height={800}
          unoptimized
          className="mx-auto h-auto w-full max-w-[280px] md:max-w-none"
        />
      </div>
    </SiteChrome>
  )
}
