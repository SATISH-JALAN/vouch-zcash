import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { DOCS, getDoc } from '@/lib/docs'
import { DocArticle } from '@/components/docs/DocArticle'

export const dynamicParams = false

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: [d.slug] }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params
  const doc = getDoc(slug.join('/'))
  return doc ? { title: doc.title, description: doc.lede } : {}
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const key = slug.join('/')
  if (key === 'introduction') permanentRedirect('/docs')
  const doc = getDoc(key)
  if (!doc) notFound()
  return <DocArticle doc={doc} />
}
