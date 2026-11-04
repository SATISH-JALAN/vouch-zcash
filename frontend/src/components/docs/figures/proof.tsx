import { Badge, Diagram, Edge, Node, Txt, Zone } from '../diagrams/kit'
import { Bytes } from '../diagrams/Bytes'
import { Sequence } from '../diagrams/Sequence'

/** How every field of the file is tied to the proof and the signature. */
export function StatementBinding() {
  return (
    <Diagram
      title="What binds the file to the proof"
      width={900}
      height={360}
      minWidth={740}
      caption="The holder signs the statement and every public input under the key the circuit proves controls the notes. Edit any field after proving and the signature fails; in version 1 the circuit itself is also bound to the statement through round_id."
    >
      <Node x={20} y={40} w={210} h={180} title="Envelope head" sub={['claim · audience · epoch', 'binding · circuit', 'nc_height · height', 'nc_root · nf_root', 'issued · expires · revocation']} />
      <Txt x={125} y={240} anchor="middle">
        every field except the evidence
      </Txt>
      <Node x={290} y={40} w={170} h={60} title="statement" sub="blake2b · vouch-stmt-v1" />
      <Node x={290} y={150} w={170} h={70} title="scope (v2)" sub={['blake2b · vouch-scope-v2', 'circuit ‖ audience ‖ epoch']} />
      <Node x={290} y={270} w={170} h={60} title="public inputs" sub="9 carried · 15 for circuit 2" />
      <Node x={530} y={40} w={170} h={60} title="signing message" sub="statement ‖ public inputs" />
      <Node x={720} y={40} w={160} h={60} title="RedPallas signature" sub="under rk: spend authority" tone="accent" />
      <Node x={530} y={150} w={170} h={70} title="round_id" sub={['v1: the statement', 'v2: the scope']} />
      <Node x={720} y={150} w={160} h={70} title="Halo2 circuit" sub={['dom from round_id', 'min_ballots from claim']} tone="accent" />
      <Edge points={[[230, 70], [290, 70]]} />
      <Edge points={[[230, 185], [290, 185]]} />
      <Edge points={[[460, 70], [530, 70]]} />
      <Edge points={[[460, 85], [495, 85], [495, 172], [530, 172]]} label="v1" at={[480, 130]} />
      <Edge points={[[460, 198], [530, 198]]} label="v2" at={[495, 191]} />
      <Edge points={[[460, 300], [512, 300], [512, 88], [530, 88]]} />
      <Edge points={[[700, 70], [720, 70]]} />
      <Edge points={[[700, 185], [720, 185]]} />
      <Edge points={[[460, 318], [800, 318], [800, 220]]} label="and the proof is checked against them" at={[630, 311]} />
    </Diagram>
  )
}

const PI: { i: string; name: string; carried: boolean; c2?: boolean }[] = [
  { i: '0', name: 'nf_signed', carried: true },
  { i: '1–2', name: 'rk (x, y)', carried: true },
  { i: '3', name: 'cmx_new', carried: true },
  { i: '4', name: 'van_comm', carried: true },
  { i: '5', name: 'vote_round_id', carried: false },
  { i: '6', name: 'nc_root', carried: false },
  { i: '7', name: 'nf_imt_root', carried: false },
  { i: '8–12', name: 'gov_null 1–5', carried: true },
  { i: '13', name: 'dom', carried: false },
  { i: '14', name: 'min_ballots', carried: false },
  { i: '15', name: 'reveal', carried: true, c2: true },
  { i: '16–20', name: 'revealed_nf 1–5', carried: true, c2: true },
]

/** The circuit's public inputs: which the file carries and which the verifier derives. */
export function PublicInputs() {
  const cell = (k: number) => {
    const p = PI[k]!
    const row = k < 6 ? 0 : k < 10 ? 1 : 2
    const col = k < 6 ? k : k < 10 ? k - 6 : k - 10
    const w = row === 0 ? 140 : 210
    const x = 20 + col * (w + 8)
    const y = 30 + row * 96
    return <Node key={p.name} x={x} y={y} w={w} h={62} title={p.name} sub={`#${p.i} · ${p.carried ? 'carried' : 'derived'}`} mono tone={p.carried ? 'accent' : 'service'} r={8} />
  }
  return (
    <Diagram
      title="Public inputs: carried in the file or derived by the verifier"
      width={900}
      height={340}
      minWidth={720}
      caption="The verifier never trusts a field it can derive: the round id, the nullifier domain, both roots and the threshold are recomputed from the statement and the anchor table. Circuit 2 (exit certificates) adds six inputs."
    >
      {PI.map((_, k) => cell(k))}
      <Txt x={20} y={22} kind="label">
        Circuit 1 · 15 inputs
      </Txt>
      <Txt x={20} y={214} kind="label">
        Circuit 2 adds · 6 inputs
      </Txt>
      <g className="dg-node dg-accent">
        <rect x={20} y={300} width={14} height={14} rx={3} />
      </g>
      <Txt x={42} y={312}>
        carried in the .pof
      </Txt>
      <g className="dg-node dg-service">
        <rect x={190} y={300} width={14} height={14} rx={3} />
      </g>
      <Txt x={212} y={312}>
        derived by the verifier
      </Txt>
    </Diagram>
  )
}

