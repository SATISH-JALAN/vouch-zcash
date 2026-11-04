import { A, C, Code, Hint, Stat, Stats, Table } from '@/components/docs/content'
import { IdlReference, type Idl } from '@/components/docs/IdlReference'
import { BarChart } from '@/components/docs/diagrams/BarChart'
import { FileLayout, PofbLayout, PublicInputs, StatementBinding } from '@/components/docs/figures/proof'
import { AccountsMap, AttestationLayout, ReserveLayout, SolanaTx } from '@/components/docs/figures/solana'
import { DEMO_AUDIENCE, IRONWOOD_ACTIVATION_HEIGHT, IRONWOOD_ACTIVATION_HEIGHT_TESTNET } from '../data/chain'
import { formatInt } from '../format'
import { LINKS } from '../site'
import gateIdl from '../../data/idl/pof_gate.json'
import creditIdl from '../../data/idl/pof_credit.json'
import reserveIdl from '../../data/idl/pof_reserve.json'
import { REPO, mainnet } from './shared'
import type { Doc } from './types'

export const format: Doc = {
  slug: 'format',
  title: 'The proof format',
  lede: 'A .pof file carries one claim, for one audience and period, bound to one context, anchored to the chain, with an expiry and a revocation tag. Version 2 adds “unmoved since block H”, scopes in which reuse is visible, and exit certificates. This page is written so that someone else can implement a verifier against it.',
  sections: [
    {
      id: 'principles',
      title: 'Principles',
      body: (
        <>
          <p>
            <strong>The proof is a file, not an API call.</strong> Every component talks through this artifact. That gives offline verification, a
            testable boundary, and a format that can outlive any one implementation.
          </p>
          <p>
            <strong>No optional semantics.</strong> Every field is always present. Optionality in a security format is how verifiers end up
            disagreeing about what was proven.
          </p>
          <p>
            <strong>The verifier never trusts a field it can derive.</strong> The circuit’s round id, nullifier domain, threshold and both ledger
            roots are recomputed or looked up by the verifier; the file carries only the public inputs it cannot derive.
          </p>
        </>
      ),
    },
    {
      id: 'file',
      title: 'The file',
      body: (
        <>
          <p>
            Binary, then base64url (RFC 4648 §5, no padding) wherever it travels as text or inside a URL. The extension is <C>.pof</C>; a holding
            proof is about 11,900 bytes.
          </p>
          <Code>{` magic      "POF1"                 4 bytes   50 4F 46 31
 version    u16, little-endian     2 bytes   01 00 or 02 00
 body       postcard(Body)         variable
 checksum   blake2b-256(body)      32 bytes`}</Code>
          <FileLayout />
          <p>
            The magic bytes let a verifier reject garbage instantly. The checksum makes a truncated paste distinguishable from a forgery: a forger
            re-seals the checksum, a clipboard does not. The version lives in the header only; the body never repeats it.
          </p>
        </>
      ),
    },
    {
      id: 'body',
      title: 'The body',
      body: (
        <>
          <p>Postcard encoding: integers as LEB128 varints, fixed arrays as raw bytes, vectors as a varint length and elements, enums as a varint tag.</p>
          <p>
            <strong>Version 2</strong> (written by current provers):
          </p>
          <Code>{`circuit      u8         1 = threshold · 2 = threshold + revealed nullifiers (exit certificates)
claim        enum Claim                      (varint tag + fields)
audience     [u8; 32]   blake2b-256("pof-audience:" ‖ lowercase(trim(id)))
epoch        u64        the verifier's period; with circuit and audience it is the scope
binding      [u8; 32]   all zero · a Solana pubkey · blake2b("vouch-intent-v1", deposit intent)
nc_height    u32        the block whose note-commitment tree holds the notes
nc_root      [u8; 32]
height       u32        the block whose spent set does not hold them ("as of")
nf_root      [u8; 32]   nc_height ≤ height; equal unless the proof says "unmoved since"
issued_at    u64
expires_at   u64
revocation   [u8; 16]
evidence     { public_inputs: Vec<[u8; 32]>, proof: Vec<u8>, signature: [u8; 64] }`}</Code>
          <p>
            <strong>Version 1</strong> (still read, and re-encoded byte for byte):
          </p>
          <Code>{`claim        enum Claim                      (varint tag + fields)
audience     [u8; 32]   blake2b-256("pof-audience:" ‖ lowercase(trim(id)))
binding      [u8; 32]   all zero, or e.g. the holder's Solana pubkey
anchor       { height: u32, nc_root: [u8; 32], nf_root: [u8; 32] }
issued_at    u64        unix seconds
expires_at   u64        unix seconds, absolute
revocation   [u8; 16]   blake2b("vouch-revoke-v1", secret)[..16]
evidence     { public_inputs: Vec<[u8; 32]>, proof: Vec<u8>, signature: [u8; 64] }`}</Code>
          <Table
            head={['Field', 'Rule']}
            rows={[
              ['claim', 'Exactly one statement. Never a list. Two facts are two proofs.'],
              ['audience', 'A hash, not a name. The verifier proves it is the audience by matching; nobody else learns who it was for.'],
              ['binding', 'Who may use the proof, for audiences that act on it (a Solana program). All zero when unbound.'],
              ['anchor', 'A height and both ledger roots at that height. The verifier accepts only roots in its authenticated anchor table.'],
              ['expires_at', 'Absolute, not a duration.'],
              ['revocation', 'Opaque. The holder revokes by publishing the secret; see the trust model.'],
              ['evidence', '9 public inputs (15 for circuit 2), the Halo2 proof, and the spend-authorisation signature.'],
              ['epoch', 'Chosen by the verifier in its request. A proof made without one gets a scope of its own, so it links to nothing.'],
              ['nc_height', 'When earlier than height, the notes were already in the chain at nc_height and have not moved since.'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'claims',
      title: 'Claims',
      body: (
        <>
          <Code>{`pub enum Claim {
    HoldsAtLeast         { zatoshi: u64 },                   // tag 0 · v1
    HoldsExactly         { zatoshi: u64 },                   // tag 1 · reserved
    ReceivedPayment      { txid: [u8; 32], zatoshi: u64 },   // tag 2 · roadmap
    ReceivedAtLeastSince { zatoshi: u64, from_height: u32 }, // tag 3 · roadmap
}`}</Code>
          <p>
            v1 verifiers accept <C>HoldsAtLeast</C> only, and only for whole units of <strong>0.125 ZEC</strong> (12,500,000 zatoshi): the circuit
            counts value in those units. 500 ZEC is <C>50000000000</C> zatoshi, 4,000 units. <C>HoldsExactly</C> is deliberately not offered: a
            threshold reveals less.
          </p>
        </>
      ),
    },
    {
      id: 'binding',
      title: 'What binds the file to the proof',
      body: (
        <>
          <p>
            The <strong>statement</strong> is every body field except the evidence. The holder signs it, with every public input, under the key the
            circuit proves controls the notes, so changing any field — the claim, audience, epoch, binding, either anchor height, the expiry —
            fails the signature. In version 1 the circuit’s <C>vote_round_id</C> is also the statement hash. In version 2 it is the{' '}
            <strong>scope</strong>: the circuit, audience and epoch. The same note then yields the same tag inside one scope, so a verifier sees the
            same coins used twice with it, and nobody else can link anything.
          </p>
          <Code>{`statement  = blake2b-256[personal "vouch-stmt-v1"](head)
scope      = blake2b-256[personal "vouch-scope-v2"](circuit ‖ audience ‖ epoch_le)   (version 2)
round_id   = statement (v1) or scope (v2), bits 254..255 cleared, as a Pallas base element
dom        = Poseidon("governance authorization", round_id)
min_units  = claim.zatoshi / 12_500_000
message    = blake2b-256[personal "vouch-sig-v1"](statement ‖ public_inputs)
signature  = RedPallas SpendAuth over message, under rk`}</Code>
          <StatementBinding />
          <p>
            The signature is the holder’s spend authority. Someone who only has the holder’s viewing key can find the notes but cannot sign, so a
            viewing key is not enough to prove funds on someone’s behalf.
          </p>
        </>
      ),
    },
    {
      id: 'circuit',
      title: 'The circuit',
      body: (
        <>
          <p>
            The evidence is a Halo2 proof (IPA over Pasta, K = 12, no trusted setup) of the delegation circuit from{' '}
            <A href={LINKS.votingCircuits}>voting-circuits</A> 0.12.1, with a Vouch modification (described fully in <A href="/docs/circuit">The circuit</A>): a 15th public input, <C>min_ballots</C>, and the
            constraint <C>num_ballots − min_ballots ∈ [0, 2³⁰)</C>. It proves, for up to five of the holder’s notes:
          </p>
          <ul>
            <li>each note is in the Ironwood note-commitment tree at <C>nc_root</C>;</li>
            <li>each note is unspent: its real nullifier is not in the spent-nullifier IMT at <C>nf_root</C> (the nullifier stays private);</li>
            <li>the prover holds the keys the notes are addressed to (<C>rk</C> is a re-randomisation of the notes’ <C>ak</C>);</li>
            <li>the notes together hold at least <C>min_ballots</C> × 0.125 ZEC. The sum itself is committed, never revealed.</li>
          </ul>
          <p>
            The circuit checks each note slot on its own, so it would accept one note placed in several slots and count it more than once.
            Upstream, the vote chain refuses a repeated governance nullifier; Vouch has no chain, so the verifier refuses any proof whose five{' '}
            <C>gov_null</C> values are not all distinct. A repeated note always produces the same one.
          </p>
          <PublicInputs />
          <p>
            Carried public inputs, in order: <C>nf_signed, rk, cmx_new, van_comm, gov_null_1..5</C>. Derived by the verifier: <C>vote_round_id</C>,{' '}
            <C>dom</C>, <C>nc_root</C>, <C>nf_imt_root</C>, <C>min_ballots</C>. The governance nullifiers (tags) are domain-separated per scope and
            unlinkable to the real nullifiers.
          </p>
          <p>
            <C>nc_root</C> and <C>nf_imt_root</C> are independent public inputs. Taking the first at an earlier block than the second proves the
            notes existed then and are unspent now: the tree only grows, and a note moves only by revealing its nullifier.
          </p>
          <p>
            <strong>Circuit 2</strong> (exit certificates) is the same circuit with a second Vouch modification: a boolean <C>reveal</C> (public
            input 15) and <C>reveal × real_nf</C> for each slot (16–20). With <C>reveal = 1</C> the five real nullifiers are public, so a recipient
            can match a deposit to exactly the certified notes; with <C>0</C> they are forced to zero. It has its own verifying key; circuit 1’s is
            unchanged. Carried inputs for circuit 2: the nine above, then <C>reveal, revealed_nf_1..5</C>.
          </p>
        </>
      ),
    },
    {
      id: 'verdict',
      title: 'Verification and verdicts',
      body: (
        <>
          <p>
            Six checks, cheapest first. The verifier stops at the first failure and never runs cryptography on an artifact that failed a cheap
            check. The flowchart and the policy options are in <A href="/docs/verification">The verification pipeline</A>.
          </p>
          <Table
            head={['#', 'Check', 'Failure']}
            rows={[
              ['1', 'Magic, version, checksum, body parse; HoldsAtLeast in whole units', <C key="1">Malformed</C>],
              ['2', 'Now is before expires_at', <C key="2">Expired</C>],
              ['3', 'No published secret hashes to the revocation tag', <C key="3">Revoked</C>],
              ['4', 'blake2b(identifier) equals audience; the epoch is the one the verifier asked for, if it asked', <><C>WrongAudience</C> · <C>WrongScope</C></>],
              [
                '5',
                'The note-commitment root at nc_height and the spent-set root at height are both authenticated; the spent set is fresh enough and the notes unmoved long enough for the verifier’s policy',
                <><C>AnchorNotFound</C> · <C>AnchorTooOld</C> · <C>NotDormantLongEnough</C></>,
              ],
              ['6', 'Distinct tags, the signature under rk, the Halo2 proof against the circuit’s key; then none of the tags is in the verifier’s reuse registry', <><C>ProofInvalid</C> · <C>AlreadyUsed</C></>],
            ]}
          />
          <Code>{`pub enum Verdict {
    Valid { claim: Claim, anchor_height: u32, dormant_since: Option<u32> },
    Expired { at: u64 },
    Revoked,
    WrongAudience,
    AnchorNotFound,
    AnchorTooOld { anchor_height: u32 },
    NotDormantLongEnough { dormant_since: u32, required: u32 },
    WrongScope { epoch: u64, required: u64 },
    AlreadyUsed,
    ProofInvalid { detail: String },
    Malformed { reason: String },
}

pub struct Policy {            // what this verifier additionally requires; all optional
    tip_height: Option<u32>,   // with max_anchor_age: refuse a stale spent set
    max_anchor_age: Option<u32>,
    dormant_since: Option<u32>, // notes unmoved since this block or earlier
    epoch: Option<u64>,         // the period the request named
}`}</Code>
          <p>
            A typed verdict, never a bool. <C>ProofInvalid</C> says the evidence does not prove the statement and not which constraint failed;
            verbose failure detail in a security tool is a debugging aid for an attacker.
          </p>
        </>
      ),
    },
    {
      id: 'anchors',
      title: 'Anchors',
      body: (
        <>
          <p>
            An anchor is a finalised height and two roots: the Ironwood note-commitment tree root and the root of the indexed Merkle tree of every
            Ironwood nullifier revealed up to that height. <C>pof-anchor</C> rebuilds both from compact blocks since Ironwood activation (block{' '}
            {formatInt(IRONWOOD_ACTIVATION_HEIGHT)}), checks the first against lightwalletd’s own tree state, and publishes the pair.
          </p>
          {mainnet && (
            <Code>{`{
  "network": "mainnet",
  "height":  ${mainnet.height},
  "ncRoot":  "${mainnet.ncRoot}",
  "nfRoot":  "${mainnet.nfRoot}"
}`}</Code>
          )}
          <p>
            The table is served at <A href="/api/anchors">/api/anchors</A>. Anyone can re-derive every entry: <C>pof-anchor scan --to &lt;height&gt;</C>.
            The <C>demo</C> anchor belongs to the published demo ledger and is labelled as such wherever it is used.
          </p>
          <p>
            Zcash testnet works the same way (Ironwood from block {formatInt(IRONWOOD_ACTIVATION_HEIGHT_TESTNET)}): <C>pof-anchor scan --network testnet</C>{' '}
            reads <C>testnet.zec.rocks</C> and records <C>network: &quot;testnet&quot;</C>. Verdicts on a testnet anchor say so: the proof is real, the
            coins (TAZ) have no monetary value. The network is recorded in the anchor table, not in the proof or the attestation, so a verifier that
            only wants mainnet should trust only mainnet anchors.
          </p>
        </>
      ),
    },
    {
      id: 'reserves',
      title: 'Reserves batches',
      body: (
        <>
          <p>
            A holder with more than five notes, or a treasury, proves its reserves as a batch: several version 2 proofs in one scope and against one
            anchor, in a <C>.pofb</C> container. The verifier checks every member, refuses a batch in which any tag appears twice (a note counted
            twice), and states the sum. Natively the members’ Halo2 proofs are checked together, with one multi-scalar multiplication.
          </p>
          <Code>{` magic      "POFB"                 4 bytes
 version    u16, little-endian     2 bytes   01 00
 count      u16, little-endian     2 bytes   1 … 64
 members    count × (u32 LE length ‖ a complete POF1 file)
 checksum   blake2b-256 of everything before it`}</Code>
          <PofbLayout />
          <p>
            Check one at <A href="/reserves">/reserves</A>, or with <C>pof-verify check reserves.pofb</C>. On Solana, <C>pof-reserve</C> turns an
            attested batch into a feed that any program can read, and its demo token mints only within the proven total.
          </p>
        </>
      ),
    },
    {
      id: 'json',
      title: 'As JSON',
      body: (
        <>
          <p>
            Every verifier returns the same JSON for a file: the WASM <C>verify()</C>, <C>pof-verify check --json</C> and the attestor’s{' '}
            <C>/v1/verify</C>. It holds the verdict, the six checks in order, the matched anchor record, the proof’s <C>scope</C> and <C>tags</C>
            (for a reuse registry), an exit certificate’s <C>revealed</C> nullifiers, and <C>envelope</C>, the JSON projection
            of the proof itself (hex in lowercase, amounts in zatoshi, times in unix seconds). Its JSON Schema is published at{' '}
            <A href="/schema/pof-v1.json">/schema/pof-v1.json</A>, and CI checks every test vector’s result against it.
          </p>
          <Code>{`{ "verdict":  { "kind": "Valid", "claim": { "kind": "HoldsAtLeast", "zatoshi": 100000000 }, "anchorHeight": 4410000 },
  "checks":   [ { "id": "format", "label": "…", "status": "pass", "detail": "…" }, … ],
  "envelope": { "version": 1, "claim": { … }, "audience": "412a96…", "binding": "0000…", "anchor": { … },
                "issuedAt": 1790622467, "expiresAt": 1800990467, "revocation": "704960c1…", "evidence": { … } },
  "sizeBytes": 11884, "checksum": "c82489…", "anchor": { "network": "testnet", "height": 4410000, … },
  "now": 1790693805, "verifier": "pof-verify 0.1.0" }`}</Code>
        </>
      ),
    },
    {
      id: 'example',
      title: 'Test vectors',
      body: (
        <>
          <p>
            Every preset on <A href="/verify">/verify</A> is a real proof committed in <A href={`${REPO}/tree/main/fixtures`}>fixtures/</A>,
            together with the verdict each must produce. The native verifier, the WASM verifier and the TypeScript codec are all checked against
            that one list in CI.
          </p>
          <p>
            The first, <C>testnet-valid.pof</C>, was made by <C>pof-prove prove</C> from a real Zcash testnet wallet: at least 1 TAZ, as of testnet
            block 4,410,000, for the audience <C>vouch:testnet-demo</C>. Its tampered, forged and re-addressed copies sit beside it. The rest were
            written by <C>pof-prove demo fixtures</C> against the demo ledger, for the audience <C>{DEMO_AUDIENCE.id}</C>.
          </p>
        </>
      ),
    },
  ],
}

export const cli: Doc = {
  slug: 'cli',
  title: 'CLI reference',
  lede: 'Three binaries, one per role: pof-prove for holders, pof-verify for anyone checking, pof-anchor for whoever publishes anchors. Each release ships all three.',
  sections: [
    {
      id: 'install',
      title: 'Install',
      body: (
        <Code>{`curl -fL ${REPO}/releases/latest/download/vouch-linux-x86_64.tar.gz | tar xz   # or vouch-macos-arm64.tar.gz, vouch-windows-x86_64.zip
# or build from source (Rust 1.91+)
git clone ${REPO} && cd Vouch/backend && cargo build --release -p pof-prove -p pof-verify -p pof-anchor`}</Code>
      ),
    },
    {
      id: 'pof-prove',
      title: 'pof-prove',
      body: (
        <>
          <p>The holder’s CLI. Keys stay in this process, it links no network client, and nothing is broadcast.</p>
          <Code>{`pof-prove prove --request <encoded> --snapshot <file.vsnp> --seed-file <path> --out proof.pof [options]`}</Code>
          <Table
            head={['Option', 'Meaning']}
            rows={[
              [<C key="r">--request</C>, 'The encoded request from a /prove link (the r= value, or the whole link).'],
              [<C key="s">--snapshot</C>, 'A snapshot written by pof-anchor scan. Its anchor must be published.'],
              [<C key="f">--seed-file</C>, 'A BIP 39 mnemonic or a hex seed. Read locally; never leaves the process.'],
              [<C key="a">--account</C>, 'ZIP 32 account. Default 0.'],
              [<C key="n">--network</C>, 'mainnet or testnet. Default: the snapshot’s.'],
              [<C key="b">--bind-solana</C>, 'Bind the proof to a Solana account (base58), for on-chain audiences.'],
              [<C key="h">--since</C>, 'Prove the notes were in the chain at this checkpoint (a multiple of 1,000) and unmoved since.'],
              [<C key="z">--batch-size</C>, '1–5. A reserves batch: every usable note, in proofs of up to N notes. Default 5 for reserves requests.'],
              [<C key="e">--exit</C>, 'An exit certificate (circuit 2) that names the notes. Implied by an exit request.'],
              [<C key="i">--intent</C>, 'With --exit: the deposit or quote id it is for. Default: the request id.'],
              [<C key="y">--yes</C>, 'Skip the confirmation prompt.'],
            ]}
          />
          <Table
            head={['Command', 'Does']}
            rows={[
              [<C key="1">pof-prove history [--secrets]</C>, 'Proofs you have made: claim, audience, expiry, status. --secrets also prints revocation secrets.'],
              [<C key="2">pof-prove revoke &lt;id&gt; --endpoint &lt;url&gt;</C>, 'Publish a proof’s revocation secret to the list your verifiers check.'],
              [<C key="3">pof-prove demo prove --world … --request …</C>, 'Answer a request as the demo holder, against the published demo ledger. Takes the same --since, --batch-size and --exit options.'],
              [<C key="4">pof-prove demo init | pool | fixtures</C>, 'Make a demo world, the single-use proof pool for /demo, or every committed test vector.'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'pof-verify',
      title: 'pof-verify',
      body: (
        <>
          <p>The reference verifier. Reads local files only, so it can gate CI or a batch job.</p>
          <Code>{`pof-verify check <file.pof | file.pofb> --audience <id> --anchors anchors.json [options]
pof-verify match --cert certificate.pof --deposit deposit.json`}</Code>
          <Table
            head={['Option', 'Meaning']}
            rows={[
              [<C key="a">--audience</C>, 'Your verifier identifier. Only its hash is compared with the proof.'],
              [<C key="n">--anchors</C>, 'The anchor table: a JSON array of {network, height, ncRoot, nfRoot}.'],
              [<C key="r">--revocations</C>, 'The revocation list: {"secrets": [hex…]} or a bare array.'],
              [<C key="t">--now</C>, 'Evaluate as of this unix time instead of now.'],
              [<C key="d">--dormant-since</C>, 'Require the notes to be unmoved since this block or earlier.'],
              [<C key="h">--tip-height, --max-anchor-age</C>, 'Together: refuse a proof whose spent set is more than N blocks below the tip you know.'],
              [<C key="e">--epoch</C>, 'Require the period your request named, so reuse within it is visible.'],
              [<C key="s">--seen</C>, 'With --epoch: your reuse registry, a JSON array of hex tags already accepted.'],
              [<C key="j">--json</C>, 'Print the full JSON result (the schema at /schema/pof-v1.json).'],
            ]}
          />
          <Table
            head={['Exit code', 'Meaning']}
            rows={[
              ['0', 'Valid (match: matched)'],
              ['1', 'Invalid (match: mismatch)'],
              ['2', 'Expired'],
              ['3', 'Malformed'],
              ['4', 'Could not run: a usage error, an unreadable file, bad JSON'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'pof-anchor',
      title: 'pof-anchor',
      body: (
        <>
          <p>Rebuilds and publishes anchors from public chain data, and reads a deposit’s nullifiers for exit matching.</p>
          <Table
            head={['Command', 'Does']}
            rows={[
              [
                <C key="1">pof-anchor scan [--network mainnet|testnet] [--to H] [--also-at H,…]</C>,
                'Stream every Ironwood action since activation, rebuild both trees, check the tree root, size and block hash against lightwalletd, write the snapshot and merge the anchor into the table. --to defaults to tip − 100, rounded down to 1,000.',
              ],
              [<C key="2">pof-anchor tx --txid &lt;hex&gt; [--network …]</C>, 'The Ironwood nullifiers a mined transaction reveals, as JSON: the input to pof-verify match.'],
              [<C key="3">pof-anchor check --snapshot &lt;file&gt; [--at H]</C>, 'Re-derive a snapshot’s roots and compare them with lightwalletd.'],
            ]}
          />
          <p>
            Every command takes <C>--server</C> to choose the lightwalletd; the defaults are <C>zec.rocks:443</C> and <C>testnet.zec.rocks:443</C>.
            The server must report the same chain as <C>--network</C>, so a testnet anchor can never be published as mainnet.
          </p>
        </>
      ),
    },
  ],
}

export const api: Doc = {
  slug: 'api',
  title: 'HTTP API',
  lede: 'Two services speak HTTP: the attestor (verify, sign, the rail API) and this site (anchors, revocations, status). Bodies are JSON; proofs travel as base64url.',
  sections: [
    {
      id: 'attestor',
      title: 'Attestor',
      body: (
        <>
          <p>
            The hosted one is <C>https://vouch-attest.onrender.com</C>; <A href="/docs/attestor">run your own</A> with the same binary.
          </p>
          <Code lang="http">{`POST /v1/attest    { "proof": "<base64url>", "audience"?: "…" }
→ 200 { "attestation": { "message", "signature", "attestor", "slot" } }  |  422 { "verdict": { "kind": "…" } }

POST /v1/verify    { "proof": "<base64url>", "audience"?: "…" }
→ 200 VerificationResult   (the same JSON as pof-verify --json; nothing signed)

GET  /v1/pubkey     → { "pubkey", "verifier", "vkFingerprint", "audience", "demoProver" }
GET  /v1/anchor/{h} → the anchor records it trusts at height h
GET  /health        → ok`}</Code>
        </>
      ),
    },
    {
      id: 'rail',
      title: 'Rail API',
      body: (
        <>
          <Code lang="http">{`POST /v1/certificates             { "certificate", "audience", "epoch"?, "dormantSince"?, "intent"? }
→ 200 { "status": "pre-cleared", "certificate": { "id", "revealed", "tags", … }, "result": { … } }  |  422 { "status": "refused", … }

GET  /v1/certificates?audience=…  → the rail's certificates, newest first
GET  /v1/certificates/{id}

POST /v1/certificates/{id}/match  { "txid", "network"? }  |  { "nullifiers": ["<hex>", …] }
→ { "status": "matched" | "mismatch", "certificate": { "deposit": { "result": { "kind": "Matched", "spent": 2 } } } }

POST /v1/batch                    { "batch", "audience", "epoch"?, "attest"?: true }
→ BatchResult, plus { "attestation" } for pof-reserve when attest is set and the batch is valid`}</Code>
          <Table
            head={['Setting', 'Effect']}
            rows={[
              [<C key="t">POF_RAIL_TOKEN</C>, 'Every call that writes needs Authorization: Bearer <token>.'],
              [<C key="w">POF_WEBHOOK_URL, POF_WEBHOOK_SECRET</C>, 'Events certificate.precleared, deposit.matched and deposit.mismatch are posted with X-Vouch-Signature: sha256=<hmac of the body>.'],
              [<C key="s">POF_STORE</C>, 'Persist the registry to a JSON file (written atomically). Without it, certificates live in memory.'],
            ]}
          />
          <Hint kind="info">
            <p>The store holds ids, tags, revealed nullifiers, verdicts and times, never proof bytes.</p>
          </Hint>
        </>
      ),
    },
    {
      id: 'site',
      title: 'Site',
      body: (
        <>
          <Table
            head={['Route', 'Does']}
            rows={[
              [<C key="a">GET /api/anchors</C>, 'The published anchor table (mainnet, testnet and the labelled demo anchor).'],
              [<C key="r">GET /api/revocations</C>, '{ "secrets": [hex…] }: every published revocation secret.'],
              [<C key="p">POST /api/revocations</C>, '{ "secret": "<hex>" } publishes a revocation. Only the holder knows the secret.'],
              [<C key="s">GET /api/status</C>, 'What this deployment has configured: attestor, devnet programs, shared store. Nothing secret.'],
              [<C key="t">POST /api/attest</C>, '{ "proof" }: a thin, rate-limited proxy to the attestor’s /v1/attest.'],
              [<C key="f">GET /api/reserve</C>, 'The devnet reserves feed, its token supply and whether it is stale.'],
              [<C key="j">GET /schema/pof-v1.json</C>, 'The JSON Schema every verifier’s result follows.'],
            ]}
          />
          <p>
            <C>/api/relay</C>, <C>/api/demo-prove</C> and the POST side of <C>/api/reserve</C> drive the devnet demo with a demo relayer key. They are
            rate-limited and capped per hour, and are not an API to build on.
          </p>
        </>
      ),
    },
  ],
}

export const solana: Doc = {
  slug: 'solana',
  title: 'Solana programs',
  lede: 'Three Anchor programs carry Vouch verdicts on Solana: pof-gate turns attestations into receipts, pof-credit lends against receipts, and pof-reserve keeps an attested reserves feed. Every instruction, account and error below is generated from the programs’ IDLs.',
  sections: [
    {
      id: 'overview',
      title: 'How they fit together',
      body: (
        <>
          <SolanaTx />
          <AccountsMap />
          <Table
            head={['Program', 'Role', 'Tests']}
            rows={[
              ['pof-gate', 'Ed25519 attestations by introspection, k of n; one receipt per proof, bound to a wallet; consumption by consumer-program PDAs only.', 'replay, wrong key, other message, foreign offsets, late or truncated signatures, stale/future/expired/invalid/unknown, malformed, bound account only, threshold 2 of 3, admin and attestor-set rules, initialize by the upgrade authority only'],
              ['pof-credit', 'Pools, credit lines and draws against receipts, with freshness and refreshes.', 'happy path, draw needs the borrower and the pool mint, one line per receipt, a line per proof, freshness, refresh rules, pool floor and window, mint authority'],
              ['pof-reserve', 'An attested reserves feed and Secure Mint.', 'publish then mint within the reserves, only the issuer mints, a stale feed mints nothing until refreshed, publish refuses what it must'],
            ]}
          />
          <p>26 LiteSVM tests run in CI against the compiled programs.</p>
        </>
      ),
    },
    {
      id: 'attestation',
      title: 'The attestation message',
      body: (
        <>
          <AttestationLayout />
          <p>
            The attestor signs these 139 bytes with Ed25519 only for a Valid verdict on a proof bound to a Solana account. pof-gate parses exactly this
            layout, checks the domain, the verdict and the claim kind, that the slot is within <C>max_age_slots</C> and that <C>expires_at</C> is in
            the future.
          </p>
        </>
      ),
    },
    {
      id: 'introspection',
      title: 'How signatures are checked',
      body: (
        <>
          <p>
            Programs cannot run Ed25519 cheaply themselves, so the transaction carries one Ed25519 precompile instruction per attestor signature
            before the program’s instruction. The program reads those instructions through the Instructions sysvar and counts a signer only when:
          </p>
          <ul>
            <li>the instruction comes before the program’s own instruction;</li>
            <li>every offset in it is <C>u16::MAX</C>, meaning the key, message and signature are inside that same instruction (no pointing into other data);</li>
            <li>the key is on the allowlist and has not been counted already;</li>
            <li>the signed message is byte for byte the one being submitted.</li>
          </ul>
          <p>Only when the count reaches the threshold does the program act. The runtime has already failed the transaction if any signature was bad.</p>
        </>
      ),
    },
    {
      id: 'gate',
      title: 'pof-gate',
      body: <IdlReference idl={gateIdl as Idl} name="pof_gate" />,
    },
    {
      id: 'credit',
      title: 'pof-credit',
      body: <IdlReference idl={creditIdl as Idl} name="pof_credit" />,
    },
    {
      id: 'reserve',
      title: 'pof-reserve',
      body: (
        <>
          <ReserveLayout />
          <IdlReference idl={reserveIdl as Idl} name="pof_reserve" />
        </>
      ),
    },
    {
      id: 'deploy',
      title: 'Deploying',
      body: (
        <>
          <Code>{`POF_ATTEST_URL=https://<attestor> [ATTESTORS=<b58,…>] ./scripts/deploy-devnet.sh`}</Code>
          <p>
            The script builds and deploys under the fixed program ids, copies the IDLs to the site, allowlists the attestor (read from{' '}
            <C>/v1/pubkey</C> when <C>ATTESTORS</C> is unset), creates the credit pool and the reserves feed, and prints the site’s environment. The
            admin keeps the upgrade authority, which <C>initialize</C> requires. Local validators load pof-gate as an upgradeable program for the
            same reason.
          </p>
        </>
      ),
    },
  ],
}

export const performance: Doc = {
  slug: 'performance',
  title: 'Performance and limits',
  lede: 'How long things take, how big they are, and the hard limits of the current design. Every number here was measured on the code in this repository; where it was measured is stated.',
  sections: [
    {
      id: 'glance',
      title: 'At a glance',
      body: (
        <Stats>
          <Stat label="Proof" value="11.9 KB" note="11,884–11,898 bytes" />
          <Stat label="Reserves batch, 3 proofs" value="35.7 KB" note="reserves.pofb" />
          <Stat label="WASM verifier" value="4.6 MB" note="loaded once, in a worker" />
          <Stat label="Attestor memory" value="33 MB" note="Render, 0.1 CPU" />
        </Stats>
      ),
    },
    {
      id: 'verify',
      title: 'Verification',
      body: (
        <>
          <BarChart
            title="Time to verify"
            unit="ms"
            bars={[
              { label: 'WASM, one proof', value: 93, note: 'Node, after warm-up; testnet dormancy proof' },
              { label: 'Native CLI, one proof', value: 130, note: 'whole process, including key loading; median of 3' },
              { label: 'Native CLI, batch of 3', value: 148, note: 'batched Halo2 check; median of 3' },
              { label: 'WASM, batch of 3', value: 277, note: 'members checked one by one in WASM' },
              { label: 'WASM warm-up', value: 330, note: 'once per page: parameters and verifying keys; measured 24 Sep 2026' },
            ]}
            caption="Measured 11 October 2026 unless noted: native on a 12-core Intel Core 5 210H under WSL; WASM in Node 24 through the committed build (pnpm test:wasm)."
          />
          <p>
            Natively, a batch of three costs barely more than one proof, because the openings of all members are checked in one multi-scalar
            multiplication. In WASM the members are checked one by one.
          </p>
        </>
      ),
    },
    {
      id: 'hosted',
      title: 'The hosted attestor',
      body: (
        <>
          <BarChart
            title="Hosted attestor on Render’s free plan (0.1 CPU)"
            unit="s"
            decimals={1}
            bars={[
              { label: 'Verify a proof', value: 0.3 },
              { label: 'Rail certificate', value: 0.4, note: 'verify under policy, record tags' },
              { label: 'Reserves batch + attestation', value: 2.0 },
              { label: 'Deposit match', value: 3.4, note: 'includes the testnet lightwalletd round trip' },
            ]}
            caption="Measured on the deployed container. A proof takes about 119 s at this CPU, which is why the hosted attestor does not prove and /demo uses pre-made proofs."
          />
        </>
      ),
    },
    {
      id: 'proving',
      title: 'Proving',
      body: (
        <>
          <Stats>
            <Stat label="Demo-ledger proof" value="1.4 s" note="12 cores, native" />
            <Stat label="Same proof at 0.1 CPU" value="~119 s" note="Render free" />
            <Stat label="Mainnet actions scanned" value="565,704" note="to block 3,493,000" />
          </Stats>
          <p>
            A real-wallet proof adds trial decryption of every Ironwood action in the snapshot, which runs in parallel; the Halo2 proof itself is
            the same size of work whatever the wallet.
          </p>
        </>
      ),
    },
    {
      id: 'limits',
      title: 'Hard limits',
      body: (
        <Table
          head={['Limit', 'Value', 'Why', 'Workaround']}
          rows={[
            ['Notes per proof', '5', 'The delegation circuit has five slots', 'A reserves batch, or consolidate first'],
            ['Value unit', '0.125 ZEC', 'The circuit counts ballots of 12,500,000 zatoshi', 'Round thresholds up'],
            ['Claims', 'HoldsAtLeast', 'Payment and “received since” claims are designed, not built', '—'],
            ['Batch members', '64', 'The .pofb count field', 'Several batches'],
            ['Attestors per program', '8', 'MAX_ATTESTORS', '—'],
            ['Request expiry', '1–365 days', 'Request validation', '—'],
            ['Unmoved-since block', 'a multiple of 1,000', 'Snapshots keep a checkpoint every 1,000 blocks', 'Pick the checkpoint at or before H'],
            ['Attestor request body', '64 KiB (2 MiB for batches)', 'Bounded memory per request', '—'],
          ]}
        />
      ),
    },
  ],
}
