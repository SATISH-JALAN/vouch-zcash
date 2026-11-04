// The building blocks the docs are written in. Server components: only CodeBlock ships JavaScript.
import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { CodeBlock, type Lang } from './CodeBlock'

export function Code({ children, lang, title }: { children: string; lang?: Lang; title?: string }) {
  return <CodeBlock code={children} lang={lang} title={title} />
}

/** Inline code wraps only between words, so a flag like --bind-solana never splits at its hyphen; a long
 * hash may still break anywhere, or it would push a phone's page sideways. */
export function C({ children }: { children: ReactNode }) {
  if (typeof children !== 'string') return <code className="dx-inline">{children}</code>
  const words = children.split(' ')
  return (
    <code className="dx-inline">
      {/* the space stays outside the no-wrap span: that is where a line may break */}
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className={w.length > 24 ? undefined : 'dx-nw'}>{w}</span>
        </Fragment>
      ))}
    </code>
  )
}

/** Pages of the site and the docs navigate in place; files, APIs and other sites open as files or in a new tab. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('http'))
    return (
      <a className="dx-link" href={href} target="_blank" rel="noreferrer">
        {children}
        <span aria-hidden className="dx-ext">↗</span>
      </a>
    )
  if (/^\/(api|schema|wasm|fixtures)\b/.test(href) || /\.[a-z0-9]+$/i.test(href.split('#')[0]!))
    return (
      <a className="dx-link" href={href}>
        {children}
      </a>
    )
  return (
    <Link className="dx-link" href={href}>
      {children}
    </Link>
  )
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div tabIndex={0} role="region" aria-label={head.join(', ')} className="dx-table">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type HintKind = 'info' | 'success' | 'warning' | 'danger'
const HINT_ICON: Record<HintKind, ReactNode> = {
  info: <path d="M8 7.2v4M8 4.8v.01M8 14.5A6.5 6.5 0 108 1.5a6.5 6.5 0 000 13z" />,
  success: <path d="M5 8.3l2 2 4-4.3M8 14.5A6.5 6.5 0 108 1.5a6.5 6.5 0 000 13z" />,
  warning: <path d="M8 6v3.4M8 11.6v.01M7.1 2.1L1.4 12.4a1 1 0 00.9 1.5h11.4a1 1 0 00.9-1.5L8.9 2.1a1 1 0 00-1.8 0z" />,
  danger: <path d="M8 4.8v4M8 11.2v.01M8 14.5A6.5 6.5 0 108 1.5a6.5 6.5 0 000 13z" />,
}

/** A callout, as GitBook calls a hint. */
export function Hint({ kind = 'info', title, children }: { kind?: HintKind; title?: string; children: ReactNode }) {
  return (
    <div className={`dx-hint dx-hint-${kind}`} role="note">
      <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {HINT_ICON[kind]}
      </svg>
      <div className="dx-hint-body">
        {title && <p className="dx-hint-title">{title}</p>}
        {children}
      </div>
    </div>
  )
}

export const Cards = ({ children }: { children: ReactNode }) => <div className="dx-cards">{children}</div>

export function Card({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  const inner = (
    <>
      <span className="dx-card-title">
        {title}
        <span aria-hidden className="dx-card-arrow">
          →
        </span>
      </span>
      <span className="dx-card-text">{children}</span>
    </>
  )
  return href.startsWith('http') ? (
    <a className="dx-card" href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    <Link className="dx-card" href={href}>
      {inner}
    </Link>
  )
}

/** Numbered steps with a rail down the side. */
export const Steps = ({ children }: { children: ReactNode }) => <ol className="dx-steps">{children}</ol>
export const Step = ({ title, children }: { title: string; children: ReactNode }) => (
  <li>
    <p className="dx-step-title">{title}</p>
    {children}
  </li>
)

/** A sub-heading inside a section. */
export const H3 = ({ children }: { children: ReactNode }) => <h3>{children}</h3>

/** Stat tiles: a label, one number, an optional note. */
export const Stats = ({ children }: { children: ReactNode }) => <div className="dx-stats">{children}</div>
export const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div className="dx-stat">
    <span className="dx-stat-label">{label}</span>
    <span className="dx-stat-value">{value}</span>
    {note && <span className="dx-stat-note">{note}</span>}
  </div>
)
