// The authenticated anchor table: both roots at each published height. Static, cacheable,
// and re-derivable by anyone from public chain data with `pof-anchor` (demo anchors from the
// committed demo ledger). The verifier never trusts an anchor that is not in this table.
import anchors from '@/data/anchors.json'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(anchors, { headers: { 'cache-control': 'public, max-age=300, s-maxage=3600' } })
}
