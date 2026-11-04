// The mark as plain SVG for next/og (Satori): no classes, no CSS variables.

import { RING } from '@/components/brand/Mark'

export function OgMark({ size, body, line, state = 'sealed' }: { size: number; body: string; line?: string; state?: 'sealed' | 'disclosed' }) {
  const open = state === 'disclosed'
  const sw = size < 24 ? 1.7 : size > 160 ? 1.2 : 1.35
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d={RING} stroke={body} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      {open && <rect x="12" y="15.1" width="8" height="1.8" rx="0.3" fill="none" stroke={line ?? body} strokeWidth={0.7} />}
    </svg>
  )
}

export const OG = {
  shielded: '#0B0D0C',
  onDark: '#EDEAE1',
  onDark2: '#7E847E',
  ruleDark: '#222622',
  seal: '#C8452F',
  bone: '#F3F1EA',
}
