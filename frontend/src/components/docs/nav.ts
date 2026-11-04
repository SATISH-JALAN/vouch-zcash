import { DOC_GROUPS, docHref, getDoc } from '@/lib/docs'

export interface NavGroup {
  title: string
  items: { slug: string; href: string; title: string }[]
}

/** The sidebar's data: titles and links only, so no page body reaches the client through it. */
export const DOCS_NAV: NavGroup[] = DOC_GROUPS.map((g) => ({
  title: g.title,
  items: g.slugs.map((slug) => ({ slug, href: docHref(slug), title: getDoc(slug)!.title })),
}))

export const DOCS_ORDER = DOCS_NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))
