# Vouch — site

Next.js 15 (App Router) · React 19 · Tailwind v4 · GSAP + Lenis · zustand. pnpm only, Node 22.18+ (the scripts run `.ts` files directly).

```bash
pnpm install
pnpm dev              # http://localhost:3000
pnpm build
pnpm typecheck
pnpm test:fixtures    # TypeScript codec ≡ Rust encoder on every committed proof, plus request links
pnpm test:wasm        # the WASM verifier in public/wasm ≡ native verdicts
pnpm e2e              # the full path through this site's API (needs the stack: ../scripts/dev-stack.sh)
```

## Pages

| Route | What it does |
| --- | --- |
| `/` | The story and the mechanism. |
| `/verify` | Drop a `.pof` file and it verifies in the browser (WASM), against the anchor table and revocation list. Nothing is uploaded. |
| `/request` | Build a proof request link: claim, threshold, audience, expiry, and optional Solana binding. |
| `/prove` | Answer a request: the CLI command for your own wallet, or the demo holder. It keeps a local history and lets you revoke. |
| `/demo` | Proof → attestation → `pof-gate` receipt → `pof-credit` line on Solana, then a draw on it, with the breakers (replay, another wallet, a tampered proof). |
| `/docs` | Format, integration, proving, trust model, attestor protocol, FAQ. |

## What runs where

- **In the browser:** `pof-verify` compiled to WASM (`public/wasm`, built by `../scripts/build-wasm.sh`), run in a module worker (`public/wasm/worker.js`, hand-written) so it never blocks the page. Warm-up takes about 0.3 s, and a verification about 100 ms. The result's JSON Schema is `public/schema/pof-v1.json`. The TypeScript codec in `src/lib/pof` only parses the file, for display. Verdicts always come from the WASM.
- **API routes** (`src/app/api`):
  - `anchors`: the trusted anchor table (`src/data/anchors.json`).
  - `revocations`: the public revocation list (GET; POST `{secret}` to revoke).
  - `attest`, `demo-prove`: proxies to `pof-attest`.
  - `relay`: builds and pays for the demo's Solana transactions (submit, open a line, draw).
  - `status`: which of these are configured.
  - `stats`: the verification counter.
- **Labels, never guesses:** `/api/status` decides whether a surface says LIVE or SIMULATED. Without an attestor or Solana configured, `/demo` runs a simulation and labels it as one.

Configuration is in [.env.example](.env.example). Every variable is optional.

## Data that comes from the Rust side

`../scripts/sync-fixtures.sh` copies `../fixtures/proofs/*.pof` → `public/proofs`, merges the anchor tables → `src/data/anchors.json`, and copies the demo revocation list. It deletes `public/proofs/*.pof` first, so a vector dropped from `fixtures/` leaves the site too, and CI fails if the committed copies drift from `fixtures/`. The IDLs in `src/data/idl` come from `backend/solana/target/idl`. Rebuild the WASM (`../scripts/build-wasm.sh`) and commit `public/wasm` whenever `backend/crates` changes: Vercel serves the committed build, and CI runs `pnpm test:wasm` against it.

## Before submission

- `src/lib/site.ts`: set `LINKS.forum`. Links that are `null` are not rendered.
- Set `NEXT_PUBLIC_SITE_URL` on Vercel so the OG image resolves to an absolute URL.

## Type and visuals

Fonts: Instrument Serif, Fraunces and Geist Mono via `next/font/google`, and Geist Pixel (Square) from the `geist` package. Switzer (Fontshare, ITF FFL) is self-hosted in `src/fonts`, so the fallback is size-matched (no CLS). `src/og-fonts` holds TTFs for the OG renderer.

`public/visuals/` holds the web-ready paintings and hero loops (WebP, MP4/WebM without audio). `visuals-src/` holds the original exports and is not served.

- The oval plates (`step-*.webp`, `not-found.webp`) have their paper recoloured to exactly `#F3F1EA` and are served `unoptimized`. Next's re-encode would shift that colour and show a box around them. If you replace one, re-run the same colour match.
- The hero video is added client-side only when motion is allowed and data saver is off, and it pauses off-screen. The painting underneath is the LCP.
