import { A, C, Card, Cards, Code, Hint, Stat, Stats, Step, Steps, Table } from '@/components/docs/content'
import { ProofLifecycle, SystemOverview } from '@/components/docs/figures/overview'
import { DormancyTimeline, ScopeTags, TreeAndNullifiers } from '@/components/docs/figures/chain'
import { MatchFigure } from '@/components/docs/figures/rails'
import { DEMO_AUDIENCE } from '../data/chain'
import { LINKS } from '../site'
import { REPO, SITE } from './shared'
import type { Doc } from './types'

export const introduction: Doc = {
  slug: 'introduction',
  title: 'Introduction',
  lede: 'Vouch is the disclosure layer for shielded Zcash. Instead of handing over a viewing key, a holder proves one fact about their coins, to one party, and reveals nothing else. Anyone can check the proof against the public chain, in about a tenth of a second.',
  sections: [
    {
      id: 'why',
      title: 'The problem',
      body: (
        <>
          <p>
            Shielded ZEC is private until it has to leave. At a swap rail, an exchange or an OTC desk, screeners cannot score shielded coins:
            there is no address history to look at. A large shielded deposit therefore lands as “unknown”, and unknown deposits get held.
          </p>
          <p>
            Today the only thing a holder can offer to get one released is a <strong>viewing key</strong>. A viewing key shows every note,
            amount and memo the wallet has ever received, and everything it will receive, to whoever holds the key, for ever. It cannot be scoped
            and it cannot be revoked. It is the opposite of what a shielded pool is for.
          </p>
          <p>
            Lenders and treasuries have the same problem from the other side. A lender cannot see collateral it cannot verify; a treasury holding
            shielded ZEC cannot show its users the reserves without showing them the wallet.
          </p>
        </>
      ),
    },
    {
      id: 'answer',
      title: 'What Vouch does',
      body: (
        <>
          <p>
            Vouch replaces the viewing key with a <strong>single-purpose proof</strong>: a file of about 12 KB that states exactly one fact, for
            exactly one verifier, until one date, and that can be revoked. The proof is a zero-knowledge proof over the chain’s own data, so the
            verifier needs nothing from the holder but the file, and nothing from anyone else but public chain data.
          </p>
          <SystemOverview />
          <p>
            Nothing is bridged. The coins never leave Zcash and are never locked; only a proof moves. Where the party that needs the fact is a
            Solana program, which cannot verify a Zcash proof itself, an attestor runs the same open-source verifier and signs its verdict, and the
            program checks that signature.
          </p>
        </>
      ),
    },
    {
      id: 'lines',
      title: 'Three products, one engine',
      body: (
        <>
          <Table
            head={['Product', 'The fact proven', 'Who checks it', 'Status']}
            rows={[
              [<strong key="e">Exit certificates</strong>, '“At least X ZEC, in notes already in the chain at block H and unmoved since, and these are the notes I am sending you.”', 'A swap rail, exchange or desk, before it releases a deposit', 'Real on testnet'],
              [<strong key="p">Proof of funds</strong>, '“At least X ZEC”, to one named verifier, until one expiry, revocable; reuse of the same coins with that verifier in one period is visible to it.', 'A lender, an OTC desk, a Solana program', 'Real on testnet; devnet credit flow'],
              [<strong key="r">Reserves</strong>, 'Several proofs summed with no note counted twice, published as a Solana feed that a token can only mint within.', 'A treasury’s users, a wrapped-ZEC issuer', 'Demo ledger; devnet feed'],
            ]}
          />
          <p>
            All three are the same proof with different options. An exit certificate is a proof that also reveals which notes it covers, so the
            rail can match the deposit. A reserves batch is several proofs in one file. Proof of funds is the plain case.
          </p>
        </>
      ),
    },
    {
      id: 'why-zcash',
      title: 'Why this only works on Zcash',
      body: (
        <>
          <ul>
            <li>
              <strong>The note-commitment tree is a clock.</strong> It only grows, so “this note was a leaf at block H” is a permanent, public fact
              about the past.
            </li>
            <li>
              <strong>The nullifier set is a “not moved” proof.</strong> A note can only be spent by revealing its nullifier, so “its nullifier is
              not in the set at block H₁” means it has not moved.
            </li>
            <li>
              <strong>Spend authority can be shown without spending.</strong> The proof is signed by the key that controls the notes; a viewing key
              alone cannot make one.
            </li>
            <li>
              <strong>The circuit already exists.</strong> Vouch uses the Ironwood delegation circuit from Valar Group’s{' '}
              <A href={LINKS.votingCircuits}>voting-circuits</A>, the one the community used for the NU7 poll, with one added constraint.
            </li>
          </ul>
          <p>Unlike association-set schemes, no provider decides which coins are acceptable: the chain’s own history is the allow-list, and the verifier picks the block.</p>
        </>
      ),
    },
    {
      id: 'numbers',
      title: 'At a glance',
      body: (
        <Stats>
          <Stat label="Proof size" value="11.9 KB" note="one .pof file" />
          <Stat label="Verify in a browser" value="~93 ms" note="WASM, after warm-up" />
          <Stat label="Notes per proof" value="up to 5" note="more: a batch" />
          <Stat label="Trusted setup" value="none" note="Halo2 over Pasta" />
        </Stats>
      ),
    },
    {
      id: 'paths',
      title: 'Where to start',
      body: (
        <Cards>
          <Card href="/docs/quickstart" title="Quick start">
            Check a real Zcash testnet proof in your browser and with the CLI, in five minutes.
          </Card>
          <Card href="/docs/concepts" title="Core concepts">
            Notes, anchors, audiences, scopes, tags: the words the rest of the docs use.
          </Card>
          <Card href="/docs/rail" title="I run a rail or exchange">
            Ask for exit certificates, check them under your policy, match deposits.
          </Card>
          <Card href="/docs/prove" title="I hold shielded ZEC">
            Answer a request from your own wallet without your keys leaving your machine.
          </Card>
          <Card href="/docs/architecture" title="I want the architecture">
            Components, crates, data flows and the hosted deployment.
          </Card>
          <Card href="/docs/trust" title="I need to know the trust model">
            Exactly what is trusted, by whom, and what Vouch cannot do.
          </Card>
        </Cards>
      ),
    },
    {
      id: 'real',
      title: 'What is real today',
      body: (
        <>
          <ul>
            <li>
              A real proof from a real <strong>Zcash testnet</strong> wallet: at least 1 TAZ at block 4,410,000. Check it on{' '}
              <A href="/verify">/verify</A>.
            </li>
            <li>A real testnet proof that 1 TAZ has been unmoved since block 4,410,000, as of 4,459,000, and a younger note refused.</li>
            <li>
              A real testnet exit certificate matched against a real deposit (<C>ff0a2488…</C>) that spends exactly the certified notes. The first
              attempt, which had dummy spends, is kept as a documented mismatch.
            </li>
            <li>Reserves batches: 4,018.125 ZEC across three proofs on the demo ledger, and a double-counted note refused.</li>
            <li>
              <C>pof-gate</C>, <C>pof-credit</C> and <C>pof-reserve</C> deployed on Solana devnet, driven end to end from <A href="/demo">/demo</A>{' '}
              and <A href="/reserves">/reserves</A>.
            </li>
            <li>One Rust verifier, compiled natively and to WASM, agreeing on every test vector in CI; 26 LiteSVM tests of the programs, including the attacks.</li>
          </ul>
          <Hint kind="warning" title="A hackathon build">
            <p>
              Not audited: not the circuit changes, not the programs, not the attestor. Testnet only. Read <A href="/docs/trust">Where trust still sits</A>{' '}
              and <A href="/docs/threats">Threat model</A> before relying on anything here.
            </p>
          </Hint>
        </>
      ),
    },
  ],
}

