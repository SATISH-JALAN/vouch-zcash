import { existsSync } from 'node:fs'
import path from 'node:path'
import { Ticker } from '@/components/motion/Ticker'
import { Hero } from '@/components/landing/Hero'
import { Problem } from '@/components/landing/Problem'
import { SideBySide } from '@/components/landing/SideBySide'
import { Mechanism } from '@/components/landing/Mechanism'
import { Unlocks } from '@/components/landing/Unlocks'
import { Stack } from '@/components/landing/Stack'
import { Closing } from '@/components/landing/Closing'
import { Traveler } from '@/components/motion/Traveler'

// Slots for paintings that may not be delivered yet: render only what is on disk.
const hasLenderDesk = existsSync(path.join(process.cwd(), 'public/visuals/lender-desk.webp'))

export default function Landing() {
  return (
    <>
      <Ticker />
      <Hero />
      {/* the document begins: a hard edge, no gradient, no fade */}
      <Problem />
      <SideBySide hasImage={hasLenderDesk} />
      <Mechanism />
      <Unlocks />
      <Stack />
      <Closing />
      {/* one seal, carried from the hero's painting to the closing one */}
      <Traveler />
    </>
  )
}
