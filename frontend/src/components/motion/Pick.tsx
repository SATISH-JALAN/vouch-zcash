import { cx } from '@/components/ui/primitives'

/** The drawn check every choice shares (MOTION.md §6.4). Draws on when its parent is [data-on="true"]. */
export function PickCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx('pick-check overflow-visible', className)} aria-hidden>
      <path d="M3.2 8.4l3.1 3.1 6.5-7" pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A checkbox's box: ink fills it from the centre, then the check draws on in paper. */
export function PickBox({ on }: { on: boolean }) {
  return (
    <span
      data-on={on}
      className={cx('pick pick-ink mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border text-bone transition-colors duration-200', on ? 'border-ink' : 'border-border')}
      aria-hidden
    >
      <PickCheck className="h-3 w-3" />
    </span>
  )
}

/** The dropzone's marching outline, shown while a file is over it (CSS drives it from [data-dragging]). */
export function DropMarch({ radius = 12 }: { radius?: number }) {
  return (
    <svg className="drop-march" aria-hidden>
      <rect x="0.5" y="0.5" rx={radius} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="6 6" style={{ width: 'calc(100% - 1px)', height: 'calc(100% - 1px)' }} />
    </svg>
  )
}
