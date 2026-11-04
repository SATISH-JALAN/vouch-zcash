'use client'

import { useState, type ReactNode } from 'react'

export type Lang = 'bash' | 'json' | 'rust' | 'ts' | 'http' | 'text'

/** A guess good enough for the docs' own snippets; a block can always name its language. */
export function detectLang(code: string): Lang {
  const s = code.trimStart()
  if (/^(pof-|curl |cargo |git |cd |pnpm |node |wsl |POF_|SITE=|export )/.test(s)) return 'bash'
  if (/^(GET|POST|PUT|DELETE) \//.test(s)) return 'http'
  if (/^[[{]/.test(s)) return 'json'
  if (/^(pub |use |fn |impl |struct |enum )/.test(s)) return 'rust'
  if (/^(import |const |let |await |export )/.test(s)) return 'ts'
  return 'text'
}

const LABEL: Record<Lang, string> = { bash: 'Shell', json: 'JSON', rust: 'Rust', ts: 'TypeScript', http: 'HTTP', text: 'Text' }

// Light highlighting: comments, strings and shell flags. Enough to read a snippet at a glance;
// no grammar, so nothing to get subtly wrong.
const RULES: Partial<Record<Lang, RegExp>> = {
  bash: /(^|\s)(#[^\n]*)|("[^"\n]*"|'[^'\n]*')|(\s--?[a-z][\w-]*)/g,
  json: /()()("(?:[^"\\\n]|\\.)*")()/g,
  rust: /()(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")()/g,
  ts: /()(\/\/[^\n]*)|('[^'\n]*'|"[^"\n]*"|`[^`]*`)()/g,
  http: /()(→[^\n]*)|("(?:[^"\\\n]|\\.)*")()/g,
}

function highlight(code: string, lang: Lang): ReactNode {
  const re = RULES[lang]
  if (!re) return code
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of code.matchAll(re)) {
    const [whole, lead = '', comment, str, flag] = m
    const at = m.index ?? 0
    out.push(code.slice(last, at) + lead)
    if (comment) out.push(<span key={k++} className="tok-comment">{comment}</span>)
    else if (str) out.push(<span key={k++} className="tok-string">{str}</span>)
    else if (flag) out.push(<span key={k++} className="tok-flag">{flag}</span>)
    last = at + whole.length
  }
  out.push(code.slice(last))
  return out
}

export function CodeBlock({ code, lang, title }: { code: string; lang?: Lang; title?: string }) {
  const [copied, setCopied] = useState(false)
  const l = lang ?? detectLang(code)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard blocked (an insecure origin or a denied permission): the text stays selectable
    }
  }
  return (
    <figure className="dx-code">
      <figcaption className="dx-code-head">
        <span>{title ?? LABEL[l]}</span>
        <button type="button" onClick={() => void copy()} className="dx-code-copy" aria-label={copied ? 'Copied' : 'Copy code'}>
          {copied ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 3.5v-.5A1.5 1.5 0 009 1.5H3A1.5 1.5 0 001.5 3v6A1.5 1.5 0 003 10.5h.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      {/* tabIndex: a block wider than the column scrolls sideways, and a keyboard has to be able to scroll it too */}
      <pre tabIndex={0}>
        <code>{highlight(code, l)}</code>
      </pre>
    </figure>
  )
}
