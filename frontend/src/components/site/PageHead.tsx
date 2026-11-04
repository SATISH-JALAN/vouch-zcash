import type { ReactNode } from 'react'
import { Eyebrow } from '@/components/ui/primitives'

/** Top of an application route: eyebrow → 44px → display headline → prose. */
export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="wrap pb-[clamp(48px,5.5vw,80px)] pt-[clamp(56px,6.667vw,96px)]">
      <div className="section-head">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="t-display-l max-w-[20ch] text-ink">{title}</h1>
      </div>
      {children && <div className="t-prose mt-8 space-y-4 text-ink-2">{children}</div>}
    </header>
  )
}
