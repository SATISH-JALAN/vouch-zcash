'use client'

import { useState, type CSSProperties } from 'react'

export interface Bar {
  label: string
  value: number
  note?: string
}

/** A horizontal bar chart for one measure: thin bars from one baseline, the value at each tip, a tooltip on
 * hover or focus, and the same numbers as a table underneath. */
export function BarChart({ title, unit, bars, decimals = 0, caption }: { title: string; unit: string; bars: Bar[]; decimals?: number; caption?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...bars.map((b) => b.value))
  // a clean axis end: the next 1, 2 or 5 step above the largest value
  const mag = 10 ** Math.floor(Math.log10(max))
  const mant = [1, 2, 5, 10].find((m) => m * mag >= max) ?? 10
  const top = mant * mag
  // clean steps: fifths of 1, 5 or 10 (0·100·…·500), quarters of 2 (0·50·…·200)
  const parts = mant === 2 ? 4 : 5
  const ticks = Array.from({ length: parts + 1 }, (_, i) => (i * top) / parts)
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const fmtTick = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: top / parts < 1 ? 1 : 0 })
  const LABEL = 230
  const W = 760
  const PLOT = W - LABEL - 70
  const ROW = 38
  const H = bars.length * ROW + 34
  const xOf = (v: number) => LABEL + (v / top) * PLOT
  // beside the bar's value when there is room on the right, otherwise over the start of the plot;
  // vertically level with the row, which keeps it inside the svg even for the last row
  const tipAt = (i: number): CSSProperties => {
    const end = xOf(bars[i]!.value) + 52
    const top = `${((10 + i * ROW - 6) / H) * 100}%`
    return end / W < 0.62 ? { top, left: `${(end / W) * 100}%` } : { top, left: `${((LABEL + 12) / W) * 100}%` }
  }

  return (
    <figure className="dg dg-chart">
      <p className="dg-chart-title">
        {title} <span>({unit})</span>
      </p>
      <div className="dg-scroll">
        {/* the tooltip is positioned in the svg's own box, so it never leaves the frame that clips it */}
        <div style={{ position: 'relative', minWidth: 560 }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, in ${unit}`} className="dg-svg" style={{ minWidth: 560 }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xOf(t)} x2={xOf(t)} y1={6} y2={H - 26} className="dg-grid" />
              <text x={xOf(t)} y={H - 8} textAnchor="middle" className="dg-axis">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const y = 10 + i * ROW
            const w = Math.max(2, xOf(b.value) - LABEL)
            const t = 20 // bar thickness, under the 24px cap
            const r = Math.min(4, w / 2)
            const d = `M${LABEL},${y} H${LABEL + w - r} Q${LABEL + w},${y} ${LABEL + w},${y + r} V${y + t - r} Q${LABEL + w},${y + t} ${LABEL + w - r},${y + t} H${LABEL} Z`
            return (
              <g
                key={b.label}
                tabIndex={0}
                role="button"
                aria-label={`${b.label}: ${fmt(b.value)} ${unit}${b.note ? `. ${b.note}` : ''}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="dg-bar-g"
              >
                {/* the hit target is the whole row, not just the bar */}
                <rect x={0} y={y - 9} width={W} height={ROW} fill="transparent" />
                <text x={LABEL - 12} y={y + 14} textAnchor="end" className="dg-axis-label">
                  {b.label}
                </text>
                <path d={d} className={hover === i ? 'dg-bar dg-bar-on' : 'dg-bar'} />
                <text x={LABEL + w + 8} y={y + 14} className="dg-bar-value">
                  {fmt(b.value)}
                </text>
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <div className="dg-tip" style={tipAt(hover)} role="status">
            <strong>
              {fmt(bars[hover]!.value)} {unit}
            </strong>
            <span>{bars[hover]!.label}</span>
            {bars[hover]!.note && <span className="dg-tip-note">{bars[hover]!.note}</span>}
          </div>
        )}
        </div>
      </div>
      {caption && <figcaption className="dg-caption">{caption}</figcaption>}
      <details className="dg-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              <th>{unit}</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{fmt(b.value)}</td>
                <td>{b.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
