'use client'

import { CopyButton } from '@/components/motion/CopyButton'

export function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="t-eyebrow text-ink-3">{label}</span>
        <CopyButton value={value} label="Copy" className="t-data-sm inline-flex items-center gap-2 uppercase tracking-[0.12em] text-ink-2 hover:text-ink" />
      </div>
      <pre className="t-data-sm overflow-x-auto whitespace-pre-wrap break-all rounded-chip border border-border bg-bone-2 p-4 text-ink" data-lenis-prevent="">
        {value}
      </pre>
    </div>
  )
}
