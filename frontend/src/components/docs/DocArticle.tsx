import Link from 'next/link'
import type { Doc } from '@/lib/docs'
import { LINKS } from '@/lib/site'
import { DocToc } from './DocToc'
import { DOCS_ORDER } from './nav'

const SOURCE = `${LINKS.repo ?? 'https://github.com/SATISH-JALAN/Vouch'}/blob/main/frontend/src/lib/docs.tsx`

/** One docs page: breadcrumb, title, lede, sections with anchor links, prev and next; the contents rail beside it. */
export function DocArticle({ doc }: { doc: Doc }) {
  const at = DOCS_ORDER.findIndex((d) => d.slug === doc.slug)
  const here = DOCS_ORDER[at]
  const prev = at > 0 ? DOCS_ORDER[at - 1] : undefined
  const next = at >= 0 && at < DOCS_ORDER.length - 1 ? DOCS_ORDER[at + 1] : undefined
  const toc = doc.sections.map(({ id, title }) => ({ id, title }))

  return (
    <div className="dx-page">
      <article className="dx-article">
        <header className="dx-head">
          {here && (
            <p className="dx-crumb">
              <span>{here.group}</span>
            </p>
          )}
          <h1>{doc.title}</h1>
          <p className="dx-lede">{doc.lede}</p>
        </header>

        {toc.length > 1 && (
          <details className="dx-toc-mobile">
            <summary>On this page</summary>
            <ul>
              {toc.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="dx-prose">
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}>
                <a href={`#${s.id}`} className="dx-anchor" aria-label={`Link to “${s.title}”`}>
                  #
                </a>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}
        </div>

        <footer className="dx-foot">
          <nav className="dx-pager" aria-label="Previous and next page">
            {prev ? (
              <Link href={prev.href} className="dx-pager-link" rel="prev">
                <span className="dx-pager-dir">← Previous</span>
                <span className="dx-pager-title">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={next.href} className="dx-pager-link dx-pager-next" rel="next">
                <span className="dx-pager-dir">Next →</span>
                <span className="dx-pager-title">{next.title}</span>
              </Link>
            )}
          </nav>
          <p className="dx-edit">
            <a href={SOURCE} target="_blank" rel="noreferrer">
              Suggest an edit on GitHub ↗
            </a>
          </p>
        </footer>
      </article>

      {toc.length > 1 && (
        <aside className="dx-toc">
          <DocToc sections={toc} />
        </aside>
      )}
    </div>
  )
}
