import { blake2b } from './blake2b.ts'
import { hex, utf8 } from './bytes.ts'

/** blake2b-256("pof-audience:" ‖ lowercase(trim(id))). Identical to pof_core::audience_hash. */
export const audienceHash = (id: string) => hex(blake2b(utf8(`pof-audience:${id.trim().toLowerCase()}`)))