const CHECKS = [
  ['1 · Format', 'magic · version · checksum · decode', 'Malformed'],
  ['2 · Expiry', 'now < expires_at', 'Expired'],
  ['3 · Revocation', 'no published secret matches the tag', 'Revoked'],
  ['4 · Audience and scope', 'blake2b(id) = audience · epoch', 'WrongAudience · WrongScope'],
  ['5 · Anchors and policy', 'both roots published · fresh · dormant', 'AnchorNotFound · AnchorTooOld · NotDormantLongEnough'],
  ['6 · Proof and reuse', 'distinct tags · signature · Halo2 · registry', 'ProofInvalid · AlreadyUsed'],
] as const

/** The six checks, cheapest first, with where each one exits. */
export function VerifyPipeline() {
  return (
    <Diagram
      title="The verification pipeline"
      width={860}
      height={660}
      minWidth={680}
      caption="Six checks, cheapest first. The first failure decides the verdict and the later checks are reported as not run, so no cryptography ever runs on a file that failed a cheap check."
    >
      <Node x={40} y={20} w={320} h={56} title=".pof bytes + context" sub="audience · anchors · revocations · now · policy" />
      {CHECKS.map(([t, s, fail], i) => {
        const y = 100 + i * 82
        return (
          <g key={t}>
            <Edge points={[[200, y - 24], [200, y]]} label={i ? 'pass' : undefined} at={[208, y - 8]} anchor="start" />
            <Node x={40} y={y} w={320} h={58} title={t} sub={s} />
            <Edge points={[[360, y + 29], [430, y + 29]]} label="fail" at={[395, y + 22]} tone="bad" />
            <Node x={430} y={y + 4} w={410} h={50} title={fail} tone="bad" mono />
          </g>
        )
      })}
      <Edge points={[[200, 574], [200, 596]]} label="pass" at={[208, 590]} anchor="start" tone="good" />
      <Node x={40} y={596} w={320} h={56} title="Valid" sub="claim · anchor height · unmoved since" tone="good" />
      <Txt x={430} y={630} kind="sub">
        Each verdict is typed, never a bool; the CLI turns it into an exit code.
      </Txt>
    </Diagram>
  )
}

/** One verifier, compiled three ways. */
export function ThreeHosts() {
  return (
    <Diagram
      title="One verifier, three hosts"
      width={900}
      height={270}
      minWidth={720}
      caption="The CLI, the browser and the attestor run the same Rust function. CI runs every test vector through the native build and the committed WASM build and checks the verdicts are identical."
    >
      <Node x={20} y={95} w={180} h={74} title="pof-verify" sub={['verify(bytes, ctx)', '→ VerificationResult']} mono tone="accent" />
      <Node x={290} y={20} w={250} h={64} title="Native CLI" sub="pof-verify check · exit codes" />
      <Node x={290} y={100} w={250} h={64} title="WASM in a Web Worker" sub="pof-wasm · VK embedded" />
      <Node x={290} y={180} w={250} h={64} title="Attestor service" sub="pof-attest · signs the verdict" tone="service" />
      <Node x={620} y={20} w={260} h={64} title="CI jobs, scripts, rails" sub="files on disk, no network" />
      <Node x={620} y={100} w={260} h={64} title="/verify · /rail · /reserves" sub="the proof never leaves the tab" />
      <Node x={620} y={180} w={260} h={64} title="Solana programs · rail API" sub="Ed25519 attestations, webhooks" tone="solana" />
      <Edge points={[[200, 120], [245, 120], [245, 52], [290, 52]]} />
      <Edge points={[[200, 132], [290, 132]]} />
      <Edge points={[[200, 145], [245, 145], [245, 212], [290, 212]]} />
      <Edge points={[[540, 52], [620, 52]]} />
      <Edge points={[[540, 132], [620, 132]]} />
      <Edge points={[[540, 212], [620, 212]]} />
    </Diagram>
  )
}

export function FileLayout() {
  return (
    <Bytes
      title="The .pof file"
      caption="Binary, or base64url (no padding) wherever it travels as text. The checksum makes a truncated paste distinguishable from a forgery."
      fields={[
        { label: 'magic', size: 4, sub: '"POF1"', tone: 'muted' },
        { label: 'version', size: 2, sub: 'u16 LE · 1 or 2', tone: 'muted' },
        { label: 'body', size: 'variable', sub: 'postcard(Body)', tone: 'accent' },
        { label: 'checksum', size: 32, sub: 'blake2b-256(body)', tone: 'muted' },
      ]}
      total="a holding proof: about 11,900 bytes"
    />
  )
}

