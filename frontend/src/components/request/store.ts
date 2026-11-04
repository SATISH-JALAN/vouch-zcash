'use client'

import { create } from 'zustand'
import type { ClaimKind } from '@/lib/data/types'
import { DEMO_AUDIENCE } from '@/lib/data/chain'
import { formatZec } from '@/lib/format'

export type Unit = 'ZEC' | 'zat'
export type RequestKind = 'proof' | 'exit' | 'reserves'

interface RequestState {
  claim: ClaimKind
  amount: string
  unit: Unit
  audience: string
  expiryDays: number
  /** Days the holder has to respond; 0 = no deadline. */
  respondDays: number
  bindSolana: boolean
  /** One proof of funds, an exit certificate, or a reserves batch. */
  kind: RequestKind
  /** "Unmoved since" block, as typed ('' = not required). */
  dormantSince: string
  /** Detect the same coins used twice with you this month (the request then names a period). */
  detectReuse: boolean
  set: (patch: Partial<Omit<RequestState, 'set' | 'setUnit'>>) => void
  setUnit: (u: Unit) => void
}

export const useRequest = create<RequestState>((set, get) => ({
  claim: 'HoldsAtLeast',
  amount: '500',
  unit: 'ZEC',
  audience: DEMO_AUDIENCE.id,
  expiryDays: 7,
  respondDays: 0,
  bindSolana: false,
  kind: 'proof',
  dormantSince: '',
  detectReuse: false,
  set: (patch) => set(patch),
  // switching units converts the value rather than reinterpreting it
  setUnit: (u) => {
    const { unit, amount } = get()
    if (u === unit) return
    const zat = toZatoshi(amount, unit)
    set({ unit: u, amount: zat === null ? amount : u === 'zat' ? zat.toString() : trimZec(formatZec(zat).replace(/,/g, '')) })
  },
}))

export function toZatoshi(amount: string, unit: Unit): bigint | null {
  const s = amount.trim().replace(/,/g, '')
  if (unit === 'zat') return /^\d+$/.test(s) ? BigInt(s) : null
  const m = /^(\d+)(?:\.(\d{0,8}))?$/.exec(s)
  if (!m) return null
  return BigInt(m[1]!) * 100_000_000n + BigInt((m[2] ?? '').padEnd(8, '0') || '0')
}

export const trimZec = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s) || '0'
