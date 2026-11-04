// Byte layouts: a message or file as a strip of fields, each as wide as its size (with a floor, so a
// one-byte field still has room for its name), wrapped onto rows.
import type { ReactNode } from 'react'
import { Diagram, type Tone } from './kit'

export interface Field {
  label: string
  /** a size in bytes, or a word like "variable" */
  size: number | string
  sub?: string
  tone?: Tone
}

const W = 760
const H = 64
const ROWGAP = 36

export function Bytes({ title, caption, fields, total }: { title: string; caption?: ReactNode; fields: Field[]; total?: string }) {
  const scale = 4.2
  const floor = 70
  // wide enough for its own words, then proportional to its size
  const text = (f: Field) => Math.max(f.label.length * 7.6, (f.sub ?? '').length * 6.4) + 18
  const widths = fields.map((f) => Math.max(floor, text(f), typeof f.size === 'number' ? f.size * scale : f.size === '' ? 0 : 170))
  // wrap greedily into rows of at most W
  const rows: { f: Field; w: number }[][] = [[]]
  let used = 0
  fields.forEach((f, i) => {
    const w = widths[i]!
    if (used + w > W && rows.at(-1)!.length) {
      rows.push([])
      used = 0
    }
    rows.at(-1)!.push({ f, w })
    used += w
  })
  // stretch each row to the full width, so the strip reads as one block
  const laid = rows.map((r) => {
    const sum = r.reduce((a, c) => a + c.w, 0)
    const k = r === rows.at(-1) && sum < W * 0.6 ? 1 : W / sum
    let x = 0
    return r.map((c) => {
      const cell = { ...c, x, w: c.w * k }
      x += cell.w
      return cell
    })
  })
  const height = rows.length * (H + ROWGAP) + (total ? 24 : 4)

  return (
    <Diagram title={title} caption={caption} width={W + 20} height={height} minWidth={620}>
      {laid.map((r, ri) =>
        r.map(({ f, x, w }, ci) => {
          const y = 10 + ri * (H + ROWGAP)
          return (
            <g key={`${ri}-${ci}`} className={`dg-node dg-${f.tone ?? 'plain'}`}>
              <rect x={10 + x + 1} y={y} width={w - 2} height={H} rx={6} />
              <text x={10 + x + w / 2} y={y + (f.sub ? 26 : 37)} textAnchor="middle" className="dg-title dg-mono">
                {f.label}
              </text>
              {f.sub && (
                <text x={10 + x + w / 2} y={y + 44} textAnchor="middle" className="dg-sub">
                  {f.sub}
                </text>
              )}
              <text x={10 + x + w / 2} y={y + H + 17} textAnchor="middle" className="dg-sub dg-mono">
                {typeof f.size === 'number' ? `${f.size} B` : f.size}
              </text>
            </g>
          )
        }),
      )}
      {total && (
        <text x={W + 10} y={height - 6} textAnchor="end" className="dg-label">
          {total}
        </text>
      )}
    </Diagram>
  )
}