export function PofbLayout() {
  return (
    <Bytes
      title="The .pofb reserves batch"
      caption="Members are complete POF1 files, each prefixed by its length. They share one scope and one anchor; the checksum covers everything before it."
      fields={[
        { label: 'magic', size: 4, sub: '"POFB"', tone: 'muted' },
        { label: 'version', size: 2, sub: '1', tone: 'muted' },
        { label: 'count', size: 2, sub: '1 … 64', tone: 'muted' },
        { label: 'member 1', size: 'u32 len + POF1', sub: 'a complete proof', tone: 'accent' },
        { label: '…', size: '', tone: 'plain' },
        { label: 'member n', size: 'u32 len + POF1', sub: 'a complete proof', tone: 'accent' },
        { label: 'checksum', size: 32, sub: 'blake2b-256', tone: 'muted' },
      ]}
    />
  )
}

/** pof-prove prove, step by step. */
export function ProverPipeline() {
  const steps: [string, string[]][] = [
    ['Read the request', ['decode, validate, print the', 'sentence, ask to confirm']],
    ['Open the snapshot', ['checksum-verified; its anchor', 'must be published']],
    ['Derive keys', ['seed → ZIP 32 spending key', 'coin type from the network']],
    ['Find your notes', ['trial-decrypt every action', 'in parallel; drop spent ones']],
    ['Pick notes', ['fewest, largest first', 'at most 5, sum ≥ X']],
    ['Fix the envelope', ['every field final before', 'anything is bound']],
    ['Build witnesses', ['Merkle paths + IMT', 'non-membership proofs']],
    ['Prove', ['Halo2 over Pasta', 'K = 12, no trusted setup']],
    ['Sign', ['RedPallas over statement', '‖ public inputs']],
    ['Write', ['proof.pof + history', '(0600; secret kept locally)']],
  ]
  const pos = (i: number): [number, number] => {
    const row = Math.floor(i / 4)
    const col = i % 4
    const x = row === 1 ? 20 + (3 - col) * 220 : 20 + col * 220
    return [x, 46 + row * 130]
  }
  return (
    <Diagram
      title="Inside pof-prove prove"
      width={900}
      height={420}
      minWidth={740}
      caption="Everything runs on the holder's machine. The prover library links no network client (a test enforces it); the CLI touches the network only for pof-prove revoke, and only when asked."
    >
      <Zone x={8} y={8} w={884} h={404} label="Holder's machine · offline" tone="accent" />
      {steps.map(([t, s], i) => {
        const [x, y] = pos(i)
        return (
          <g key={t}>
            <Node x={x} y={y} w={190} h={78} title={t} sub={s} tone={i === 7 || i === 8 ? 'accent' : 'plain'} />
            <Badge x={x + 4} y={y + 4} n={i + 1} />
          </g>
        )
      })}
      {[0, 1, 2].map((i) => {
        const [x, y] = pos(i)
        return <Edge key={`r${i}`} points={[[x + 190, y + 39], [x + 220, y + 39]]} />
      })}
      <Edge points={[[775, 124], [775, 176]]} />
      {[4, 5, 6].map((i) => {
        const [x, y] = pos(i)
        return <Edge key={`l${i}`} points={[[x, y + 39], [x - 30, y + 39]]} />
      })}
      <Edge points={[[115, 254], [115, 306]]} />
      <Edge points={[[210, 345], [240, 345]]} />
    </Diagram>
  )
}

/** How a revocation reaches every verifier. */
export function RevocationFlow() {
  return (
    <Sequence
      title="Revoking a proof"
      caption="Revocation is a hash lock: only the holder knows the secret, so the list can drop an entry but never forge one. The attestor caches the list for ten seconds."
      actors={[
        { id: 'h', label: 'Holder', sub: 'pof-prove revoke', tone: 'accent' },
        { id: 's', label: 'Revocation list', sub: '/api/revocations' },
        { id: 'v', label: 'Any verifier', sub: 'browser · CLI' },
        { id: 'a', label: 'Attestor', tone: 'service' },
      ]}
      steps={[
        { from: 'h', to: 's', label: 'POST { secret }' },
        { from: 's', to: 's', label: 'store it', detail: 'shared store (Redis)' },
        { from: 'v', to: 's', label: 'GET the list' },
        { from: 's', to: 'v', label: '{ secrets: […] }', dashed: true },
        { from: 'v', to: 'v', label: 'blake2b(secret)[..16]', detail: '= the file’s tag → Revoked' },
        { from: 'a', to: 's', label: 'GET (cached 10 s)' },
        { from: 'a', to: 'a', label: 'refuses to sign', detail: '422 · Revoked' },
      ]}
    />
  )
}
