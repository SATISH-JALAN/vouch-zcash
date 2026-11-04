'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavGroup } from './nav'

export function DocsNav({ nav, onNavigate }: { nav: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Documentation" className="dx-nav">
      {nav.map((g) => (
        <div key={g.title} className="dx-nav-group">
          <p className="dx-nav-title">{g.title}</p>
          <ul>
            {g.items.map((i) => {
              const active = pathname === i.href
              return (
                <li key={i.slug}>
                  <Link href={i.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className="dx-nav-link">
                    {i.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className="dx-nav-group dx-nav-out">
        <p className="dx-nav-title">Elsewhere</p>
        <ul>
          <li>
            <a href="/verify" className="dx-nav-link">
              Open the verifier
            </a>
          </li>
          <li>
            <a href="https://github.com/SATISH-JALAN/Vouch" target="_blank" rel="noreferrer" className="dx-nav-link">
              GitHub <span aria-hidden>↗</span>
            </a>
          </li>
        </ul>
      </div>
    </nav>
  )
}
