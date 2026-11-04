import type { ReactNode } from 'react'
import { MotionProvider } from '@/components/motion/MotionProvider'
import { Preloader } from '@/components/motion/Preloader'
import { Cursor } from '@/components/motion/Cursor'
import { RouteTransition } from '@/components/motion/RouteTransition'
import { Nav } from '@/components/site/Nav'
import { Footer } from '@/components/site/Footer'
import { WarmAttestor } from '@/components/site/WarmAttestor'

/** The marketing site's frame: motion, the nav, the footer. /docs runs without it, in its own shell. */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Preloader />
      <RouteTransition />
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer />
      <Cursor />
      <WarmAttestor />
    </MotionProvider>
  )
}
