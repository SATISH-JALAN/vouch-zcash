import type { Metadata, Viewport } from 'next'
import { Fraunces, Geist_Mono, Instrument_Serif } from 'next/font/google'
import localFont from 'next/font/local'
import { GeistPixelSquare } from 'geist/font/pixel'
import { HEAD_SCRIPT } from '@/components/motion/MotionProvider'
import { BRAND, DESCRIPTION, TAGLINE } from '@/lib/site'
import './globals.css'

const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' })
// the hero's display face: high-contrast, WONK on — an engraved look to match the paintings
const display = Fraunces({ subsets: ['latin'], axes: ['opsz', 'SOFT', 'WONK'], variable: '--font-fraunces', display: 'swap' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap', fallback: ['JetBrains Mono', 'ui-monospace', 'monospace'] })
// Switzer (Fontshare, ITF Free Font License), self-hosted so next/font can size-match the fallback: no CLS.
const sans = localFont({
  src: [
    { path: '../fonts/Switzer-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/Switzer-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/Switzer-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-switzer',
  display: 'swap',
  fallback: ['General Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: `${BRAND} — ${TAGLINE}`, template: `%s · ${BRAND}` },
  description: DESCRIPTION,
  openGraph: { title: `${BRAND} — ${TAGLINE}`, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: `${BRAND} — ${TAGLINE}`, description: DESCRIPTION },
}

export const viewport: Viewport = { themeColor: '#0B0D0C', colorScheme: 'light' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable} ${sans.variable} ${display.variable} ${GeistPixelSquare.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="t-data-sm sr-only z-[200] bg-ink px-4 py-3 text-bone focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        {/* the site's chrome is in (site)/layout.tsx; /docs has its own */}
        {children}
      </body>
    </html>
  )
}
