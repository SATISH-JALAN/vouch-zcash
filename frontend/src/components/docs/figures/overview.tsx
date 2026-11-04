import { Diagram, Edge, Node, Txt, Zone } from '../diagrams/kit'
import { Sequence } from '../diagrams/Sequence'

/** Every moving part, and what flows between them. */
export function SystemOverview() {
  return (
    <Diagram
      title="System overview: chain data, the holder, verifiers and Solana"
      width={960}
      height={520}
      minWidth={760}
      caption="Public chain data becomes trusted roots; the holder proves against them on their own machine; anyone verifies the .pof file; an attestor carries the verdict to Solana."
    >
      <Zone x={20} y={20} w={300} h={130} label="Zcash network" tone="zcash" />
      <Node x={40} y={55} w={120} h={70} title="Zcash chain" sub="Ironwood pool" tone="zcash" />
      <Node x={180} y={55} w={120} h={70} title="lightwalletd" sub="compact blocks" tone="zcash" />
      <Edge points={[[160, 90], [180, 90]]} />

      <Zone x={340} y={20} w={600} h={130} label="Anchor publisher · anyone can run it" />
      <Node x={360} y={55} w={160} h={70} title="pof-anchor" sub={['rebuilds the note tree', 'and the nullifier IMT']} mono />
      <Node x={560} y={55} w={160} h={70} title=".vsnp snapshot" sub={['every commitment', 'and nullifier']} />
      <Node x={760} y={55} w={160} h={70} title="Anchor table" sub={['height · nc_root · nf_root', '/api/anchors']} tone="accent" />
      <Edge points={[[300, 90], [360, 90]]} />
      <Edge points={[[520, 90], [560, 90]]} />
      <Edge points={[[720, 90], [760, 90]]} label="roots" at={[740, 82]} />

      <Zone x={20} y={190} w={440} h={130} label="Holder's machine" tone="accent" />
      <Node x={40} y={225} w={120} h={70} title="Wallet seed" sub="read locally" />
      <Node x={190} y={225} w={130} h={70} title="pof-prove" sub={['finds notes,', 'proves, signs']} mono />
      <Node x={350} y={235} w={90} h={50} title=".pof" sub="≈ 11.9 KB" tone="accent" />
      <Edge points={[[160, 260], [190, 260]]} />
      <Edge points={[[320, 260], [350, 260]]} />
      <Edge points={[[640, 125], [640, 168], [290, 168], [290, 225]]} label="public data" at={[465, 162]} dashed />

      <Zone x={500} y={190} w={440} h={130} label="Anyone can verify" />
      <Node x={520} y={225} w={125} h={70} title="Browser" sub="pof-wasm" />
      <Node x={660} y={225} w={125} h={70} title="pof-verify" sub="CLI" mono />
      <Node x={800} y={225} w={125} h={70} title="Attestor" sub="pof-attest" tone="service" />
      <Edge points={[[440, 260], [520, 260]]} label=".pof" at={[480, 252]} />
      <Edge points={[[840, 125], [840, 190]]} label="trusted roots" at={[848, 165]} anchor="start" dashed />

      <Zone x={20} y={360} w={440} h={140} label="Relying parties" />
      <Node x={40} y={400} w={190} h={70} title="Rail · exchange · desk" sub={['checks an exit certificate,', 'matches the deposit']} />
      <Node x={250} y={400} w={190} h={70} title="Lender · counterparty" sub={['reads proof of funds,', 'sees reuse in its period']} />
      <Edge points={[[582, 295], [582, 330], [190, 330], [190, 400]]} label="Valid · or why not" at={[400, 324]} />
      <Edge points={[[345, 330], [345, 400]]} />

      <Zone x={500} y={360} w={440} h={140} label="Solana" tone="solana" />
      <Node x={520} y={400} w={120} h={70} title="pof-gate" sub="receipts" tone="solana" mono />
      <Node x={660} y={400} w={120} h={70} title="pof-credit" sub="credit lines" tone="solana" mono />
      <Node x={800} y={400} w={120} h={70} title="pof-reserve" sub="reserves feed" tone="solana" mono />
      <Edge points={[[640, 435], [660, 435]]} />
      <Edge points={[[835, 295], [835, 345], [600, 345], [600, 400]]} label="Ed25519 verdict" at={[718, 339]} />
      <Edge points={[[880, 295], [880, 400]]} />
    </Diagram>
  )
}

/** One proof, from the request to the decision. */
export function ProofLifecycle() {
  return (
    <Sequence
      title="The life of one proof"
      caption="The request and the proof are files or links; nothing else passes between the parties. The verifier needs only public data to check it."
      actors={[
        { id: 'v', label: 'Verifier', sub: 'rail · lender' },
        { id: 'h', label: 'Holder', tone: 'accent' },
        { id: 'p', label: 'pof-prove', sub: "holder's machine", tone: 'accent' },
        { id: 'a', label: 'Anchor table', sub: '/api/anchors' },
      ]}
      steps={[
        { from: 'v', to: 'h', label: 'request link', detail: 'claim · audience · period · expiry' },
        { from: 'h', to: 'p', label: 'request + seed + snapshot' },
        { from: 'p', to: 'p', label: 'find notes, pick ≤ 5', detail: 'trial decryption, offline' },
        { from: 'p', to: 'p', label: 'prove, then sign', detail: 'Halo2 · RedPallas' },
        { from: 'p', to: 'h', label: 'proof.pof', detail: 'nothing broadcast' },
        { from: 'h', to: 'v', label: 'the .pof file, or a link' },
        { from: 'v', to: 'a', label: 'fetch anchors + revocations' },
        { from: 'a', to: 'v', label: 'trusted roots', dashed: true },
        { from: 'v', to: 'v', label: 'six checks', detail: '→ a typed verdict' },
        { note: 'Valid → release the deposit, open the line, or attest it for Solana', over: ['v', 'h'], tone: 'good' },
      ]}
    />
  )
}

