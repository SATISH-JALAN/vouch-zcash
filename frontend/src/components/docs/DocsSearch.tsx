'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import MiniSearch, { type SearchResult } from 'minisearch'
import type { SearchEntry } from '@/lib/docs-search'

const SUGGESTED = [
  { href: '/docs/quickstart', page: 'Quick start', section: 'Check a real testnet proof in five minutes' },
  { href: '/docs/how-it-works', page: 'How it works', section: 'The chain facts a proof stands on' },
  { href: '/docs/rail', page: 'Exit certificates', section: 'Ask, check, match the deposit' },
  { href: '/docs/cli', page: 'CLI reference', section: 'pof-prove, pof-verify, pof-anchor' },
]

let indexPromise: Promise<MiniSearch<SearchEntry>> | null = null
function loadIndex() {
  indexPromise ??= fetch('/api/docs-index')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<SearchEntry[]>
    })
    .then((entries) => {
      const ms = new MiniSearch<SearchEntry>({
        fields: ['page', 'section', 'text'],
        storeFields: ['href', 'page', 'section', 'group', 'text'],
        searchOptions: { boost: { section: 3, page: 2 }, prefix: true, fuzzy: 0.2 },
      })
      ms.addAll(entries)
      return ms
    })
    .catch((err) => {
      indexPromise = null // try again next time
      throw err
    })
  return indexPromise
}

/** A short excerpt around the first hit, with the hits marked. */
function snippet(text: string, terms: string[]): ReactNode {
  if (!text) return null
  const lower = text.toLowerCase()
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 50)
  const cut = text.slice(start, start + 150)
  const parts: ReactNode[] = [start > 0 ? '…' : '']
  if (terms.length === 0) return cut
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  cut.split(re).forEach((p, i) => parts.push(i % 2 ? <mark key={i}>{p}</mark> : p))
  if (start + 150 < text.length) parts.push('…')
  return parts
}

export function DocsSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [ms, setMs] = useState<MiniSearch<SearchEntry> | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [mac, setMac] = useState(false)

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), [])

  const show = useCallback(() => {
    setOpen(true)
    setFailed(false)
    loadIndex().then(setMs, () => setFailed(true))
  }, [])
  const hide = useCallback(() => {
    setOpen(false)
    setQ('')
    setActive(0)
    trigger.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (open) hide()
        else show()
      } else if (e.key === '/' && !typing && !open) {
        e.preventDefault()
        show()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, show, hide])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const terms = useMemo(
    () =>
      q
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    [q],
  )
  const results = useMemo(() => {
    if (!ms || !q.trim()) return [] as (SearchResult & Partial<SearchEntry>)[]
    return ms.search(q).slice(0, 10) as (SearchResult & Partial<SearchEntry>)[]
  }, [ms, q])

  const list = q.trim() ? results.map((r) => ({ href: r.href!, page: r.page!, section: r.section ?? '', text: r.text ?? '' })) : SUGGESTED.map((s) => ({ ...s, text: '' }))

  const go = (href: string) => {
    hide()
    router.push(href)
  }

  return (
    <>
      <button ref={trigger} type="button" className="dx-search-trigger" onClick={show} aria-haspopup="dialog">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.6" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <span className="dx-search-label">Search docs…</span>
        <kbd className="dx-kbd">{mac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      {open && (
        <div className="dx-search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
          <div className="dx-search" role="dialog" aria-modal="true" aria-label="Search the docs">
            <div className="dx-search-field">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.6" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') hide()
                  else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(a + 1, list.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Enter' && list[active]) {
                    e.preventDefault()
                    go(list[active].href)
                  }
                }}
                placeholder="Search the docs"
                aria-label="Search the docs"
                aria-controls="dx-search-results"
                aria-activedescendant={list[active] ? `dx-r-${active}` : undefined}
                role="combobox"
                aria-expanded="true"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="dx-kbd dx-search-esc" onClick={hide}>
                Esc
              </button>
            </div>
            <div className="dx-search-body">
              {!q.trim() && <p className="dx-search-hint">Suggested</p>}
              {failed && <p className="dx-search-empty">The search index did not load. Check your connection and try again.</p>}
              {!failed && q.trim() && !ms && <p className="dx-search-empty">Loading…</p>}
              {!failed && q.trim() && ms && results.length === 0 && <p className="dx-search-empty">Nothing matches “{q}”.</p>}
              <ul id="dx-search-results" role="listbox" aria-label="Results">
                {list.map((r, i) => (
                  <li key={r.href} id={`dx-r-${i}`} role="option" aria-selected={i === active}>
                    <button type="button" className="dx-search-result" onMouseEnter={() => setActive(i)} onClick={() => go(r.href)}>
                      <span className="dx-search-page">
                        {r.page}
                        {r.section && <span className="dx-search-section"> › {r.section}</span>}
                      </span>
                      {r.text && <span className="dx-search-snippet">{snippet(r.text, terms)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="dx-search-foot">
              <span>
                <kbd className="dx-kbd">↑</kbd> <kbd className="dx-kbd">↓</kbd> to move
              </span>
              <span>
                <kbd className="dx-kbd">Enter</kbd> to open
              </span>
              <span>
                <kbd className="dx-kbd">Esc</kbd> to close
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
