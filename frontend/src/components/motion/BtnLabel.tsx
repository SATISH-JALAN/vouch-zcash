/**
 * The inside of every .btn (MOTION.md §6.2). Markup only; lib/buttons.ts gives it behaviour, and
 * globals.css decides per variant what shows:
 *  - primary (.btn-primary, .btn-on-dark): a leading dot that becomes an arrow, and a label that
 *    rolls: each character sits over a copy of itself in the hover colour, and they roll up in turn
 *  - secondary (.btn-secondary, .btn-ghost-dark): an underline drawn in from the left, retracted to the right
 *  - any button with aria-busy: the loading ring
 * Screen readers get the words once; the split characters are hidden from them.
 */
export function BtnLabel({ children }: { children: string }) {
  const chars = Array.from(children)
  return (
    <>
      <svg className="btn-icon" viewBox="0 0 14 10" width="14" height="10" aria-hidden>
        <circle className="btn-dot" cx="3" cy="5" r="2.5" fill="currentColor" />
        <path className="btn-arrow" d="M1 5h11M8.5 1.5 12 5 8.5 8.5" pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="btn-label">
        <span className="sr-only">{children}</span>
        <span className="btn-roll" aria-hidden>
          {chars.map((c, i) => {
            const ch = c === ' ' ? ' ' : c
            return (
              <span key={i} className="btn-c" data-c={ch}>
                {ch}
              </span>
            )
          })}
        </span>
      </span>
      <svg className="btn-spin" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </>
  )
}
