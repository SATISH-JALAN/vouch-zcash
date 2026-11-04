'use client'

import { RESIZE } from './motion'

/**
 * Calls `rebuild` after a meaningful resize only (MOTION.md §8): a width change over RESIZE.dx or a
 * height change over RESIZE.dy. A phone's address bar showing and hiding is not one.
 * The page's own width counts too: a classic scrollbar arriving (as the intro releases the scroll
 * lock) narrows the page by ~15px without resizing the window, and layouts measured before it would
 * be off by half of that. Returns the cleanup.
 */
export function onMeaningfulResize(rebuild: () => void, delay = 200): () => void {
  const page = document.documentElement
  let w = window.innerWidth
  let h = window.innerHeight
  let cw = page.clientWidth
  let timer: ReturnType<typeof setTimeout> | undefined
  const onResize = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const wide = Math.abs(window.innerWidth - w) >= RESIZE.dx || Math.abs(page.clientWidth - cw) >= 1
      if (!wide && Math.abs(window.innerHeight - h) < RESIZE.dy) return
      w = window.innerWidth
      h = window.innerHeight
      cw = page.clientWidth
      rebuild()
    }, delay)
  }
  window.addEventListener('resize', onResize)
  // the page's width can change with no window resize at all
  let last = cw
  const ro = new ResizeObserver(() => {
    if (page.clientWidth !== last) {
      last = page.clientWidth
      onResize()
    }
  })
  ro.observe(page)
  return () => {
    clearTimeout(timer)
    ro.disconnect()
    window.removeEventListener('resize', onResize)
  }
}
