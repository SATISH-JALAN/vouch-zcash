import { ImageResponse } from 'next/og'
import { OG, OgMark } from './og-mark'

// 180px: the mark in bone on a shielded square, 24px padding.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: OG.shielded }}>
        <OgMark size={180 - 48} body={OG.bone} />
      </div>
    ),
    size,
  )
}
