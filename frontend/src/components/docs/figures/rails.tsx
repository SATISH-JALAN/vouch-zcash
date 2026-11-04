import { Diagram, Edge, Node, Zone } from '../diagrams/kit'
import { Sequence } from '../diagrams/Sequence'

/** The exit-certificate flow, end to end. */
export function ExitSequence() {
  return (
    <Sequence
      title="An exit, from request to release"
      caption="The certificate is checked before the deposit is sent, and matched when it lands. The service returns evidence; the rail decides what to release."
      actors={[
        { id: 'r', label: 'Rail', sub: 'swap · exchange · desk' },
        { id: 'h', label: 'Holder', sub: 'pof-prove', tone: 'accent' },
        { id: 'a', label: 'Verify API', sub: 'pof-attest rail API', tone: 'service' },
        { id: 'z', label: 'Zcash', sub: 'lightwalletd', tone: 'zcash' },
      ]}
      steps={[
        { from: 'r', to: 'h', label: 'request (kind exit)', detail: 'X · period · unmoved since H · intent' },
        { from: 'h', to: 'h', label: 'prove --exit', detail: 'circuit 2 · names the notes' },
        { from: 'h', to: 'r', label: 'certificate.pof' },
        { from: 'r', to: 'a', label: 'POST /v1/certificates' },
        { from: 'a', to: 'a', label: 'verify under policy', detail: 'period · H · reuse registry' },
        { from: 'a', to: 'r', label: 'pre-cleared + webhook', dashed: true, tone: 'good' },
        { from: 'h', to: 'z', label: 'deposit tx', detail: 'spends exactly the certified notes' },
        { from: 'r', to: 'a', label: 'POST …/match { txid }' },
        { from: 'a', to: 'z', label: 'GetTransaction' },
        { from: 'z', to: 'a', label: 'the deposit’s nullifiers', dashed: true },
        { from: 'a', to: 'a', label: 'exit_matches', detail: 'every spend certified?' },
        { from: 'a', to: 'r', label: 'matched | mismatch + webhook', dashed: true, tone: 'good' },
        { note: 'The rail releases or holds the deposit under its own policy', over: 'r', tone: 'muted' },
      ]}
    />
  )
}

const chip = (x: number, y: number, w: number, label: string, tone: 'accent' | 'bad' = 'accent') => <Node x={x} y={y} w={w} h={34} title={label} mono tone={tone} r={7} />

/** Why a dummy spend breaks the match. */
export function MatchFigure() {
  return (
    <Diagram
      title="Matching a deposit to a certificate"
      width={900}
      height={300}
      minWidth={720}
      caption="Matched means every nullifier the deposit reveals is one the certificate named. A dummy spend reveals a nullifier that looks exactly like an uncertified note, so exit transactions must be built without them."
    >
      <Zone x={20} y={20} w={220} h={260} label="Certificate names" tone="accent" />
      {chip(50, 90, 160, 'nf₁')}
      {chip(50, 150, 160, 'nf₂')}
      <Zone x={290} y={20} w={280} h={120} label="Deposit A" />
      {chip(315, 70, 110, 'nf₁')}
      {chip(440, 70, 110, 'nf₂')}
      <Zone x={290} y={160} w={280} h={120} label="Deposit B · with a dummy spend" />
      {chip(305, 212, 80, 'nf₁')}
      {chip(395, 212, 80, 'nf₂')}
      {chip(485, 212, 75, 'nf ?', 'bad')}
      <Node x={630} y={50} w={250} h={60} title="Matched" sub="every spent note was certified" tone="good" />
      <Node x={630} y={190} w={250} h={60} title="Mismatch" sub="one nullifier was never named" tone="bad" />
      <Edge points={[[570, 80], [630, 80]]} tone="good" />
      <Edge points={[[570, 220], [630, 220]]} tone="bad" />
      <Edge points={[[240, 110], [265, 110], [265, 87], [290, 87]]} dashed />
      <Edge points={[[240, 160], [265, 160], [265, 229], [290, 229]]} dashed />
    </Diagram>
  )
}

