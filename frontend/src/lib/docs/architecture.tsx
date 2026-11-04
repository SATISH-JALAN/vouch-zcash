import { A, C, Code, H3, Hint, Table } from '@/components/docs/content'
import { CrateGraph, DeployTopology, SystemOverview } from '@/components/docs/figures/overview'
import { AnchorPipeline } from '@/components/docs/figures/chain'
import { PublicInputs, RevocationFlow, StatementBinding, ThreeHosts, VerifyPipeline } from '@/components/docs/figures/proof'
import { IRONWOOD_ACTIVATION_HEIGHT, IRONWOOD_ACTIVATION_HEIGHT_TESTNET } from '../data/chain'
import { formatInt } from '../format'
import { LINKS } from '../site'
import { ANCHORS, MAINNET_H, REPO, mainnet } from './shared'
import type { Doc } from './types'

export const architecture: Doc = {
  slug: 'architecture',
  title: 'System architecture',
  lede: 'Vouch is a file format and the small set of programs that write it, check it and act on it. This page maps every component, what it depends on, what it talks to, and where it runs.',
  sections: [
    {
      id: 'overview',
      title: 'Components',
      body: (
        <>
          <SystemOverview />
          <Table
            head={['Component', 'Role', 'Runs where', 'Network']}
            rows={[
              [<C key="1">pof-anchor</C>, 'Rebuilds the note tree and nullifier IMT from compact blocks; writes snapshots; publishes anchors.', 'Whoever publishes anchors', 'lightwalletd (gRPC)'],
              [<C key="2">pof-prove</C>, 'Finds the holder’s notes in a snapshot, proves the claim, signs it, writes the .pof.', 'The holder’s machine', 'none (library); revoke only'],
              [<C key="3">pof-verify</C>, 'The verifier library and CLI: six checks, typed verdicts.', 'Anywhere', 'none'],
              [<C key="4">pof-wasm</C>, 'pof-verify compiled to WebAssembly with the verifying key embedded.', 'The browser, in a Web Worker', 'none'],
              [<C key="5">pof-attest</C>, 'HTTP service: verify, sign attestations for Solana, the rail API, reserves attestations.', 'Render (hosted), or anyone', 'Solana RPC, revocation list, lightwalletd'],
              [<C key="6">pof-gate</C>, 'Solana program: attestations in, receipts out.', 'Solana devnet', '—'],
              [<C key="7">pof-credit</C>, 'Solana program: credit lines against receipts.', 'Solana devnet', '—'],
              [<C key="8">pof-reserve</C>, 'Solana program: reserves feed and Secure Mint.', 'Solana devnet', '—'],
              ['The site', 'Next.js: verifier, request builder, prover console, rail console, reserves, the live demo, these docs, and a thin API.', 'Vercel', 'the attestor, Solana RPC, Redis'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'crates',
      title: 'The Rust workspace',
      body: (
        <>
          <CrateGraph />
          <Table
            head={['Crate', 'Key entry points', 'Notes']}
            rows={[
              [<C key="1">pof-core</C>, 'encode · decode · statement_hash · signing_message · audience_hash · revocation_tag · subject_hash', 'The format. Decoding is injective: canonical varints, checked lengths, timestamps ≤ 2⁵³ − 1.'],
              [<C key="2">pof-zk</C>, 'Verifier::new · verify_holding · instance_for · round_id · NoteTree · prove_holding (feature prove)', 'Embedded params and verifying keys; refuses repeated tags before Halo2.'],
              [<C key="3">pof-verify</C>, 'verify(bytes, &Context) → VerificationResult · verify_batch · exit_matches', 'The single source of verdicts.'],
              [<C key="4">pof-prove</C>, 'select_notes · envelope_for · prove · wallet::find_notes · DemoWorld · history', 'A test fails the build if the library links a network client.'],
              [<C key="5">pof-anchor</C>, 'Snapshot::{read, write, anchor} · Lightwalletd::scan · publish', 'The only crate with a gRPC client.'],
              [<C key="6">pof-attest</C>, 'attest · verify_only · rail::{submit, match_deposit, batch} · demo::prove', 'Axum; per-core semaphore; 64 KiB body limit (2 MiB for batches).'],
              [<C key="7">pof-wasm</C>, 'warm · verify · version', 'wasm-bindgen, about 4.6 MB, committed so CI tests exactly what ships.'],
            ]}
          />
          <p>
            The vendored crates are in <C>backend/vendor/</C>; every Vouch change is listed in <A href={`${REPO}/blob/main/THIRD-PARTY.md`}>THIRD-PARTY.md</A>{' '}
            and in each crate’s <C>VOUCH-MODIFICATIONS.md</C>. The Solana programs are a separate Anchor workspace in <C>backend/solana/</C>.
          </p>
        </>
      ),
    },
    {
      id: 'repo',
      title: 'Repository layout',
      body: (
        <Table
          head={['Path', 'What it is']}
          rows={[
            [<C key="1">frontend/</C>, 'The site (Next.js 15): pages, the API routes, the committed WASM verifier, these docs.'],
            [<C key="2">backend/crates/</C>, 'The seven Rust crates above.'],
            [<C key="3">backend/vendor/</C>, 'voting-circuits and its dependencies, with marked Vouch modifications.'],
            [<C key="4">backend/solana/</C>, 'pof-gate, pof-credit, pof-reserve (Anchor) and the LiteSVM tests.'],
            [<C key="5">fixtures/</C>, 'Real proofs with their expected verdicts, anchor tables, the demo ledger, request vectors.'],
            [<C key="6">scripts/</C>, 'WASM build, fixture sync, the WASM parity check, end-to-end test, local stack, devnet deploy.'],
            [<C key="7">.github/workflows/</C>, 'CI (every test but e2e), release builds of the CLIs, the attestor keepalive.'],
          ]}
        />
      ),
    },
    {
      id: 'flows',
      title: 'Data flows',
      body: (
        <Table
          head={['Flow', 'From → to', 'Carries', 'Never carries']}
          rows={[
            ['Anchors', 'lightwalletd → pof-anchor → anchor table → every verifier', 'heights, roots, block hashes', '—'],
            ['Request', 'verifier → holder (a link)', 'claim, audience id, expiry, period, policy', 'anything about the holder'],
            ['Proof', 'holder → verifier (a file or link)', 'the statement and the evidence', 'balance, notes, addresses, keys'],
            ['Verify link', 'holder → anyone', 'the proof after the #', 'nothing reaches a server log'],
            ['Attestation', 'attestor → Solana', '139 signed bytes', 'proof bytes'],
            ['Rail API store', 'attestor ↔ rail', 'ids, tags, revealed nullifiers, verdicts, times', 'proof bytes'],
            ['Revocation', 'holder → list → verifiers', 'a 32-byte secret', 'which proof it was, to anyone else'],
          ]}
        />
      ),
    },
    {
      id: 'deploy',
      title: 'The hosted deployment',
      body: (
        <>
          <DeployTopology />
          <Table
            head={['Piece', 'Where', 'Notes']}
            rows={[
              ['Site and API', 'Vercel', 'Deployed from frontend/. Upstash Redis holds revocations, used demo proofs, rate limits and hourly relayer budgets.'],
              ['Attestor', 'Render, free plan', 'render.yaml builds pof-attest without the demo prover (one proof takes about 2 minutes on 0.1 CPU); /demo uses 120 pre-made single-use proofs instead.'],
              ['Programs', 'Solana devnet', 'Fixed program ids; the admin keeps the upgrade authority, which initialize requires.'],
              ['CLIs', 'GitHub Releases', 'Built for Linux, macOS (arm64) and Windows from each v* tag.'],
            ]}
          />
          <Hint kind="info">
            <p>
              Free Render instances sleep after 15 minutes idle. The site’s <C>/api/status</C> reports a sleeping attestor as waking, and /demo waits
              for it rather than falling back to the simulated chain.
            </p>
          </Hint>
        </>
      ),
    },
    {
      id: 'principles',
      title: 'Design principles',
      body: (
        <ul>
          <li><strong>The proof is a file, not an API call.</strong> Offline verification, a testable boundary, a format that outlives any implementation.</li>
          <li><strong>One verifier.</strong> The CLI, the browser and the attestor run the same code; CI proves they agree.</li>
          <li><strong>The verifier never trusts a field it can derive.</strong> Roots, round id, domain and threshold are recomputed or looked up.</li>
          <li><strong>Keys stay put.</strong> The prover links no network client; nothing is broadcast.</li>
          <li><strong>Boring, plural attestors.</strong> Stateless, re-runnable, allowlisted, k-of-n.</li>
          <li><strong>Honest labels.</strong> Demo, testnet and simulated are said wherever they apply.</li>
        </ul>
      ),
    },
  ],
}

export const circuit: Doc = {
  slug: 'circuit',
  title: 'The circuit',
  lede: 'Vouch’s proofs are Halo2 proofs of the Ironwood delegation circuit, with two small, marked modifications: a threshold for every proof, and revealed nullifiers for exit certificates.',
  sections: [
    {
      id: 'base',
      title: 'The base circuit',
      body: (
        <>
          <p>
            The evidence in a <C>.pof</C> is a Halo2 proof (IPA commitments over the Pasta curves, K = 12, no trusted setup) of the delegation
            circuit from <A href={LINKS.votingCircuits}>voting-circuits</A> 0.12.1 by Valar Group, driven the way{' '}
            <A href={LINKS.zcashVoting}>zcash_voting</A> (Chainapsis) drives it. Upstream, holders used it to delegate voting weight in the NU7 poll.
            For up to five notes it proves:
          </p>
          <ul>
            <li>each note is a leaf of the Ironwood note-commitment tree at <C>nc_root</C>;</li>
            <li>each note is unspent: its real nullifier is not in the spent-nullifier IMT at <C>nf_imt_root</C>, and the nullifier stays private;</li>
            <li>the prover holds the keys the notes are addressed to: <C>rk</C> is a re-randomisation of the notes’ <C>ak</C>;</li>
            <li>each note yields a governance nullifier (a tag) under the domain <C>dom</C>, derived from <C>vote_round_id</C>.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'threshold',
      title: 'Modification 1: the threshold',
      body: (
        <>
          <p>
            Upstream the circuit hides the value sum and enforces only that the notes are worth at least one ballot (0.125 ZEC). Vouch adds a 15th
            public input, <C>min_ballots</C> (offset 14), and one range constraint:
          </p>
          <Code lang="text">{`num_ballots − min_ballots ∈ [0, 2³⁰)        num_ballots = Σ note values / 12,500,000 (committed, not revealed)
min_ballots = claim.zatoshi / 12,500,000    (derived by the verifier from the claim)`}</Code>
          <p>
            So the proof says “at least <C>min_ballots</C> × 0.125 ZEC” and nothing more. The test <C>vouch_threshold</C> in the vendored crate
            checks it, together with the upstream suite.
          </p>
        </>
      ),
    },
    {
      id: 'reveal',
      title: 'Modification 2: revealed nullifiers (circuit 2)',
      body: (
        <>
          <p>
            Exit certificates need the rail to match a deposit to the certified notes. Circuit 2 adds a boolean <C>reveal</C> (offset 15) and five{' '}
            <C>revealed_nf_i</C> (offsets 16–20), with two gates:
          </p>
          <Code lang="text">{`revealed_nf_i − reveal · real_nf_i = 0      for each slot i
reveal · (1 − reveal) = 0                  reveal is 0 or 1`}</Code>
          <p>
            With <C>reveal = 1</C> the five real nullifiers are public; with <C>0</C> they are forced to zero. It uses the same configuration, so it
            still fits K = 12, but it is a different circuit with <strong>its own verifying key</strong> (<C>vk-reveal.bin</C>). Circuit 1’s
            verifying key and parameters are byte-identical to before, so every existing proof still verifies. The test <C>vouch_reveal</C> covers
            reveal on and off, a forged revealed nullifier, and a flag of 2.
          </p>
        </>
      ),
    },
    {
      id: 'inputs',
      title: 'Public inputs',
      body: (
        <>
          <PublicInputs />
          <p>
            The file carries only what the verifier cannot derive: <C>nf_signed, rk, cmx_new, van_comm, gov_null_1..5</C> (nine 32-byte values;{' '}
            <C>rk</C> is one compressed point that fills two circuit inputs), and for circuit 2 <C>reveal, revealed_nf_1..5</C>.{' '}
            <C>pof-zk::instance_for</C> assembles the full instance from those, the statement and the anchor.
          </p>
        </>
      ),
    },
    {
      id: 'binding',
      title: 'What binds the file to the proof',
      body: (
        <>
          <StatementBinding />
          <Code lang="text">{`statement  = blake2b-256[personal "vouch-stmt-v1"](head)
scope      = blake2b-256[personal "vouch-scope-v2"](circuit ‖ audience ‖ epoch_le)   (version 2)
round_id   = statement (v1) or scope (v2), bits 254..255 cleared, as a Pallas base element
dom        = Poseidon("governance authorization", round_id)
min_units  = claim.zatoshi / 12_500_000
message    = blake2b-256[personal "vouch-sig-v1"](statement ‖ public_inputs)
signature  = RedPallas SpendAuth over message, under rk
subject    = blake2b-256[personal "vouch-subject-v1"](statement)                      (the proof id)`}</Code>
        </>
      ),
    },
    {
      id: 'distinct',
      title: 'One note, one slot',
      body: (
        <Hint kind="warning" title="A finding the verifier closes">
          <p>
            The circuit checks each of the five slots on its own, so on its own it would accept one note placed in several slots and count its value
            more than once. Upstream, the vote chain refuses a repeated governance nullifier. Vouch has no chain, so <C>pof-zk</C> refuses any proof
            whose five tags are not all distinct, before Halo2 runs; a repeated note always produces the same tag. A real-proof test checks that a
            note counted five times is refused.
          </p>
        </Hint>
      ),
    },
    {
      id: 'keys',
      title: 'Keys and parameters',
      body: (
        <Table
          head={['File', 'What it is', 'Guarded by']}
          rows={[
            [<C key="1">pof-zk/keys/params-k12.bin</C>, 'The IPA parameters for K = 12.', 'embedded_vk_matches_keygen'],
            [<C key="2">pof-zk/keys/vk-delegation.bin</C>, 'Circuit 1’s verifying key.', 'embedded_vk_matches_keygen'],
            [<C key="3">pof-zk/keys/vk-reveal.bin</C>, 'Circuit 2’s verifying key.', 'embedded_vk_matches_keygen'],
          ]}
        />
      ),
    },
  ],
}

const anchorRows = ANCHORS.slice()
  .sort((a, b) => a.network.localeCompare(b.network) || a.height - b.height)
  .map((a) => [a.network, formatInt(a.height), <C key={`${a.network}${a.height}r`}>{a.ncRoot.slice(0, 16)}…</C>, <C key={`${a.network}${a.height}n`}>{a.nfRoot.slice(0, 16)}…</C>])

export const anchorsDoc: Doc = {
  slug: 'anchors',
  title: 'Anchors and chain data',
  lede: 'A verifier accepts a proof only if its two roots are in the verifier’s anchor table. This page explains how those roots are built from public data, checked, published and re-derived.',
  sections: [
    {
      id: 'what',
      title: 'What an anchor is',
      body: (
        <>
          <p>
            An anchor is a finalised height and two roots: the Ironwood note-commitment tree root and the root of the indexed Merkle tree of every
            Ironwood nullifier revealed up to that height. Records look like this:
          </p>
          {mainnet && (
            <Code>{`{
  "network":   "mainnet",
  "height":    ${mainnet.height},
  "blockHash": "${mainnet.blockHash ?? '…'}",
  "ncRoot":    "${mainnet.ncRoot}",
  "nfRoot":    "${mainnet.nfRoot}"
}`}</Code>
          )}
        </>
      ),
    },
    {
      id: 'pipeline',
      title: 'How an anchor is built',
      body: (
        <>
          <AnchorPipeline />
          <ol>
            <li>Connect to lightwalletd and read the tip. The anchor height is <C>floor((tip − 100) / 1000) × 1000</C>, so it is finalised and on a checkpoint.</li>
            <li>Stream every compact block from Ironwood activation (mainnet {formatInt(IRONWOOD_ACTIVATION_HEIGHT)}, testnet {formatInt(IRONWOOD_ACTIVATION_HEIGHT_TESTNET)}). Each Ironwood action carries a nullifier, a note commitment, an ephemeral key and a 52-byte compact ciphertext.</li>
            <li>Build the note tree from every commitment and the dense IMT from every nullifier.</li>
            <li>Check the tree root, its size and the block hash against lightwalletd’s own tree state. A mismatch stops the scan.</li>
            <li>Write the snapshot (<C>.vsnp</C>) with a checkpoint every 1,000 blocks, and merge the record into <C>anchors.&lt;network&gt;.json</C>. Publishing refuses a different record at a height already published.</li>
          </ol>
        </>
      ),
    },
    {
      id: 'snapshot',
      title: 'Snapshots',
      body: (
        <p>
          A snapshot is everything a prover needs, from public data only: every action’s nullifier, commitment and encrypted output up to a height,
          and (version 2) a checkpoint table every 1,000 blocks plus the last block. Provers trial-decrypt it to find their notes, and take the tree
          at an earlier checkpoint for “unmoved since” proofs. Reading is bounds-checked and never panics. The mainnet snapshot at {formatInt(MAINNET_H)} is about 84 MB.
        </p>
      ),
    },
    {
      id: 'published',
      title: 'Published anchors',
      body: (
        <>
          <p>
            The table served at <A href="/api/anchors">/api/anchors</A> merges the mainnet, testnet and demo tables. Earlier testnet heights are
            there for “unmoved since” proofs.
          </p>
          <Table head={['Network', 'Height', 'nc_root', 'nf_root']} rows={anchorRows} />
        </>
      ),
    },
    {
      id: 'rederive',
      title: 'Re-derive any entry',
      body: (
        <>
          <Code>{`pof-anchor scan --to ${MAINNET_H}                 # mainnet, from zec.rocks
pof-anchor scan --network testnet --to 4410000
pof-anchor scan --network testnet --to 4459000 --also-at 4410000   # earlier checkpoints of the same scan
pof-anchor check --snapshot target/snapshots/testnet-4459000.vsnp --at 4410000`}</Code>
          <p>
            A wrong entry cannot make a false proof pass: the roots must match the proof’s own public inputs. It can only make honest proofs fail.
            That is why an anchor table is trusted for availability, not for truth.
          </p>
        </>
      ),
    },
    {
      id: 'networks',
      title: 'Testnet and mainnet',
      body: (
        <p>
          The network is recorded in the anchor table, not in the proof or the attestation. <C>pof-anchor</C> refuses a lightwalletd that reports a
          different chain than <C>--network</C>, so a testnet anchor cannot be published as mainnet, and verdicts on a testnet anchor say so. A
          verifier that only wants mainnet should load only mainnet anchors.
        </p>
      ),
    },
  ],
}

export const verification: Doc = {
  slug: 'verification',
  title: 'The verification pipeline',
  lede: 'One function decides every verdict: pof-verify::verify. This page walks through its six checks, the verdicts they produce, the policy a verifier can add, and the three places it runs.',
  sections: [
    {
      id: 'pipeline',
      title: 'Six checks, cheapest first',
      body: (
        <>
          <VerifyPipeline />
          <Table
            head={['#', 'Check', 'Fails as']}
            rows={[
              ['1', 'Magic, version, length limits, checksum, decode; HoldsAtLeast in whole 0.125 ZEC units', 'Malformed { reason }'],
              ['2', 'now < expires_at (equality is expired, as on Solana)', 'Expired { at }'],
              ['3', 'No published secret hashes to the revocation tag', 'Revoked'],
              ['4', 'blake2b(identifier) equals audience; the epoch is the one requested, if any', 'WrongAudience · WrongScope'],
              ['5', 'The tree root at nc_height and the spent-set root at height are both in the table; the spent set fresh enough; the notes unmoved long enough', 'AnchorNotFound · AnchorTooOld · NotDormantLongEnough'],
              ['6', 'Five distinct tags; the RedPallas signature under rk; the Halo2 proof against the circuit’s key; then no tag in the registry', 'ProofInvalid · AlreadyUsed'],
            ]}
          />
          <p>
            <C>ProofInvalid</C> says the evidence does not prove the statement, not which constraint failed: verbose failure detail in a security
            tool is a debugging aid for an attacker.
          </p>
        </>
      ),
    },
    {
      id: 'context',
      title: 'Context and policy',
      body: (
        <>
          <Code lang="rust">{`pub struct Context<'a> {
    audience: &'a str,               // your identifier; only its hash is compared
    anchors: &'a [AnchorRecord],     // the table you trust
    revoked_secrets: &'a [String],   // published secrets, hex
    now: u64,
    zk: &'a ZkVerifier,              // the embedded verifying keys
    policy: Policy,
    seen: &'a [String],              // your reuse registry: tags accepted in this scope
}

pub struct Policy {              // all optional
    tip_height: Option<u32>,     // with max_anchor_age: refuse a stale spent set
    max_anchor_age: Option<u32>,
    dormant_since: Option<u32>,  // notes unmoved since this block or earlier
    epoch: Option<u64>,          // the period your request named
}`}</Code>
          <p>
            Everything the verifier needs is passed in: it reads no files and makes no network calls, which is what lets it run unchanged in a browser.
          </p>
        </>
      ),
    },
    {
      id: 'verdicts',
      title: 'Verdicts',
      body: (
        <Code lang="rust">{`pub enum Verdict {
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
}`}</Code>
      ),
    },
    {
      id: 'hosts',
      title: 'Three hosts',
      body: (
        <>
          <ThreeHosts />
          <H3>In the browser</H3>
          <p>
            The site lazily loads <C>/wasm/pof_wasm.js</C> in a Web Worker. <C>warm()</C> loads the embedded parameters and verifying key (about
            330 ms, once); each verification then takes about 90 ms. The page fetches <C>/api/anchors</C> and <C>/api/revocations</C>, calls{' '}
            <C>verify(bytes, audience, now, anchorsJson, revokedJson)</C> and renders the JSON result. A verify link carries the proof after the{' '}
            <C>#</C>, so it never reaches a server.
          </p>
          <H3>The CLI</H3>
          <p>
            <C>pof-verify check</C> reads local files only and turns the verdict into an exit code: 0 valid, 1 invalid, 2 expired, 3 malformed, 4
            could not run.
          </p>
          <H3>The attestor</H3>
          <p>
            <C>pof-attest</C> runs the same <C>verify</C> under a per-core semaphore (429 when busy), with revocations from a static file and the
            site’s list (cached for 10 s, a 4 s timeout, keeping the last list on failure). It signs only a Valid verdict bound to a Solana account.
          </p>
        </>
      ),
    },
    {
      id: 'json',
      title: 'The JSON result',
      body: (
        <>
          <p>
            Every host returns the same JSON: the verdict, the six checks in order, the matched anchor record, the proof’s <C>scope</C> and{' '}
            <C>tags</C>, an exit certificate’s <C>revealed</C> nullifiers, and <C>envelope</C>, the JSON projection of the proof (hex in lowercase,
            amounts in zatoshi, times in unix seconds). Its JSON Schema is at <A href="/schema/pof-v1.json">/schema/pof-v1.json</A>, and CI checks
            every vector’s result against it.
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
      id: 'revocation',
      title: 'Revocation',
      body: <RevocationFlow />,
    },
    {
      id: 'parity',
      title: 'How agreement is tested',
      body: (
        <Table
          head={['Test', 'What it proves']}
          rows={[
            [<C key="1">pof-verify tests/fixtures.rs</C>, 'The native verdict for every committed vector equals expected.json.'],
            [<C key="2">pnpm test:wasm</C>, 'The committed WASM build gives the same verdicts, and every result matches the JSON Schema.'],
            [<C key="3">pnpm test:fixtures</C>, 'The TypeScript codec parses the Rust encoder’s bytes; request-link rules agree in both languages.'],
            [<C key="4">embedded_vk_matches_keygen</C>, 'The embedded verifying keys equal a fresh keygen.'],
          ]}
        />
      ),
    },
  ],
}
