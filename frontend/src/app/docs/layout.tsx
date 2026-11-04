import type { Metadata } from 'next'
import { DocsNav } from '@/components/docs/DocsNav'
import { DocsTopbar } from '@/components/docs/DocsTopbar'
import { DOCS_NAV } from '@/components/docs/nav'
import { THEME_SCRIPT } from '@/components/docs/theme'
import { WarmAttestor } from '@/components/site/WarmAttestor'
import './docs.css'

export const metadata: Metadata = {
  title: { default: 'Vouch Docs', template: '%s · Vouch Docs' },
  description: 'Documentation for Vouch, the disclosure layer for shielded Zcash: exit certificates, proof of funds and reserves.',
}

/** The docs are their own site: no marketing nav, no scroll motion, a sidebar and search instead. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by the inline script, so React must not fight it
    <div className="docs" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <DocsTopbar nav={DOCS_NAV} />
      <div className="dx-body">
        <aside className="dx-sidebar">
          <DocsNav nav={DOCS_NAV} />
        </aside>
        <main id="main" tabIndex={-1} className="dx-main">
          {children}
        </main>
      </div>
      <WarmAttestor />
    </div>
  )
}
