import { blake2b } from './blake2b.ts'
import { hex, utf8 } from './bytes.ts'

/** blake2b-256("pof-audience:" ‖ lowercase(trim(id))). Identical to pof_core::audience_hash. */
export const audienceHash = (id: string) => hex(blake2b(utf8(`pof-audience:${id.trim().toLowerCase()}`)))

/** blake2b-256 of trim(intent), personalised "vouch-intent-v1\0". Identical to pof_core::intent_binding:
 *  what an exit certificate is bound to, and so what ties a Vouch Receipt to one order. */
export const intentBinding = (intent: string) => hex(blake2b(utf8(intent.trim()), 32, utf8('vouch-intent-v1\0')))
