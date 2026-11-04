'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Logo } from '@/components/brand/Logo'
import { DocsNav } from './DocsNav'
import { DocsSearch } from './DocsSearch'
import type { NavGroup } from './nav'
import { THEME_KEY } from './theme'

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null)
  useEffect(() => setDark(document.querySelector<HTMLElement>('.docs')?.dataset.theme === 'dark'), [])
  const flip = () => {
    const root = document.querySelector<HTMLElement>('.docs')
    if (!root) return
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    setDark(next === 'dark')
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }
  return (
    <button type="button" className="dx-icon-btn" onClick={flip} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme">
      {/* both icons render; CSS shows the one for the current theme, so the first paint is right */}
      <svg className="dx-when-light" viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M13.5 9.6A5.6 5.6 0 016.4 2.5a5.6 5.6 0 107.1 7.1z" />
      </svg>
      <svg className="dx-when-dark" viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
      </svg>
    </button>
  )
}

export function DocsTopbar({ nav }: { nav: NavGroup[] }) {
  const [drawer, setDrawer] = useState(false)
  const pathname = usePathname()

  useEffect(() => setDrawer(false), [pathname])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawer])

  return (
    <>
      <header className="dx-topbar">
        <div className="dx-topbar-inner">
          <button type="button" className="dx-icon-btn dx-menu-btn" onClick={() => setDrawer(true)} aria-label="Open the docs menu" aria-expanded={drawer} aria-controls="dx-drawer">
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
          <Link href="/docs" className="dx-brand" aria-label="Vouch docs, home">
            <span className="dx-when-light">
              <Logo variant="horizontal" size={22} surface="bone" />
            </span>
            <span className="dx-when-dark">
              <Logo variant="horizontal" size={22} surface="shielded" />
            </span>
            <span className="dx-brand-tag">Docs</span>
          </Link>
          <div className="dx-topbar-search">
            <DocsSearch />
          </div>
          <div className="dx-topbar-links">
            <a href="/" className="dx-top-link">
              Website
            </a>
            <a href="https://github.com/SATISH-JALAN/Vouch" target="_blank" rel="noreferrer" className="dx-icon-btn" aria-label="GitHub repository (opens in a new tab)" title="GitHub">
              <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden fill="currentColor">
                <path d="M8 .2a8 8 0 00-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 014 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 008 .2z" />
              </svg>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {drawer && (
        <div className="dx-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div id="dx-drawer" className="dx-drawer" role="dialog" aria-modal="true" aria-label="Docs menu">
            <div className="dx-drawer-head">
              <span className="dx-brand-tag">Vouch Docs</span>
              <button type="button" className="dx-icon-btn" onClick={() => setDrawer(false)} aria-label="Close the menu" autoFocus>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
                </svg>
              </button>
            </div>
            <DocsNav nav={nav} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  )
}
