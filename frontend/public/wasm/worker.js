// The browser verifier off the main thread: pof-verify compiled to WebAssembly (pof_wasm.js, the
// wasm-bindgen web bindings beside this file) in a module worker. Loading the parameters and the
// verifying key and running a check take long enough to freeze a page, so they happen here.
// Hand-written, not generated: scripts/build-wasm.sh rewrites only pof_wasm*.
//
//   → { id }                                        ← { id, ok, version }   (loaded and warm)
//   → { id, bytes, audience, now, anchors, revoked, policy?, seen?, batch? } ← { id, ok, json, ms }
//   ← { id, ok: false, error }
import init, { verify, verifyBatch, version, warm } from './pof_wasm.js'

const ready = init().then(() => {
  warm()
  return version()
})

self.onmessage = async ({ data }) => {
  const { id } = data
  try {
    const v = await ready
    if (!data.bytes) return self.postMessage({ id, ok: true, version: v })
    const t0 = performance.now()
    const run = data.batch ? verifyBatch : verify
    const json = run(data.bytes, data.audience, BigInt(data.now), data.anchors, data.revoked, data.policy, data.seen)
    self.postMessage({ id, ok: true, json, ms: performance.now() - t0 })
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) })
  }
}
