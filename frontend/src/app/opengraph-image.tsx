import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/site'
import { OG, OgMark } from './og-mark'

export const alt = 'Vouch — Prove what you hold. Reveal nothing else.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const font = (f: string) => readFile(join(process.cwd(), 'src/og-fonts', f))

export default async function OpengraphImage() {
  const [serif, sans, mono] = await Promise.all([font('InstrumentSerif-400.ttf'), font('Switzer-500.ttf'), font('GeistMono-400.ttf')])
  const markSize = 38
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: OG.shielded }}>
        {/* horizontal lockup, 38px mark, top-left at 64/64 */}
        <div style={{ position: 'absolute', left: 64, top: 64, display: 'flex', alignItems: 'center', gap: 19 }}>
          <OgMark size={markSize} body={OG.onDark} />
          <div style={{ fontFamily: 'Switzer', fontSize: 22, letterSpacing: '0.16em', color: OG.onDark, marginTop: 2 }}>{BRAND.toUpperCase()}</div>
        </div>

        {/* headline, first baseline ≈ 300 */}
        <div
          style={{
            position: 'absolute',
            left: 64,
            top: 214,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Instrument Serif',
            fontSize: 88,
            lineHeight: 0.98,
            letterSpacing: '-0.02em',
            color: OG.onDark,
          }}
        >
          <div>Prove what</div>
          <div>you hold.</div>
          <div style={{ display: 'flex' }}>
            <span>Reveal&nbsp;</span>
            <span style={{ color: OG.seal }}>nothing else.</span>
          </div>
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, top: 520, height: 1, background: OG.ruleDark }} />
        <div style={{ position: 'absolute', left: 64, top: 552, fontFamily: 'Geist Mono', fontSize: 19, letterSpacing: '0.04em', color: OG.onDark2 }}>
          CRYPTO WORLD&apos;S FAIR 2026 · ZCASH · SHIELDED PROOF OF FUNDS
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Instrument Serif', data: serif, weight: 400, style: 'normal' },
        { name: 'Switzer', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist Mono', data: mono, weight: 400, style: 'normal' },
      ],
    },
  )
}
