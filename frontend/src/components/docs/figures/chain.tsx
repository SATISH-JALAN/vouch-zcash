import { Diagram, Edge, Node, Txt } from '../diagrams/kit'

const leafX = (i: number) => 30 + i * 54

/** The two structures a proof is checked against: the note tree (membership) and the nullifier IMT (non-membership). */
export function TreeAndNullifiers() {
  const l2 = [0, 1, 2, 3].map((j) => 79 + 108 * j)
  const l1 = [133, 349]
  const onPath = (level: 'l2' | 'l1', i: number) => (level === 'l2' ? i === 2 : i === 1)
  const link = (x1: number, y1: number, x2: number, y2: number, hot: boolean, k: string) => (
    <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} className={hot ? 'dg-link dg-link-hot' : 'dg-link'} />
  )
  return (
    <Diagram
      title="Membership in the note tree, non-membership in the spent set"
      width={900}
      height={340}
      minWidth={720}
      caption="Left: a Merkle path shows the note is a leaf of the tree whose root is nc_root. Right: an IMT leaf (low, next) with low < nf < next shows the note's nullifier was never revealed, so the note is unspent. Neither the note nor the nullifier is shown to the verifier."
    >
      {/* tree */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => link(leafX(i) + 22, 225, l2[Math.floor(i / 2)]!, 195, i === 5, `a${i}`))}
      {l2.map((x, j) => link(x, 165, l1[Math.floor(j / 2)]!, 135, j === 2, `b${j}`))}
      {l1.map((x, k) => link(x, 105, 241, 74, k === 1, `c${k}`))}
      <Node x={186} y={40} w={110} h={34} title="nc_root" mono tone="accent" r={8} />
      {l1.map((x, k) => (
        <Node key={x} x={x - 40} y={105} w={80} h={30} title={onPath('l1', k) ? 'path' : 'sibling'} tone={onPath('l1', k) ? 'accent' : 'muted'} r={6} />
      ))}
      {l2.map((x, j) => (
        <Node key={x} x={x - 35} y={165} w={70} h={30} title={onPath('l2', j) ? 'path' : j === 3 ? 'sibling' : '·'} tone={onPath('l2', j) ? 'accent' : j === 3 ? 'muted' : 'plain'} r={6} />
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <Node key={i} x={leafX(i)} y={225} w={44} h={30} title={`cm${i}`} mono tone={i === 5 ? 'accent' : i === 4 ? 'muted' : 'plain'} r={6} />
      ))}
      <Txt x={leafX(5) + 22} y={274} anchor="middle" kind="label">
        your note
      </Txt>
      <Txt x={241} y={308} anchor="middle" kind="title">
        Note-commitment tree at nc_height
      </Txt>
      <Txt x={241} y={326} anchor="middle">
        the tree only grows: a leaf at H₀ is a leaf for ever
      </Txt>

      {/* IMT number line */}
      <line x1={500} y1={200} x2={870} y2={200} className="dg-link" />
      <Txt x={500} y={222}>0</Txt>
      <Txt x={870} y={222} anchor="end">
        p
      </Txt>
      {[525, 580, 640, 700, 790, 850].map((x) => (
        <circle key={x} cx={x} cy={200} r={5} className="dg-dot" />
      ))}
      <circle cx={745} cy={200} r={6} className="dg-dot-you" />
      <Txt x={745} y={240} anchor="middle" kind="label">
        your nf
      </Txt>
      <path d="M700,180 V168 H790 V180" className="dg-bracket" />
      <Txt x={745} y={160} anchor="middle" kind="label">
        IMT leaf (low, next)
      </Txt>
      <Txt x={745} y={144} anchor="middle">
        low &lt; nf &lt; next
      </Txt>
      <Node x={625} y={40} w={130} h={34} title="nf_root" mono tone="accent" r={8} />
      <Edge points={[[745, 132], [745, 110], [690, 110], [690, 74]]} label="hashes up to" at={[700, 104]} anchor="start" dashed />
      <Txt x={590} y={262}>● a revealed (spent) nullifier</Txt>
      <Txt x={685} y={308} anchor="middle" kind="title">
        Spent-nullifier IMT at height
      </Txt>
      <Txt x={685} y={326} anchor="middle">
        spending a note reveals its nullifier, for ever
      </Txt>
    </Diagram>
  )
}

/** Two roots from two blocks: "in the chain at H₀, unmoved by H₁". */
export function DormancyTimeline() {
  const track = (y: number, from: number, spent: number | null, ok: boolean, name: string, result: string) => (
    <g>
      <Txt x={20} y={y + 4} kind="title">
        {name}
      </Txt>
      <line x1={from} y1={y} x2={spent ?? 860} y2={y} className={ok ? 'dg-track dg-track-good' : 'dg-track dg-track-bad'} />
      <circle cx={from} cy={y} r={6} className={ok ? 'dg-dot-good' : 'dg-dot-bad'} />
      {spent !== null && <path d={`M${spent - 6},${y - 6} L${spent + 6},${y + 6} M${spent + 6},${y - 6} L${spent - 6},${y + 6}`} className="dg-cross" />}
      <Txt x={from} y={y + 24}>
        {result}
      </Txt>
    </g>
  )
  return (
    <Diagram
      title="Unmoved since block H₀: what passes and what is refused"
      width={900}
      height={330}
      minWidth={720}
      caption="The tree root comes from H₀ and the spent-set root from the later H₁. Only a note that was already a leaf at H₀ and whose nullifier is still absent at H₁ can be proven. A self-transfer makes new notes, so it restarts the clock."
    >
      <line x1={90} y1={60} x2={880} y2={60} className="dg-link" />
      <polygon points="880,60 872,56 872,64" className="dg-dot" />
      <Txt x={880} y={46} anchor="end">
        block height
      </Txt>
      <line x1={330} y1={50} x2={330} y2={300} className="dg-marker" />
      <line x1={700} y1={50} x2={700} y2={300} className="dg-marker" />
      <Txt x={330} y={38} anchor="middle" kind="title">
        H₀ · nc_height
      </Txt>
      <Txt x={700} y={38} anchor="middle" kind="title">
        H₁ · height
      </Txt>
      <Txt x={336} y={78}>
        tree root taken here
      </Txt>
      <Txt x={706} y={78}>
        spent-set root taken here
      </Txt>
      {track(125, 160, null, true, 'Note A', '✓ counts: a leaf at H₀, its nullifier absent at H₁')}
      {track(200, 450, null, false, 'Note B', '✗ arrived after H₀: refused before any proving starts')}
      {track(275, 140, 560, false, 'Note C', '✗ moved before H₁: its nullifier is in the spent set')}
    </Diagram>
  )
}