/** What runs where in the hosted deployment. */
export function DeployTopology() {
  return (
    <Diagram
      title="The hosted deployment"
      width={900}
      height={400}
      minWidth={720}
      caption="The site and its API run on Vercel with Upstash Redis for shared state; the attestor runs on Render; the programs are on Solana devnet; deposit lookups go to a public testnet lightwalletd."
    >
      <Node x={20} y={160} w={150} h={90} title="Visitor's browser" sub={['pages + WASM verifier', 'proofs stay local']} />

      <Zone x={210} y={20} w={300} h={360} label="Vercel" />
      <Node x={230} y={55} w={260} h={70} title="Next.js site" sub={['pages · docs · /proofs · /wasm']} />
      <Node x={230} y={150} w={260} h={80} title="Site API" sub={['/api/anchors · revocations · status', '/api/attest · relay · reserve']} mono={false} />
      <Node x={230} y={285} w={260} h={70} title="Upstash Redis" sub={['revocations · used demo proofs', 'rate limits · budgets']} tone="muted" />

      <Zone x={560} y={20} w={320} h={150} label="Render · free plan" tone="service" />
      <Node x={580} y={55} w={280} h={90} title="pof-attest" sub={['verify · attest · rail API', 'Ed25519 key from the environment']} tone="service" mono />

      <Zone x={560} y={200} w={150} h={180} label="Solana devnet" tone="solana" />
      <Node x={575} y={235} w={120} h={125} title="Programs" sub={['pof-gate', 'pof-credit', 'pof-reserve']} tone="solana" />

      <Zone x={730} y={200} w={150} h={180} label="Zcash testnet" tone="zcash" />
      <Node x={745} y={235} w={120} h={125} title="lightwalletd" sub={['testnet.zec.rocks', 'deposit lookups']} tone="zcash" />

      <Edge points={[[170, 185], [196, 185], [196, 90], [230, 90]]} label="HTTPS" at={[190, 140]} anchor="end" />
      <Edge points={[[170, 225], [212, 225], [212, 190], [230, 190]]} />
      <Edge points={[[360, 230], [360, 285]]} label="state" at={[368, 262]} anchor="start" />
      <Edge points={[[490, 175], [528, 175], [528, 100], [580, 100]]} label="/v1/attest · /v1/batch" at={[536, 92]} anchor="start" />
      <Edge points={[[490, 205], [540, 205], [540, 330], [575, 330]]} label="relayer txs" at={[534, 282]} anchor="end" />
      <Edge points={[[490, 65], [580, 65]]} label="revocation list" at={[535, 58]} dashed />
      <Edge points={[[640, 145], [640, 235]]} label="slot" at={[646, 195]} anchor="start" />
      <Edge points={[[805, 145], [805, 235]]} label="GetTransaction" at={[811, 195]} anchor="start" />
    </Diagram>
  )
}

/** The Rust workspace, as a dependency graph. */
export function CrateGraph() {
  return (
    <Diagram
      title="The Rust crates and what each depends on"
      width={860}
      height={470}
      minWidth={680}
      caption="Arrows point from a crate to what it uses. Every crate also uses pof-core, the format. Only pof-anchor and the attestor talk to a network; pof-prove's library links no network client, and a test enforces it."
    >
      <Node x={40} y={20} w={170} h={58} title="pof-wasm" sub="the browser build" mono tone="accent" />
      <Node x={340} y={20} w={170} h={58} title="pof-attest" sub="HTTP service" mono tone="service" />
      <Node x={640} y={20} w={170} h={58} title="pof-prove" sub="holder library + CLI" mono tone="accent" />
      <Node x={190} y={140} w={170} h={58} title="pof-verify" sub="verifier + CLI" mono />
      <Node x={490} y={140} w={170} h={58} title="pof-anchor" sub="snapshots · lightwalletd" mono />
      <Node x={340} y={260} w={170} h={58} title="pof-zk" sub="circuit glue · embedded VK" mono />
      <Node x={190} y={380} w={170} h={58} title="pof-core" sub="the .pof format" mono />
      <Node x={490} y={380} w={170} h={58} title="voting-circuits" sub="vendored · Valar Group" mono tone="muted" />

      <Edge points={[[125, 78], [250, 140]]} />
      <Edge points={[[400, 78], [300, 140]]} />
      <Edge points={[[450, 78], [550, 140]]} />
      <Edge points={[[510, 49], [640, 49]]} label="demo holder" at={[575, 42]} />
      <Edge points={[[700, 78], [610, 140]]} />
      <Edge points={[[790, 78], [790, 289], [510, 289]]} />
      <Edge points={[[300, 198], [400, 260]]} />
      <Edge points={[[550, 198], [450, 260]]} />
      <Edge points={[[400, 318], [300, 380]]} />
      <Edge points={[[450, 318], [550, 380]]} />
      <Txt x={20} y={460} kind="sub">
        Network: pof-anchor (lightwalletd gRPC) · pof-attest (Solana RPC, revocation list, lightwalletd for rails)
      </Txt>
    </Diagram>
  )
}
