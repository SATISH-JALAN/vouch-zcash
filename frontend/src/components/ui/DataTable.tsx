import type { ReactNode } from 'react'
import { cx } from './primitives'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

/** No radius, no zebra. 1px bottom rule per row, 40px rows, mono 13px. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  className,
  rowClassName,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (r: T) => string
  caption?: string
  className?: string
  rowClassName?: (r: T) => string | undefined
}) {
  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="t-data w-full border-collapse text-left">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('t-eyebrow h-10 pr-6 align-middle font-medium text-ink-3', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={cx('group border-b border-border transition-colors duration-200 hover:bg-bone-2', rowClassName?.(r))}>
              {columns.map((c) => (
                <td key={c.key} className={cx('min-h-10 py-[10px] pr-6 align-top', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
