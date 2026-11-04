// A small SVG diagram kit for the docs. Server components; every colour is a CSS variable from
// docs.css, so each diagram follows the light and dark themes with no second drawing.
import type { ReactNode } from 'react'

export type Tone = 'plain' | 'accent' | 'zcash' | 'solana' | 'muted' | 'good' | 'bad' | 'service'

/** A figure: an SVG drawn on a fixed grid that scales to the column, with a caption. On a phone it keeps a
 * readable minimum width and scrolls sideways inside its frame, never the page. */
export function Diagram({
  title,
  caption,
  width,
  height,
  minWidth = 560,
  children,
}: {
  title: string
  caption?: ReactNode
  width: number
  height: number
  minWidth?: number
  children: ReactNode
}) {
  return (
    <figure className="dg">
      <div className="dg-scroll" tabIndex={0} role="group" aria-label={`${title} (diagram; scrolls sideways on small screens)`}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ minWidth: Math.min(minWidth, width) }} className="dg-svg">
          <title>{title}</title>
          {children}
        </svg>
      </div>
      {caption && <figcaption className="dg-caption">{caption}</figcaption>}
    </figure>
  )
}

/** A box with a title and up to three sub-lines, centred. */
export function Node({
  x,
  y,
  w,
  h,
  title,
  sub,
  tone = 'plain',
  mono,
  r = 10,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  sub?: string | string[]
  tone?: Tone
  mono?: boolean
  r?: number
}) {
  const lines = sub === undefined ? [] : Array.isArray(sub) ? sub : [sub]
  const total = 16 + lines.length * 15
  const top = y + h / 2 - total / 2 + 12
  return (
    <g className={`dg-node dg-${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx={r} />
      <text x={x + w / 2} y={top} textAnchor="middle" className={mono ? 'dg-title dg-mono' : 'dg-title'}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={x + w / 2} y={top + 17 + i * 15} textAnchor="middle" className="dg-sub">
          {l}
        </text>
      ))}
    </g>
  )
}

/** A decision diamond with a short question. */
export function Decision({ cx, cy, w, h, title, sub }: { cx: number; cy: number; w: number; h: number; title: string; sub?: string }) {
  return (
    <g className="dg-node dg-decision">
      <polygon points={`${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`} />
      <text x={cx} y={sub ? cy - 2 : cy + 4} textAnchor="middle" className="dg-title">
        {title}
      </text>
      {sub && (
        <text x={cx} y={cy + 13} textAnchor="middle" className="dg-sub">
          {sub}
        </text>
      )}
    </g>
  )
}

/** A dashed boundary around a group, labelled at its top left. */
export function Zone({ x, y, w, h, label, tone = 'plain' }: { x: number; y: number; w: number; h: number; label: string; tone?: Tone }) {
  return (
    <g className={`dg-zone dg-${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx={14} />
      <text x={x + 14} y={y + 20} className="dg-zone-label">
        {label}
      </text>
    </g>
  )
}

type Pt = [number, number]

function head([x1, y1]: Pt, [x2, y2]: Pt, size = 7) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const p = (da: number): Pt => [x2 - size * Math.cos(a - da), y2 - size * Math.sin(a - da)]
  const [l, r] = [p(0.45), p(-0.45)]
  return `${x2},${y2} ${l[0]},${l[1]} ${r[0]},${r[1]}`
}

/** An arrow along a polyline. The head is drawn from the last segment, so no SVG markers (and no ids) are needed. */
export function Edge({
  points,
  label,
  at,
  dashed,
  both,
  tone,
  anchor = 'middle',
}: {
  points: Pt[]
  label?: string
  /** where the label sits; default: the middle of the longest segment, a little above it */
  at?: Pt
  dashed?: boolean
  both?: boolean
  tone?: 'accent' | 'bad' | 'good'
  anchor?: 'start' | 'middle' | 'end'
}) {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')
  let pos = at
  if (label && !pos) {
    let best = 0
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1]!, points[i]!]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len > best) {
        best = len
        pos = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 7]
      }
    }
  }
  const n = points.length
  return (
    <g className={`dg-edge${tone ? ` dg-edge-${tone}` : ''}`}>
      <path d={d} className={dashed ? 'dg-dashed' : undefined} />
      <polygon points={head(points[n - 2]!, points[n - 1]!)} />
      {both && <polygon points={head(points[1]!, points[0]!)} />}
      {label && pos && (
        <text x={pos[0]} y={pos[1]} textAnchor={anchor} className="dg-elabel">
          {label}
        </text>
      )}
    </g>
  )
}

/** Free text on a diagram. */
export function Txt({ x, y, children, anchor = 'start', kind = 'sub' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; kind?: 'sub' | 'title' | 'mono' | 'label' }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={`dg-${kind}`}>
      {children}
    </text>
  )
}

/** A numbered circle, for "step 1, 2, 3" callouts on a diagram. */
export function Badge({ x, y, n }: { x: number; y: number; n: number | string }) {
  return (
    <g className="dg-badge">
      <circle cx={x} cy={y} r={10} />
      <text x={x} y={y + 4} textAnchor="middle">
        {n}
      </text>
    </g>
  )
}
