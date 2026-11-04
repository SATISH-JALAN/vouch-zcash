// Plain text of every docs section, for the search box. Built once at build time from the same
// React trees the pages render, so the index can never drift from what the pages say.
import { isValidElement, type ReactNode } from 'react'
import { DOC_GROUPS, DOCS, docHref } from './docs'

export interface SearchEntry {
  id: string
  href: string
  page: string
  group: string
  section: string
  text: string
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (!isValidElement(node)) return ''
  const props = node.props as { code?: unknown; children?: ReactNode }
  if (typeof props.code === 'string') return props.code
  if (props.children !== undefined) return textOf(props.children)
  // a component without children (a table): render it as a plain function. A client component
  // cannot be called on the server; it has nothing to index beyond its props anyway.
  if (typeof node.type === 'function') {
    try {
      return textOf((node.type as (p: unknown) => ReactNode)(node.props))
    } catch {
      return ''
    }
  }
  return ''
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

export function searchIndex(): SearchEntry[] {
  const groupOf = new Map(DOC_GROUPS.flatMap((g) => g.slugs.map((s) => [s, g.title] as const)))
  return DOCS.flatMap((d) => {
    const base = docHref(d.slug)
    const group = groupOf.get(d.slug) ?? ''
    return [
      { id: d.slug, href: base, page: d.title, group, section: '', text: d.lede },
      ...d.sections.map((s) => ({ id: `${d.slug}#${s.id}`, href: `${base}#${s.id}`, page: d.title, group, section: s.title, text: squash(textOf(s.body)) })),
    ]
  })
}
