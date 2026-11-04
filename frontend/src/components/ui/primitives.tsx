import type { CSSProperties, ReactNode } from 'react'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

/** Full-bleed 1px rule, edge of viewport to edge of viewport. Optional eyebrow sitting on it. */
export function Rule({ label, dark = false, className }: { label?: string; dark?: boolean; className?: string }) {
  return (
    <div className={cx('relative w-full', className)} role="presentation">
      <div data-rule="" className={cx('h-px w-full', dark ? 'bg-rule-dark' : 'bg-rule')} />
      {label && (
        <div className="wrap pointer-events-none absolute inset-x-0 top-0 -translate-y-1/2">
          <span className={cx('t-eyebrow -ml-4 inline-block px-4', dark ? 'bg-shielded text-on-dark-2' : 'bg-bone text-ink-3')}>{label}</span>
        </div>
      )}
    </div>
  )
}

export function Eyebrow({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <p className={cx('t-eyebrow', dark ? 'text-on-dark-2' : 'text-ink-3', className)}>
      {children}
    </p>
  )
}

/** The phrase a headline turns on: italic serif. */
export function Accent({ children }: { children: string }) {
  return <em className="accent">{children}</em>
}

export type ChipStatus = 'valid' | 'invalid' | 'expired' | 'neutral' | 'on-dark'

const CHIP: Record<ChipStatus, string> = {
  valid: 'bg-valid-bg text-valid',
  invalid: 'bg-invalid-bg text-invalid',
  expired: 'bg-expired-bg text-expired',
  neutral: 'bg-bone-2 text-ink-2',
  'on-dark': 'bg-shielded-2 text-on-dark-2',
}

/** Status only — never a control. */
export function Chip({ status = 'neutral', children }: { status?: ChipStatus; children: ReactNode }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 rounded-chip px-2 font-mono text-[11px] uppercase leading-none tracking-[0.06em]', CHIP[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  )
}

export function Panel({
  label,
  chip,
  children,
  className,
  bodyClassName,
  style,
  ...rest
}: {
  label?: ReactNode
  chip?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  style?: CSSProperties
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div className={cx('overflow-hidden rounded-panel border border-border bg-bone', className)} style={style} {...rest}>
      {(label || chip) && (
        <div className="flex h-[42px] items-center justify-between gap-4 border-b border-border px-5">
          <span className="t-data-sm uppercase tracking-[0.12em] text-ink-2">{label}</span>
          {chip}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

/** A bordered bone-2 strip wherever a trust boundary applies. Honest by construction. */
export function TrustNote({ label = 'TRUST', children, className, tone = 'neutral' }: { label?: string; children: ReactNode; className?: string; tone?: 'neutral' | 'strong' }) {
  return (
    <div
      className={cx(
        't-data-sm flex flex-col gap-2 rounded-chip border bg-bone-2 px-4 py-3 text-ink-2 sm:flex-row sm:gap-4',
        tone === 'strong' ? 'border-ink' : 'border-border',
        className,
      )}
      role="note"
    >
      <span className="shrink-0 font-medium tracking-[0.16em] text-ink">{label}</span>
      <span className="max-w-[92ch] leading-[1.6]">{children}</span>
    </div>
  )
}

/** Triptych — one container, internal 1px dividers. Never three cards with gaps. */
export function Triptych({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-1 divide-y divide-border overflow-hidden rounded-panel border border-border lg:grid-cols-3 lg:divide-x lg:divide-y-0', className)}>
      {children}
    </div>
  )
}

export function TriptychCell({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div className={cx('px-6 pb-12 pt-9 transition-[background-color,box-shadow] duration-200 hover:bg-bone-2 hover:shadow-lift lg:px-10 lg:pb-14 lg:pt-11', className)} {...rest}>
      {children}
    </div>
  )
}

/** Section anatomy: eyebrow → 44px → display headline. */
export function SectionHead({
  eyebrow,
  title,
  titleClass = 't-display-l',
  children,
  titleRef,
  lineReveal,
  className,
}: {
  eyebrow: string
  title: ReactNode
  titleClass?: string
  children?: ReactNode
  titleRef?: React.Ref<HTMLHeadingElement>
  lineReveal?: boolean
  className?: string
}) {
  return (
    <div className={cx('section-head', className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 ref={titleRef} className={cx(titleClass, 'max-w-[18ch]')} data-line-reveal={lineReveal || undefined}>
        {title}
      </h2>
      {children}
    </div>
  )
}
