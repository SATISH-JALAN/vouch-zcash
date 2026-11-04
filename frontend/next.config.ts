import type { NextConfig } from 'next'

// No script-src: Next's inline bootstrap scripts, GSAP and the WASM loader must keep running.
const CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` gets its own output folder, so running `next build` alongside it can't
  // overwrite the dev server's manifests.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: CSP },
        ],
      },
    ]
  },
}

export default nextConfig
