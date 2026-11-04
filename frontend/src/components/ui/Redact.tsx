import type { CSSProperties, ReactNode } from 'react'
import { cx } from './primitives'

/**
 * The signature component. A solid bar over text.
 *  - `reveal`: the bar can collapse (from the right) when a parent tweens its [data-reveal] bar.
 *    Without JS or under reduced motion it renders already open.
 *  - no `reveal`: permanent. It never receives a tween. It is not disabled; it is final.
 *
 * Permanent bars carry no real text underneath — only an accessible label for what is withheld.
 */
export function Redact({
  children,
  reveal = false,
  tone = 'ink',
  width,
  label,
  className,
  style,
}: {
  children?: ReactNode
  reveal?: boolean
  tone?: 'ink' | 'on-dark'
  /** Width in ch for a permanent bar with no children. */
  width?: number
  /** Accessible description of what is withheld. */
  label?: string
  className?: string
  style?: CSSProperties
}) {
  const barStyle = { '--redact': tone === 'on-dark' ? 'var(--color-on-dark)' : 'var(--color-ink)' } as CSSProperties

  if (!reveal) {
    return (
      <span className={cx('redact align-middle', className)} style={{ width: width ? `${width}ch` : undefined, ...style }}>
        <span className="invisible" aria-hidden>
          {children ?? ' '}
        </span>
        <span className="redact-bar" style={barStyle} aria-hidden />
        <span className="sr-only">{label ?? 'withheld'}</span>
      </span>
    )
  }

  return (
    <span className={cx('redact', className)} style={style}>
      {children}
      <span className="redact-bar" data-reveal="" style={barStyle} aria-hidden />
    </span>
  )
}