export const quickstart: Doc = {
  slug: 'quickstart',
  title: 'Quick start',
  lede: 'Check a real Zcash testnet proof three ways: in the browser, with the CLI, and on Solana devnet. Then make a proof of your own with the demo ledger. No wallet and no ZEC needed.',
  sections: [
    {
      id: 'browser',
      title: 'In the browser',
      body: (
        <Steps>
          <Step title="Open the verifier">
            <p>
              Go to <A href="/verify">/verify</A>. The verifier is the same Rust code as the CLI, compiled to WASM and run in a Web Worker; it checks
              the proof in your tab and sends it nowhere.
            </p>
          </Step>
          <Step title="Pick “A real Zcash testnet proof”">
            <p>
              It holds at least 1 TAZ, from a real testnet wallet as of block 4,410,000, valid until 26 January 2027. The six checks run in order
              and the verdict is <strong>Valid</strong>, with a note that TAZ has no monetary value.
            </p>
          </Step>
          <Step title="Read what it reveals">
            <p>
              Under the verdict, the page lists what the proof shows (the claim, the block, the audience, the expiry) and what it does not (the
              balance, which notes, how many, any address).
            </p>
          </Step>
          <Step title="Break it">
            <p>
              Try the tampered, forged, expired, revoked and re-addressed presets. Each is refused at the check that catches it, and says why. The
              dormancy presets show “unmoved since” passing and failing.
            </p>
          </Step>
        </Steps>
      ),
    },
    {
      id: 'cli',
      title: 'With the CLI',
      body: (
        <>
          <p>
            Download <C>pof-verify</C> from the <A href={`${REPO}/releases/latest`}>latest release</A> (Linux x86-64, macOS on Apple silicon,
            Windows; a SHA-256 beside every archive), then fetch the public anchor table, the revocation list and the proof:
          </p>
          <Code>{`curl -fL ${REPO}/releases/latest/download/vouch-linux-x86_64.tar.gz | tar xz
curl -s ${SITE}/api/anchors     > anchors.json
curl -s ${SITE}/api/revocations > revocations.json
curl -sO ${SITE}/proofs/testnet-valid.pof

pof-verify check testnet-valid.pof --audience vouch:testnet-demo \\
           --anchors anchors.json --revocations revocations.json`}</Code>
          <Code title="Output">{`Valid · 1.00000000 TAZ at least · anchor 4410000 (testnet)
NOTE: Zcash testnet. A real proof over real testnet notes, but TAZ has no monetary value: it says nothing about mainnet funds.
  format     pass     POF1 · version 1 · 11,884 bytes · checksum ok
  expiry     pass     Valid until 2027-01-26 19:07 UTC — 107 days left.
  revocation pass     Tag 704960c1… is not on the revocation list (2 revoked).
  audience   pass     blake2b("vouch:testnet-demo") matches the audience field.
  anchor     pass     Block 4,410,000 (testnet): note-commitment root and nullifier-set root both match.
  proof      pass     Halo2 proof and spend-authorisation signature verify for this exact statement.`}</Code>
          <p>
            The exit code is the verdict: <C>0</C> valid, <C>1</C> invalid, <C>2</C> expired, <C>3</C> malformed, <C>4</C> could not run. Ask as
            someone else and it is refused before any cryptography runs:
          </p>
          <Code>{`pof-verify check testnet-valid.pof --audience someone-else --anchors anchors.json
# Invalid · made for a different verifier          (exit 1)`}</Code>
          <p>The dormancy proof adds one requirement, the block the notes must be unmoved since:</p>
          <Code>{`curl -sO ${SITE}/proofs/testnet-dormant.pof
pof-verify check testnet-dormant.pof --audience vouch:testnet-demo --anchors anchors.json --dormant-since 4410000
# Valid · 1.00000000 TAZ at least · anchor 4459000 (testnet) · unmoved since block 4410000`}</Code>
        </>
      ),
    },
    {
      id: 'demo-proof',
      title: 'Make a proof without ZEC',
      body: (
        <>
          <p>
            The demo ledger is a published, synthetic Ironwood tree with five real notes under a real key: 4,018.2 ZEC. Proofs against it are real
            proofs; their anchor is labelled <C>demo</C> everywhere. Build a request at <A href="/request">/request</A> (or use the one below), then:
          </p>
          <Code>{`git clone ${REPO} && cd Vouch/backend
cargo run --release -p pof-prove -- demo prove --world ../fixtures/demo-world.json \\
      --request '<the link from /request>' --out proof.pof
cargo run --release -p pof-verify -- check proof.pof --audience ${DEMO_AUDIENCE.id} \\
      --anchors ../fixtures/anchors.demo.json
# Valid · 500.00000000 ZEC at least · anchor 3491040 (demo)`}</Code>
          <p>On a 12-core laptop the demo proof takes about 1.4 s. The same demo holder answers the “Prove as the demo holder” button on /prove when the hosted attestor has CPU to spare.</p>
        </>
      ),
    },
    {
      id: 'solana',
      title: 'On Solana devnet',
      body: (
        <>
          <p>
            Open <A href="/demo">/demo</A> and press <strong>Run all</strong>. A real proof is checked in your browser, the attestor signs the
            verdict, <C>pof-gate</C> records a receipt on devnet, and <C>pof-credit</C> opens a 25,000 dUSDC credit line you can draw 1,000 dUSDC
            from. Every account links to the explorer. The toggles on the left break it on purpose: a flipped proof byte, a flipped attestation
            byte, an attestor outage.
          </p>
          <Hint kind="info">
            <p>
              The hosted attestor runs on a free host that sleeps when idle. The first visit can take up to a minute while it wakes; the page says
              so and starts live once it answers.
            </p>
          </Hint>
        </>
      ),
    },
    {
      id: 'next',
      title: 'Next',
      body: (
        <Cards>
          <Card href="/docs/prove" title="Prove with your own wallet">
            Install the prover, build a chain snapshot, answer a request.
          </Card>
          <Card href="/docs/integration" title="Accept proofs">
            Verify with the CLI, in the browser or on Solana.
          </Card>
          <Card href="/docs/how-it-works" title="How it works">
            The chain facts, the circuit, scopes and exits, with diagrams.
          </Card>
          <Card href="/docs/cli" title="CLI reference">
            Every command and flag of the three binaries.
          </Card>
        </Cards>
      ),
    },
  ],
}

