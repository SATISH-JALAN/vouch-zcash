import type { Metadata } from 'next'
import { getDoc } from '@/lib/docs'
import { DocArticle } from '@/components/docs/DocArticle'

export const metadata: Metadata = { title: { absolute: 'Vouch Docs' } }

export default function DocsHome() {
  return <DocArticle doc={getDoc('introduction')!} />
}
