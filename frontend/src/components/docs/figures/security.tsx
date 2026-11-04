import { Diagram, Edge, Node, Zone } from '../diagrams/kit'

/** Who is trusted for what. */
export function TrustBoundaries() {
  return (
    <Diagram
      title="Trust boundaries"
      width={900}
      height={400}
      minWidth={740}
      caption="Everything a verifier relies on is public and re-derivable, except the attestor, which is trusted only by chains that cannot read Zcash. Programs trust their allowlist and threshold, nothing else."
    >
      <Zone x={20} y={20} w={420} h={170} label="Holder's device · keys and proving" tone="accent" />
      <Node x={40} y={60} w={180} h={100} title="Seed and keys" sub={['never leave the process', 'a viewing key alone', 'cannot make a proof']} tone="accent" />
      <Node x={240} y={60} w={180} h={100} title="pof-prove" sub={['links no network client', 'nothing is broadcast']} tone="accent" mono />

      <Zone x={460} y={20} w={420} h={170} label="Public · anyone can re-derive" />
      <Node x={480} y={58} w={185} h={56} title="Zcash chain" sub="the truth" tone="zcash" />
      <Node x={675} y={58} w={185} h={56} title="Anchor table" sub="re-derive with pof-anchor" />
      <Node x={480} y={122} w={185} h={56} title="pof-verify" sub="open source, three hosts" mono />
      <Node x={675} y={122} w={185} h={56} title="Revocation list" sub="a hash lock: cannot forge" />

      <Zone x={20} y={210} w={420} h={170} label="Trusted for Solana only" tone="service" />
      <Node x={40} y={250} w={120} h={100} title="Attestor 1" sub={['runs pof-verify', 'signs Ed25519']} tone="service" />
      <Node x={180} y={250} w={120} h={100} title="Attestor 2" sub={['anyone can', 'run one']} tone="service" />
      <Node x={320} y={250} w={100} h={100} title="… k of n" sub={['a config', 'change']} tone="service" />

      <Zone x={460} y={210} w={420} h={170} label="On-chain" tone="solana" />
      <Node x={480} y={250} w={180} h={100} title="pof-gate · pof-reserve" sub={['trust the allowlist', 'and the threshold', 'nothing else']} tone="solana" />
      <Node x={680} y={250} w={180} h={100} title="Consumers" sub={['pof-credit, wZEC demo', 'act on receipts', 'and the feed']} tone="solana" />

      <Edge points={[[440, 110], [460, 110]]} />
      <Edge points={[[572, 190], [572, 200], [230, 200], [230, 210]]} label="same verifier, same public data" at={[400, 196]} />
      <Edge points={[[440, 300], [460, 300]]} />
      <Edge points={[[660, 300], [680, 300]]} />
    </Diagram>
  )
}
