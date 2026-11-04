'use client'

import { useEffect } from 'react'

/**
 * The hosted attestor sleeps when idle and takes up to a minute to wake. Asking for the status on the
 * first page a visitor opens starts that wake-up early, so /demo is usually live by the time they get
 * there. Once per session, fire and forget: nothing waits on it and nothing is shown.
 */
export function WarmAttestor() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem('vouch:warm')) return
      sessionStorage.setItem('vouch:warm', '1')
    } catch {
      // storage blocked: warm on every page instead, which is harmless
    }
    void fetch('/api/status', { cache: 'no-store' }).catch(() => {})
  }, [])
  return null
}
