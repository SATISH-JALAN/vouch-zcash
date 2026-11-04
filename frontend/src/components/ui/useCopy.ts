'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Clipboard copy that reports `copied` only when the write succeeded. `key` tells several buttons apart. */
export function useCopy(ms = 600) {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback(
    async (value: string, key = 'value') => {
      try {
        await navigator.clipboard.writeText(value)
      } catch {
        // clipboard denied: the value is still on screen to select
        return
      }
      setCopied(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), ms)
    },
    [ms],
  )
  return { copied, copy }
}
