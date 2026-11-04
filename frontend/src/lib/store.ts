'use client'

import { create } from 'zustand'

interface IntroState {
  /** True once the preloader has started its exit (or was skipped / never shown). */
  introDone: boolean
  setIntroDone: () => void
}

export const useIntro = create<IntroState>((set) => ({
  introDone: false,
  setIntroDone: () => set({ introDone: true }),
}))

interface LoopState {
  /** The visitor paused the landing's looping motion (the ticker and the hero film): WCAG 2.2.2. */
  loopsPaused: boolean
  toggleLoops: () => void
}

export const useLoops = create<LoopState>((set) => ({
  loopsPaused: false,
  toggleLoops: () => set((s) => ({ loopsPaused: !s.loopsPaused })),
}))
