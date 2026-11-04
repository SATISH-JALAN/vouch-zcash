import { LINKS } from '../site'
import anchors from '../../data/anchors.json'

export const REPO = LINKS.repo ?? 'https://github.com/SATISH-JALAN/Vouch'
export const SITE = 'https://vouch-zcash.vercel.app'
export const ATTESTOR = 'https://vouch-attest.onrender.com'

export type AnchorRecord = { network: string; height: number; ncHeight?: number; blockHash?: string; ncRoot: string; nfRoot: string }
export const ANCHORS = anchors as AnchorRecord[]
export const mainnet = ANCHORS.filter((a) => a.network === 'mainnet').sort((a, b) => b.height - a.height)[0]
export const MAINNET_H = mainnet?.height ?? 3493000
