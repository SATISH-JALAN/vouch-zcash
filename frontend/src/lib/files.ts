import { MAGIC } from './pof/codec'

/** A binary .pof starts with the magic; anything else is treated as base64url text. */
export const isPofBinary = (b: Uint8Array) => b.length >= 4 && MAGIC.every((m, i) => b[i] === m)

/** Save bytes or text as a file. The object URL lives only long enough for the click. */
export function downloadBytes(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