export const concepts: Doc = {
  slug: 'concepts',
  title: 'Core concepts',
  lede: 'The vocabulary of the rest of the docs: what a note is, where its truth lives on chain, and the handful of fields that make a proof single-purpose.',
  sections: [
    {
      id: 'notes',
      title: 'Notes and the Ironwood pool',
      body: (
        <>
          <p>
            Shielded ZEC is held as <strong>notes</strong>: encrypted records of a value addressed to a key. A wallet’s balance is the sum of its
            unspent notes. Since July 2026 the active shielded pool is <strong>Ironwood</strong>, which replaced Orchard after the Orchard
            counterfeiting flaw; Ironwood activated at mainnet block 3,428,143 and testnet block 4,134,000. Vouch proves facts about Ironwood notes.
          </p>
          <p>
            The chain never shows a note. It shows two things about each one: a <strong>note commitment</strong> (<C>cmx</C>) when the note is
            created, and a <strong>nullifier</strong> when it is spent.
          </p>
        </>
      ),
    },
    {
      id: 'tree',
      title: 'The note-commitment tree and the spent set',
      body: (
        <>
          <p>
            Every note commitment ever created is a leaf of an append-only Merkle tree; its root at a height is <C>nc_root</C>. Every nullifier ever
            revealed is in the <strong>spent set</strong>, which Vouch arranges as an indexed Merkle tree (IMT) of sorted ranges; its root is{' '}
            <C>nf_root</C>.
          </p>
          <TreeAndNullifiers />
          <p>
            A proof shows, for each of up to five notes, a Merkle path to <C>nc_root</C> (the note exists) and an IMT range that excludes its
            nullifier (the note is unspent), without revealing the note, the path or the nullifier.
          </p>
        </>
      ),
    },
    {
      id: 'anchor',
      title: 'Anchors',
      body: (
        <p>
          An <strong>anchor</strong> is a finalised height and the two roots at it. A verifier accepts a proof only if both of its roots appear in
          the verifier’s anchor table. Vouch’s <C>pof-anchor</C> rebuilds the roots from public compact blocks and checks the tree root against
          lightwalletd’s own; anyone can re-derive every entry. See <A href="/docs/anchors">Anchors and chain data</A>.
        </p>
      ),
    },
    {
      id: 'claim',
      title: 'The claim and its units',
      body: (
        <>
          <p>
            Each proof carries exactly one claim. Today that is <C>HoldsAtLeast {'{ zatoshi }'}</C>: the notes together hold at least that much.
            The circuit counts value in units of <strong>0.125 ZEC</strong> (12,500,000 zatoshi), so thresholds are whole multiples of 0.125 ZEC.
            The sum itself is committed inside the proof and never revealed. “Exactly X” is deliberately not offered: a threshold reveals less.
          </p>
          <Table
            head={['Threshold', 'Zatoshi', 'Units']}
            rows={[
              ['1 ZEC (or TAZ)', '100000000', '8'],
              ['500 ZEC', '50000000000', '4,000'],
              ['4,018.125 ZEC', '401812500000', '32,145'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'fields',
      title: 'The fields that make a proof single-purpose',
      body: (
        <Table
          head={['Field', 'What it does']}
          rows={[
            [<strong key="a">Audience</strong>, 'The verifier the proof is for, stored as blake2b("pof-audience:" ‖ id). Only that verifier, matching its own identifier, accepts it; nobody else learns who it was for.'],
            [<strong key="e">Expiry</strong>, 'An absolute time. From that second on, every verifier answers Expired.'],
            [<strong key="b">Binding</strong>, 'Who may use the proof: all zero (anyone holding the file), a Solana public key (only that wallet can act on the receipt), or a deposit intent for an exit certificate.'],
            [<strong key="r">Revocation tag</strong>, '16 bytes of blake2b of a secret only the holder has. Publishing the secret revokes the proof everywhere the list is checked.'],
            [<strong key="h">Two heights</strong>, 'nc_height (the tree) and height (the spent set). When the first is earlier, the proof says “unmoved since nc_height”.'],
            [<strong key="p">Epoch</strong>, 'The verifier’s period, chosen in its request. With the circuit and audience it forms the scope.'],
          ]}
        />
      ),
    },
    {
      id: 'scope',
      title: 'Scopes and tags',
      body: (
        <>
          <p>
            Each note in a proof produces a <strong>tag</strong> (the circuit calls it a governance nullifier). In format version 2 tags are
            derived from the <strong>scope</strong>: the circuit, the audience and the epoch. The same note always gives the same tag in one scope,
            and unrelated tags in different scopes.
          </p>
          <ScopeTags />
          <p>
            So a verifier that records tags sees when the same coins are pledged to it twice in a period (<C>AlreadyUsed</C>), and two verifiers can
            never link their proofs to each other. A proof made without an epoch gets a fresh scope of its own and links to nothing.
          </p>
        </>
      ),
    },
    {
      id: 'dormancy',
      title: 'Unmoved since block H',
      body: (
        <p>
          Because the two roots are separate inputs, a proof can take the tree at an earlier block H₀ and the spent set at a later block H₁. It then
          says the notes were already in the chain at H₀ and have not moved since. The verifier chooses H₀ in its policy, for example a block before
          a known incident. See <A href="/docs/how-it-works#dormancy">How it works</A>.
        </p>
      ),
    },
    {
      id: 'exit',
      title: 'Exit certificates',
      body: (
        <p>
          An exit certificate is a proof made with the second circuit, which also reveals the certified notes’ real nullifiers. When the deposit
          lands, the rail reads the nullifiers the deposit transaction reveals and checks they are all certified. See <A href="/docs/rail">Exit certificates</A>.
        </p>
      ),
    },
    {
      id: 'solana-terms',
      title: 'Attestations, receipts and feeds',
      body: (
        <Table
          head={['Term', 'Meaning']}
          rows={[
            [<strong key="1">Attestation</strong>, 'A 139-byte message (POF-ATTEST-v1) signed with Ed25519 by an attestor that ran the verifier and got Valid.'],
            [<strong key="2">Receipt</strong>, 'A pof-gate account created from an attestation, one per proof id, bound to the holder’s wallet. Consumer programs read it.'],
            [<strong key="3">Consumed</strong>, 'A receipt a consumer program has used, through a CPI only that program’s PDA can sign. A receipt is consumed once.'],
            [<strong key="4">Feed</strong>, 'A pof-reserve account holding an attested reserves total, with a heartbeat after which it reads as stale.'],
          ]}
        />
      ),
    },
    {
      id: 'networks',
      title: 'Demo, testnet and mainnet',
      body: (
        <Table
          head={['Network', 'What it is', 'Where it appears']}
          rows={[
            ['demo', 'A published synthetic ledger with real keys and real proofs. Lets anyone see a real proof without ZEC.', 'The /demo credit flow, most /verify presets, reserves demo'],
            ['testnet', 'Zcash testnet: real chain, real wallet, TAZ with no monetary value.', 'The real dormancy proof, the real exit, the first real proof'],
            ['mainnet', 'Zcash mainnet. The anchor at 3,493,000 is rebuilt and checked; no mainnet proof has been made.', 'The anchor table'],
          ]}
        />
      ),
    },
  ],
}

export const howItWorks: Doc = {
  slug: 'how-it-works',
  title: 'How it works',
  lede: 'A proof stands on three facts the Zcash chain already keeps. Vouch proves them about your notes without showing the notes, binds the proof to one statement, and carries the verdict wherever it is needed.',
  sections: [
    {
      id: 'lifecycle',
      title: 'The life of a proof',
      body: (
        <>
          <ProofLifecycle />
          <p>
            Four parties, and only files between them. The verifier writes a request (a link). The holder’s prover reads public chain data and the
            holder’s seed, and writes a proof. The verifier checks the proof against public roots. Nothing is sent to a server that the holder does
            not choose to send, and nothing on chain changes.
          </p>
        </>
      ),
    },
    {
      id: 'facts',
      title: 'Three facts the chain keeps',
      body: (
        <>
          <Table
            head={['Chain data', 'What it proves', 'In the proof']}
            rows={[
              ['Note-commitment tree', 'A note existed at a block: the tree only grows.', 'Each note is a leaf under nc_root at nc_height.'],
              ['Nullifier set', 'A note has not been spent: spending reveals its nullifier.', 'Each note’s nullifier is absent from the set at nf_root.'],
              ['Spend authority', 'Who controls the notes.', 'A RedPallas signature under a re-randomisation of the notes’ key.'],
            ]}
          />
          <TreeAndNullifiers />
        </>
      ),
    },
    {
      id: 'circuit',
      title: 'The proof',
      body: (
        <>
          <p>
            The proof is the Ironwood delegation circuit from Valar Group’s <A href={LINKS.votingCircuits}>voting-circuits</A> 0.12.1, the circuit
            the NU7 poll used to let holders delegate voting weight without revealing their notes. Upstream it proves only that the notes hold some
            value. Vouch adds one public input, <C>min_ballots</C>, and one constraint, so it proves the notes hold at least a public minimum. Halo2
            over the Pasta curves (K = 12), so there is no trusted setup.
          </p>
          <ul>
            <li>Up to five notes per proof; value counts in units of 0.125 ZEC; unused slots are filled, so the count is hidden too.</li>
            <li>The statement (claim, audience, expiry, binding, heights, period) is signed with the notes’ spend authority, so no field can be edited after proving.</li>
            <li>A viewing key alone cannot make a proof: it can find the notes but cannot sign.</li>
          </ul>
          <p>
            Details, with the binding and public-input diagrams, are in <A href="/docs/circuit">The circuit</A>.
          </p>
        </>
      ),
    },
    {
      id: 'dormancy',
      title: 'Unmoved since block H',
      body: (
        <>
          <DormancyTimeline />
          <p>
            The tree root and the spent-set root are independent public inputs. Taking the tree at an earlier block H₀ and the spent set at a later
            block H₁ proves the notes were already in the chain at H₀ and have not moved by H₁. No circuit change was needed: only the verifier’s
            rule that tied the two heights together was relaxed, with a check that <C>nc_height ≤ height</C>.
          </p>
          <p>
            The prover refuses a note created after H₀ with a clear error before any proving starts; the verifier answers{' '}
            <C>NotDormantLongEnough</C> when a proof’s H₀ is later than the verifier requires.
          </p>
        </>
      ),
    },
    {
      id: 'scope',
      title: 'Scopes and reuse',
      body: (
        <>
          <ScopeTags />
          <p>
            In format version 2 the circuit’s round id is the scope hash, so each note’s tag is stable within a scope and unlinkable across scopes.
            A verifier passes its registry of accepted tags to the verifier; a repeat is <C>AlreadyUsed</C>, judged only after the proof itself
            verifies. Reserves batches use the same tags to refuse a note counted twice across members.
          </p>
        </>
      ),
    },
    {
      id: 'exit',
      title: 'Exit certificates',
      body: (
        <>
          <MatchFigure />
          <p>
            Circuit 2 adds a reveal flag and the notes’ real nullifiers as public inputs. With the flag on, the certificate names the exact notes;
            when the deposit lands, the rail reads its nullifiers from the chain and checks every one was certified. Circuit 2 has its own verifying
            key; circuit 1 is byte-for-byte unchanged. See <A href="/docs/rail">Exit certificates</A>.
          </p>
        </>
      ),
    },
    {
      id: 'verify',
      title: 'Verification',
      body: (
        <p>
          One Rust function, <C>pof-verify::verify</C>, runs six checks cheapest first and returns a typed verdict. It runs as a CLI, as WASM in
          the browser and inside the attestor, and CI checks all three agree on every test vector. See <A href="/docs/verification">The verification pipeline</A>.
        </p>
      ),
    },
    {
      id: 'solana',
      title: 'Getting to Solana',
      body: (
        <>
          <p>
            A Solana program cannot verify Halo2 over Pallas or read Zcash state. So an attestor runs the same verifier and signs the verdict with
            Ed25519, and the programs check that signature through instruction introspection:
          </p>
          <Table
            head={['Program', 'Does']}
            rows={[
              ['pof-gate', 'Allowlisted, k-of-n attestations become one receipt per proof, bound to the holder’s wallet.'],
              ['pof-credit', 'Opens a credit line from a receipt; draws only while the line’s latest proof is fresh.'],
              ['pof-reserve', 'An attested reserves batch becomes a feed; its token mints only within the proven total, only while fresh.'],
            ]}
          />
          <p>
            See <A href="/docs/solana">Solana programs</A> for every instruction, account and error, and <A href="/docs/credit">Credit lines</A> for the flow.
          </p>
        </>
      ),
    },
  ],
}
