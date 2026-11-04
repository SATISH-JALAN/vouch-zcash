// The docs search index: static, built with the site, fetched the first time someone opens search.
import { searchIndex } from '@/lib/docs-search'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(searchIndex())
}
