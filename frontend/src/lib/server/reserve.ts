// pof-reserve: instruction builders (from the IDL discriminators, Borsh layout) and the feed
// reader. Server-only, like ./solana.ts; also imported by scripts/reserve-setup.ts.

import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import reserveIdl from '../../data/idl/pof_reserve.json' with { type: 'json' }
import { pda } from './solana.ts'

const disc = (name: string) => Buffer.from(reserveIdl.instructions.find((i) => i.name === name)!.discriminator)

export const RESERVE_ID = new PublicKey(process.env.POF_RESERVE_ID ?? reserveIdl.address)
/** The verifier identifier the demo reserves are proven to, and so the demo feed's audience. */
export const RESERVES_AUDIENCE = 'reserves:wzec-demo'

const u8 = (n: number) => Buffer.from([n])
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: bigint | number) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}

const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
export const reserveConfigPda = () => pda([Buffer.from('config')], RESERVE_ID)
export const feedPda = (audience: Uint8Array) => pda([Buffer.from('feed'), audience], RESERVE_ID)
export const feedMintPda = (feed: PublicKey) => pda([Buffer.from('mint'), feed.toBuffer()], RESERVE_ID)
const programDataPda = () => pda([RESERVE_ID.toBuffer()], UPGRADEABLE_LOADER)

/** `admin` must be pof-reserve's upgrade authority (the deployer). */
export function reserveInitializeIx(admin: PublicKey, attestors: PublicKey[], threshold: number, maxAgeSlots: number) {
  return new TransactionInstruction({
    programId: RESERVE_ID,
    keys: [
      { pubkey: reserveConfigPda(), isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: RESERVE_ID, isSigner: false, isWritable: false },
      { pubkey: programDataPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('initialize'), u32(attestors.length), ...attestors.map((a) => a.toBuffer()), u8(threshold), u64(maxAgeSlots)]),
  })
}

export function initFeedIx(admin: PublicKey, audience: Uint8Array, heartbeatSlots: number, issuer: PublicKey) {
  const feed = feedPda(audience)
  return new TransactionInstruction({
    programId: RESERVE_ID,
    keys: [
      { pubkey: reserveConfigPda(), isSigner: false, isWritable: false },
      { pubkey: feed, isSigner: false, isWritable: true },
      { pubkey: feedMintPda(feed), isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('init_feed'), Buffer.from(audience), u64(heartbeatSlots), issuer.toBuffer()]),
  })
}

export function publishIx(audience: Uint8Array, message: Uint8Array) {
  return new TransactionInstruction({
    programId: RESERVE_ID,
    keys: [
      { pubkey: reserveConfigPda(), isSigner: false, isWritable: false },
      { pubkey: feedPda(audience), isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('publish'), u32(message.length), Buffer.from(message)]),
  })
}

export function secureMintIx(audience: Uint8Array, to: PublicKey, issuer: PublicKey, amount: bigint) {
  const feed = feedPda(audience)
  return new TransactionInstruction({
    programId: RESERVE_ID,
    keys: [
      { pubkey: feed, isSigner: false, isWritable: false },
      { pubkey: feedMintPda(feed), isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: issuer, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('secure_mint'), u64(amount)]),
  })
}

export interface FeedAccount {
  audience: string
  issuer: string
  mint: string
  heartbeatSlots: number
  scope: string
  totalZatoshi: string
  members: number
  anchorHeight: number
  ncHeight: number
  expiresAt: number
  updatedSlot: number
  publishes: number
}

/** Borsh layout after the 8-byte discriminator, in the order of `Feed`'s fields. */
export function decodeFeed(data: Buffer): FeedAccount {
  let o = 8
  const take = (n: number) => {
    const b = data.subarray(o, o + n)
    o += n
    return b
  }
  const audience = take(32).toString('hex')
  const issuer = new PublicKey(take(32)).toBase58()
  const mint = new PublicKey(take(32)).toBase58()
  const heartbeatSlots = Number(take(8).readBigUInt64LE())
  const scope = take(32).toString('hex')
  const totalZatoshi = take(8).readBigUInt64LE().toString()
  const members = take(2).readUInt16LE()
  const anchorHeight = take(4).readUInt32LE()
  const ncHeight = take(4).readUInt32LE()
  const expiresAt = Number(take(8).readBigInt64LE())
  const updatedSlot = Number(take(8).readBigUInt64LE())
  const publishes = take(4).readUInt32LE()
  return { audience, issuer, mint, heartbeatSlots, scope, totalZatoshi, members, anchorHeight, ncHeight, expiresAt, updatedSlot, publishes }
}
