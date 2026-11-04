// Sequence diagrams: actors across the top, messages down the page, laid out from data.
import type { ReactNode } from 'react'
import { Diagram, type Tone } from './kit'

export interface Actor {
  id: string
  label: string
  sub?: string
  tone?: Tone
}

export type Step =
  | { from: string; to: string; label: string; detail?: string; dashed?: boolean; tone?: 'bad' | 'good' | 'accent' }
  | { note: string; over: string | [string, string]; tone?: Tone }

const COL = 168
const HEAD = 56
const ROW = 46
const NOTE = 40

export function Sequence({ title, caption, actors, steps }: { title: string; caption?: ReactNode; actors: Actor[]; steps: Step[] }) {
  const width = Math.max(640, actors.length * COL + 24)
  const gap = (width - 24) / actors.length
  const x = (id: string) => {
    const i = actors.findIndex((a) => a.id === id)
    if (i < 0) throw new Error(`sequence: unknown actor ${id}`)
    return 12 + gap * i + gap / 2
  }
  let y = HEAD + 30
  const rows = steps.map((s) => {
    const top = y
    const isSelf = 'from' in s && s.from === s.to
    y += 'note' in s ? NOTE + 8 : isSelf ? ROW + 14 : ROW
    return { s, top }
  })
  const height = y + 10

  return (
    <Diagram title={title} caption={caption} width={width} height={height} minWidth={Math.min(width, 600)}>
      {actors.map((a) => (
        <g key={a.id}>
          <line x1={x(a.id)} y1={HEAD} x2={x(a.id)} y2={height - 6} className="dg-lifeline" />
          <g className={`dg-node dg-${a.tone ?? 'plain'}`}>
            <rect x={x(a.id) - gap / 2 + 10} y={6} width={gap - 20} height={HEAD - 10} rx={10} />
            <text x={x(a.id)} y={a.sub ? 27 : 34} textAnchor="middle" className="dg-title">
              {a.label}
            </text>
            {a.sub && (
              <text x={x(a.id)} y={43} textAnchor="middle" className="dg-sub">
                {a.sub}
              </text>
            )}
          </g>
        </g>
      ))}
      {rows.map(({ s, top }, i) => {
        if ('note' in s) {
          const [a, b] = Array.isArray(s.over) ? s.over : [s.over, s.over]
          // as wide as the columns it covers, or its text, whichever is wider; never off the canvas
          const mid = (x(a) + x(b)) / 2
          const half = Math.max((Math.max(x(a), x(b)) - Math.min(x(a), x(b)) + gap) / 2 - 18, (s.note.length * 6.2) / 2 + 18)
          const x1 = Math.max(8, Math.min(mid - half, width - 8 - 2 * half))
          const x2 = x1 + 2 * half
          return (
            <g key={i} className={`dg-node dg-${s.tone ?? 'muted'}`}>
              <rect x={x1} y={top} width={x2 - x1} height={NOTE} rx={8} />
              <text x={(x1 + x2) / 2} y={top + NOTE / 2 + 4} textAnchor="middle" className="dg-sub">
                {s.note}
              </text>
            </g>
          )
        }
        const x1 = x(s.from)
        const x2 = x(s.to)
        const cls = `dg-edge${s.tone ? ` dg-edge-${s.tone}` : ''}`
        if (x1 === x2) {
          const yy = top + 14
          // on the last lifeline the loop and its label go to the left, where there is room
          const k = s.from === actors.at(-1)!.id ? -1 : 1
          const anchor = k > 0 ? 'start' : 'end'
          return (
            <g key={i} className={cls}>
              <path d={`M${x1},${yy} H${x1 + k * 34} V${yy + 22} H${x1 + k * 4}`} className={s.dashed ? 'dg-dashed' : undefined} />
              <polygon points={`${x1 + k * 2},${yy + 22} ${x1 + k * 9},${yy + 18.5} ${x1 + k * 9},${yy + 25.5}`} />
              <text x={x1 + k * 42} y={yy + 9} textAnchor={anchor} className="dg-elabel">
                {s.label}
              </text>
              {s.detail && (
                <text x={x1 + k * 42} y={yy + 24} textAnchor={anchor} className="dg-sub">
                  {s.detail}
                </text>
              )}
            </g>
          )
        }
        const dir = x2 > x1 ? 1 : -1
        const yy = top + 26
        return (
          <g key={i} className={cls}>
            <path d={`M${x1},${yy} H${x2 - dir * 2}`} className={s.dashed ? 'dg-dashed' : undefined} />
            <polygon points={`${x2},${yy} ${x2 - dir * 8},${yy - 4} ${x2 - dir * 8},${yy + 4}`} />
            <text x={(x1 + x2) / 2} y={yy - 8} textAnchor="middle" className="dg-elabel">
              {s.label}
            </text>
            {s.detail && (
              <text x={(x1 + x2) / 2} y={yy + 15} textAnchor="middle" className="dg-sub">
                {s.detail}
              </text>
            )}
          </g>
        )
      })}
    </Diagram>
  )
}