/** The same note gives the same tag inside a scope, and unrelated tags across scopes. */
export function ScopeTags() {
  return (
    <Diagram
      title="Scopes: reuse is visible to one verifier, linkable by nobody else"
      width={900}
      height={310}
      minWidth={720}
      caption="tag = Poseidon(nk, dom, nf), with dom derived from the scope (circuit, audience, period). The tag is deterministic per note and scope, and reveals nothing about nf or nk."
    >
      <Node x={20} y={118} w={140} h={66} title="Your note" sub={['real nullifier nf', 'key nk']} tone="accent" />
      <Node x={250} y={30} w={210} h={60} title="Scope A, 1st proof" sub="circuit 1 · rail:x · Oct" />
      <Node x={250} y={122} w={210} h={60} title="Scope A, 2nd proof" sub="circuit 1 · rail:x · Oct" />
      <Node x={250} y={214} w={210} h={60} title="Scope B" sub="circuit 1 · lender:y · Oct" />
      <Edge points={[[160, 140], [205, 140], [205, 60], [250, 60]]} />
      <Edge points={[[160, 152], [250, 152]]} />
      <Edge points={[[160, 165], [205, 165], [205, 244], [250, 244]]} />
      <Node x={520} y={38} w={90} h={44} title="tag 7f3a…" mono />
      <Node x={520} y={130} w={90} h={44} title="tag 7f3a…" mono tone="bad" />
      <Node x={520} y={222} w={90} h={44} title="tag c91e…" mono tone="good" />
      <Edge points={[[460, 60], [520, 60]]} />
      <Edge points={[[460, 152], [520, 152]]} />
      <Edge points={[[460, 244], [520, 244]]} />
      <Node x={660} y={84} w={220} h={70} title="AlreadyUsed" sub={['rail:x sees the same coins', 'pledged twice this month']} tone="bad" />
      <Node x={660} y={210} w={220} h={70} title="Unrelated" sub={['lender:y and rail:x cannot', 'link their two proofs']} tone="good" />
      <Edge points={[[610, 152], [635, 152], [635, 120], [660, 120]]} tone="bad" />
      <Edge points={[[610, 244], [660, 244]]} tone="good" />
    </Diagram>
  )
}

/** pof-anchor scan, from compact blocks to a published anchor. */
export function AnchorPipeline() {
  return (
    <Diagram
      title="How an anchor is built and published"
      width={900}
      height={360}
      minWidth={740}
      caption="pof-anchor scan rebuilds both roots from public compact blocks, refuses to continue unless its tree matches lightwalletd's own tree state and block hash, then writes a snapshot and merges the record into the anchor table. scripts/sync-fixtures.sh publishes it to the site and the attestor."
    >
      <Node x={20} y={150} w={130} h={70} title="lightwalletd" sub={['zec.rocks', 'testnet.zec.rocks']} tone="zcash" />
      <Node x={185} y={150} w={160} h={70} title="Stream blocks" sub={['since Ironwood activation', 'to tip − 100, by 1,000']} />
      <Node x={380} y={150} w={150} h={70} title="Ironwood actions" sub={['nullifier · cmx · epk', 'compact ciphertext']} />
      <Node x={570} y={60} w={150} h={70} title="Note tree" sub={['from every cmx', '→ nc_root']} tone="accent" />
      <Node x={570} y={240} w={150} h={70} title="Nullifier IMT" sub={['from every nullifier', '→ nf_root']} tone="accent" />
      <Node x={760} y={60} w={130} h={70} title="Cross-check" sub={['tree root, size', 'and block hash']} tone="good" />
      <Node x={760} y={150} w={130} h={70} title="Publish" sub={['anchors.<net>.json', 'never overwrites']} />
      <Node x={760} y={240} w={130} h={70} title=".vsnp snapshot" sub={['for provers;', 'checkpoint / 1,000']} />
      <Edge points={[[150, 185], [185, 185]]} />
      <Edge points={[[345, 185], [380, 185]]} />
      <Edge points={[[530, 172], [550, 172], [550, 95], [570, 95]]} />
      <Edge points={[[530, 198], [550, 198], [550, 275], [570, 275]]} />
      <Edge points={[[720, 95], [760, 95]]} />
      <Edge points={[[825, 130], [825, 150]]} />
      <Edge points={[[720, 262], [740, 262], [740, 185], [760, 185]]} />
      <Edge points={[[720, 290], [760, 290]]} />
      <Edge points={[[85, 150], [85, 30], [825, 30], [825, 60]]} label="GetTreeState: must match, or the scan fails" at={[455, 23]} dashed />
    </Diagram>
  )
}