/** Many notes, several proofs, one total. */
export function BatchFigure() {
  return (
    <Diagram
      title="A reserves batch"
      width={900}
      height={360}
      minWidth={740}
      caption="Every usable note goes into a proof of at most five notes; all proofs share one scope and one anchor. The verifier checks each member, refuses any tag seen twice, and states the sum. This is the demo batch: five notes, two per proof."
    >
      {[1, 2, 3, 4, 5].map((n, i) => (
        <Node key={n} x={30} y={40 + i * 58} w={100} h={38} title={`note ${n}`} mono tone="muted" r={7} />
      ))}
      <Node x={200} y={40} w={180} h={84} title="Proof 1" sub={['notes 1, 2', 'tags t₁ t₂']} tone="accent" />
      <Node x={200} y={140} w={180} h={84} title="Proof 2" sub={['notes 3, 4', 'tags t₃ t₄']} tone="accent" />
      <Node x={200} y={240} w={180} h={84} title="Proof 3" sub={['note 5', 'tag t₅']} tone="accent" />
      <Edge points={[[130, 59], [165, 59], [165, 72], [200, 72]]} />
      <Edge points={[[130, 117], [165, 117], [165, 92], [200, 92]]} />
      <Edge points={[[130, 175], [165, 175], [165, 172], [200, 172]]} />
      <Edge points={[[130, 233], [165, 233], [165, 192], [200, 192]]} />
      <Edge points={[[130, 291], [200, 291]]} />
      <Node x={440} y={90} w={210} h={180} title="verify_batch" sub={['each member verifies', 'one scope · one anchor', 'no tag twice', 'one batched Halo2 check', 'total = Σ thresholds']} tone="service" />
      <Edge points={[[380, 82], [410, 82], [410, 150], [440, 150]]} />
      <Edge points={[[380, 182], [440, 182]]} />
      <Edge points={[[380, 282], [410, 282], [410, 214], [440, 214]]} />
      <Node x={700} y={100} w={180} h={70} title="Valid batch" sub={['4,018.125 ZEC', 'across 3 proofs']} tone="good" />
      <Node x={700} y={200} w={180} h={70} title="Invalid batch" sub={['a tag repeats:', 'a note counted twice']} tone="bad" />
      <Edge points={[[650, 150], [675, 150], [675, 135], [700, 135]]} tone="good" />
      <Edge points={[[650, 214], [675, 214], [675, 235], [700, 235]]} tone="bad" dashed />
    </Diagram>
  )
}

/** Publishing reserves to Solana, then minting against them. */
export function ReservesSequence() {
  return (
    <Sequence
      title="Publishing reserves and minting against them"
      caption="The attestor signs a batch verdict; pof-reserve checks that signature by instruction introspection and stores the total. Its token then mints only within that total, and only while the feed is fresh."
      actors={[
        { id: 't', label: 'Treasury', sub: 'pof-prove', tone: 'accent' },
        { id: 'i', label: 'Issuer', sub: 'relayer key' },
        { id: 'a', label: 'Attestor', sub: '/v1/batch', tone: 'service' },
        { id: 'p', label: 'pof-reserve', sub: 'Solana', tone: 'solana' },
      ]}
      steps={[
        { from: 't', to: 't', label: 'prove a batch', detail: '--batch-size 5 → .pofb' },
        { from: 't', to: 'i', label: 'reserves.pofb' },
        { from: 'i', to: 'a', label: 'POST /v1/batch { attest }' },
        { from: 'a', to: 'a', label: 'verify_batch, then sign', detail: 'POF-RESERVE-v1 · 112 B' },
        { from: 'a', to: 'i', label: 'message + signature', dashed: true },
        { from: 'i', to: 'p', label: 'tx: Ed25519 ix + publish' },
        { from: 'p', to: 'p', label: 'signers · slot · expiry', detail: 'audience · anchor ≥ current' },
        { note: 'Feed updated: total, members, heights, slot', over: 'p', tone: 'solana' },
        { from: 'i', to: 'p', label: 'secure_mint(amount)' },
        { from: 'p', to: 'p', label: 'fresh? within total?', detail: 'supply + amount ≤ total' },
        { from: 'p', to: 'i', label: 'minted, or refused', dashed: true },
      ]}
    />
  )
}

/** The feed's three states. */
export function FeedStates() {
  return (
    <Diagram
      title="The reserves feed's states"
      width={880}
      height={270}
      minWidth={700}
      caption="Secure Mint works only in the Fresh state, and only while supply plus the amount stays within the proven total. Freshness lapses when the heartbeat passes without a publish, or when the proofs behind the feed expire."
    >
      <Node x={20} y={100} w={180} h={70} title="Never published" sub="mints nothing" tone="muted" />
      <Node x={340} y={100} w={190} h={70} title="Fresh" sub={['mints within the total', 'refuses past it']} tone="good" />
      <Node x={670} y={100} w={190} h={70} title="Stale" sub={['mints nothing', 'until a new publish']} tone="bad" />
      <Edge points={[[200, 135], [340, 135]]} label="publish" />
      <Edge points={[[530, 128], [670, 128]]} label="heartbeat passes" />
      <Txt2 x={600} y={150} text="or the proofs expire" />
      <Edge points={[[765, 170], [765, 225], [435, 225], [435, 170]]} label="publish a batch (anchor ≥ current)" at={[600, 218]} />
      <Edge points={[[400, 100], [400, 50], [470, 50], [470, 100]]} label="publish again: the heartbeat restarts" at={[480, 44]} anchor="start" />
    </Diagram>
  )
}

function Txt2({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" className="dg-elabel">
      {text}
    </text>
  )
}
