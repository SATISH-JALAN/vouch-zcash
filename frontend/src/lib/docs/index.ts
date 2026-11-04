// The docs: every page, the sidebar's groups, and how a page maps to a URL.
import { anchorsDoc, architecture, circuit, verification } from './architecture'
import { attestor, credit, integration, prove, rail, reserves } from './guides'
import { api, cli, format, performance, solana } from './reference'
import { concepts, howItWorks, introduction, quickstart } from './start'
import { faq, threats, trust } from './trust'
import type { Doc } from './types'

export type { Doc, DocSection } from './types'

export const DOCS: Doc[] = [
  introduction,
  quickstart,
  concepts,
  howItWorks,
  architecture,
  circuit,
  anchorsDoc,
  verification,
  prove,
  integration,
  rail,
  reserves,
  credit,
  attestor,
  format,
  cli,
  api,
  solana,
  performance,
  trust,
  threats,
  faq,
]

/** The sidebar, in reading order. Previous and next follow it too. */
export const DOC_GROUPS: { title: string; slugs: string[] }[] = [
  { title: 'Getting started', slugs: ['introduction', 'quickstart', 'concepts', 'how-it-works'] },
  { title: 'Architecture', slugs: ['architecture', 'circuit', 'anchors', 'verification'] },
  { title: 'Guides', slugs: ['prove', 'integration', 'rail', 'reserves', 'credit', 'attestor'] },
  { title: 'Reference', slugs: ['format', 'cli', 'api', 'solana', 'performance'] },
  { title: 'Trust and security', slugs: ['trust', 'threats', 'faq'] },
]

/** The introduction is the docs' front page. */
export const docHref = (slug: string) => (slug === 'introduction' ? '/docs' : `/docs/${slug}`)

export const getDoc = (slug: string) => DOCS.find((d) => d.slug === slug)
