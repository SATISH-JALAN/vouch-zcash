'use client'

import { useEffect, useState } from 'react'

/** "On this page": the section in view is marked as you scroll. */
export function DocToc({ sections }: { sections: { id: string; title: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id)

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id)
      },
      { rootMargin: '-72px 0px -70% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [sections])

  return (
    <nav aria-label="On this page" className="dx-toc-inner">
      <p className="dx-toc-title">On this page</p>
      <ul>
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? 'location' : undefined}
              onClick={(e) => {
                const el = document.getElementById(s.id)
                if (!el) return
                e.preventDefault()
                const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
                el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
                history.replaceState(null, '', `#${s.id}`)
                setActive(s.id)
              }}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
