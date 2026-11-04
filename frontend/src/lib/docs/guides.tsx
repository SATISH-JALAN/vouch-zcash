import { A, C, Code, H3, Hint, Step, Steps, Table } from '@/components/docs/content'
import { ProverPipeline } from '@/components/docs/figures/proof'
import { BatchFigure, ExitSequence, FeedStates, MatchFigure, ReservesSequence } from '@/components/docs/figures/rails'
import { AccountsMap, CreditSequence, ReserveLayout, SolanaTx } from '@/components/docs/figures/solana'
import { DEMO_AUDIENCE, ED25519_PROGRAM } from '../data/chain'
import gateIdl from '../../data/idl/pof_gate.json'
import creditIdl from '../../data/idl/pof_credit.json'
import reserveIdl from '../../data/idl/pof_reserve.json'
import { ATTESTOR, MAINNET_H, REPO } from './shared'
import type { Doc } from './types'

export const prove: Doc = {
  slug: 'prove',
  title: 'Answering a request',
  lede: 'For holders: from a request link to a proof in the verifier’s hands, without your keys, your balance or your history leaving your machine.',
  sections: [
    {
      id: 'overview',
      title: 'What happens',
      body: (
        <>
          <ProverPipeline />
          <p>
            The prover is a single binary. It reads three things: the request, a public chain snapshot, and your seed. It writes one file. It never
            connects to anything while proving; the only command that touches the network is <C>pof-prove revoke</C>, and only when you run it.
          </p>
        </>
      ),
    },
    {
      id: 'request',
      title: 'Read the request',
      body: (
        <>
          <p>
            A request is a link to <C>/prove?r=…</C>. The <C>r</C> value is base64url JSON, and the whole request is in it; nothing is stored on a
            server. Open the link at <A href="/prove">/prove</A> to read, in plain sentences, what the verifier will and will not learn.
          </p>
          <Table
            head={['Field', 'Meaning', 'Rule']}
            rows={[
              [<C key="1">v</C>, 'Request format version', 'must be 1'],
              [<C key="2">id</C>, 'Request id; the default deposit intent for an exit', 'hex'],
              [<C key="3">claim · zatoshi</C>, 'The threshold, as a decimal string', 'HoldsAtLeast; a multiple of 0.125 ZEC'],
              [<C key="4">audience</C>, 'The verifier’s identifier', 'printable ASCII'],
              [<C key="5">expiryDays</C>, 'How long the proof stays valid', '1–365 days'],
              [<C key="6">respondBy</C>, 'Optional deadline for an answer', 'unix seconds'],
              [<C key="7">bind</C>, 'solana: bind the proof to your Solana account', 'optional'],
              [<C key="8">kind</C>, 'exit (an exit certificate) or reserves (a batch)', 'optional'],
              [<C key="9">epoch</C>, 'The verifier’s period: reuse within it is visible to them', 'optional'],
              [<C key="10">dormantSince</C>, 'The block your notes must be unmoved since', 'a multiple of 1,000'],
            ]}
          />
          <p>The same rules are implemented in Rust and TypeScript and checked against one shared vector file in CI.</p>
        </>
      ),
    },
    {
      id: 'install',
      title: '1 · Install the prover',
      body: (
        <>
          <p>
            Each <A href={`${REPO}/releases/latest`}>release</A> has pof-prove, pof-verify and pof-anchor for macOS (Apple silicon), Linux and
            Windows, with a SHA-256 beside every archive.
          </p>
          <Code>{`curl -fL ${REPO}/releases/latest/download/vouch-linux-x86_64.tar.gz | tar xz   # or vouch-macos-arm64.tar.gz, vouch-windows-x86_64.zip
# or with Rust 1.91 or newer
cargo install --git ${REPO} pof-prove --locked
# or from source
git clone ${REPO} && cd Vouch/backend && cargo build --release -p pof-prove`}</Code>
        </>
      ),
    },
    {
      id: 'snapshot',
      title: '2 · Get the chain snapshot',
      body: (
        <>
          <p>
            The prover needs the public Ironwood data up to a published anchor: every note commitment and nullifier, and the encrypted outputs your
            wallet finds its notes in. Build it yourself from any lightwalletd:
          </p>
          <Code>{`cargo install --git ${REPO} pof-anchor --locked
pof-anchor scan --server https://zec.rocks:443 --to ${MAINNET_H}
# ✓ nc_root matches lightwalletd's Ironwood tree state at ${MAINNET_H}`}</Code>
          <p>
            It writes <C>target/snapshots/mainnet-&lt;height&gt;.vsnp</C>. The anchor it prints must match one in the verifier’s table, or the
            verifier answers <C>AnchorNotFound</C>. On testnet add <C>--network testnet</C>: the server, the start height and the table switch, and
            pof-prove takes the network (ZIP 32 coin type 1) from the snapshot.
          </p>
        </>
      ),
    },
    {
      id: 'prove',
      title: '3 · Review, then prove',
      body: (
        <>
          <Code>{`pof-prove prove --request <encoded> --snapshot target/snapshots/mainnet-${MAINNET_H}.vsnp \\
                --seed-file ~/.vouch/seed.txt --out proof.pof

  ✓ account 0 on mainnet
  ✓ 565,704 Ironwood actions to block ${MAINNET_H}
  ✓ 2 notes found
  ✓ anchor at block ${MAINNET_H}
  ✓ 1 note used; balance not revealed
  wrote proof.pof (11,886 bytes). Nothing was broadcast.`}</Code>
          <p>
            The seed file holds a BIP 39 mnemonic or a hex seed. The prover prints the same sentence as /prove and asks before doing anything. It
            picks the fewest notes that clear the bar, largest first, up to five, and fails fast if the best five cannot.
          </p>
          <H3>Variants</H3>
          <Table
            head={['You want', 'Add']}
            rows={[
              ['A proof a Solana program can use', <C key="1">--bind-solana &lt;your pubkey&gt;</C>],
              ['“Unmoved since block H”', <C key="2">--since &lt;H&gt;</C>],
              ['An exit certificate', <C key="3">--exit [--intent &lt;deposit id&gt;]</C>],
              ['A reserves batch (more than five notes)', <C key="4">--batch-size 5 --out reserves.pofb</C>],
            ]}
          />
          <Hint kind="warning" title="Exits: send from exactly the certified notes">
            <p>
              An exit certificate names its notes. Send the deposit from those notes in a transaction with no dummy spends, or the rail will see a
              nullifier the certificate never named and answer mismatch. Make the certificate only when you are ready to send.
            </p>
          </Hint>
        </>
      ),
    },
    {
      id: 'handover',
      title: '4 · Check it, hand it over',
      body: (
        <p>
          Drop proof.pof on <A href="/prove">/prove</A> or <A href="/verify">/verify</A>: you see exactly the verdict the other side will see. Then
          send the file, or the verify link, which carries the proof after the <C>#</C> so it never reaches a server log.
        </p>
      ),
    },
    {
      id: 'revoke',
      title: '5 · Revoke it',
      body: (
        <>
          <Code>{`pof-prove history                     # your proofs: claim, audience, expiry, status
pof-prove revoke <id> --endpoint https://vouch-zcash.vercel.app/api/revocations`}</Code>
          <p>
            Revoking publishes the proof’s 32-byte revocation secret. Every verifier that checks the list answers <C>Revoked</C> from then on.
            History is saved with owner-only permissions; if saving fails, the secret is printed so it is never lost.
          </p>
        </>
      ),
    },
    {
      id: 'demo',
      title: 'No ZEC? The demo ledger',
      body: (
        <p>
          <C>pof-prove demo prove --world fixtures/demo-world.json --request …</C> answers any request as the demo holder: 4,018.2 ZEC in five real
          Ironwood notes under a real key, in a published demo tree. The proofs are real; the anchor is labelled <C>demo</C> everywhere it appears.
        </p>
      ),
    },
  ],
}

export const integration: Doc = {
  slug: 'integration',
  title: 'Accepting a proof',
  lede: 'For verifiers: one verifier implementation, three ways to run it. Pick the one that fits where your decision is made.',
  sections: [
    {
      id: 'choose',
      title: 'Choose where to verify',
      body: (
        <Table
          head={['Where your decision is made', 'Use', 'Trust added']}
          rows={[
            ['A script, a back office, CI', 'pof-verify CLI', 'none'],
            ['A web page', 'pof-wasm in a Web Worker', 'none'],
            ['A Solana program', 'an attestor + pof-gate', 'the attestor allowlist (k of n)'],
            ['A rail’s deposit flow', 'the rail API on an attestor you run', 'none, if you run it'],
          ]}
        />
      ),
    },
    {
      id: 'request',
      title: '1 · Ask for a proof',
      body: (
        <>
          <p>
            Build a request at <A href="/request">/request</A>: the threshold, your identifier, an expiry, and optionally a period (so reuse shows),
            an unmoved-since block, a response deadline, and a binding to the holder’s Solana account. Hand the link to the holder.
          </p>
          <Hint kind="info" title="Choosing an identifier">
            <p>
              Your identifier is what proofs are addressed to, and only its hash travels. Use something stable and specific, like{' '}
              <C>lender:acme-desk</C>; a proof made for anyone else is refused at check 4.
            </p>
          </Hint>
        </>
      ),
    },
    {
      id: 'cli',
      title: '2 · Verify with the CLI',
      body: (
        <>
          <Code>{`curl -s ${'$'}SITE/api/anchors     > anchors.json
curl -s ${'$'}SITE/api/revocations > revocations.json
pof-verify check proof.pof --audience ${DEMO_AUDIENCE.id} \\
           --anchors anchors.json --revocations revocations.json \\
           --epoch 202610 --seen registry.json --dormant-since 4410000
# Valid · 500.00000000 ZEC at least · anchor 3491040
echo $?   # 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run`}</Code>
          <p>
            With <C>--json</C> it prints the full result, including the tags to append to your registry. It reads local files only, so it can gate
            CI or a batch job.
          </p>
        </>
      ),
    },
    {
      id: 'wasm',
      title: '3 · Verify in the browser',
      body: (
        <>
          <p>
            <C>pof-wasm</C> is the same Rust crate compiled with wasm-bindgen. Its verifying keys are embedded (a native test proves they equal a
            fresh keygen), so it warms up in about 300 ms and verifies in about 90 ms. The boundary is pure: bytes, the anchor table and the
            revocation list in; a verdict out.
          </p>
          <Code>{`import init, { verify } from '/wasm/pof_wasm.js'

await init()
const anchors = await (await fetch('/api/anchors')).text()
const revoked = JSON.stringify((await (await fetch('/api/revocations')).json()).secrets)
const now = BigInt(Math.floor(Date.now() / 1000))
const result = JSON.parse(verify(bytes, '${DEMO_AUDIENCE.id}', now, anchors, revoked))
if (result.verdict.kind !== 'Valid') refuse(result.verdict)`}</Code>
          <p>Run it in a Web Worker, as the site does, so the warm-up never blocks the page.</p>
        </>
      ),
    },
    {
      id: 'solana',
      title: '4 · Verify on Solana',
      body: (
        <>
          <SolanaTx />
          <p>
            A Solana program cannot verify a Halo2 proof over Pallas or read Zcash state. So <C>pof-attest</C> runs the verifier and signs a
            domain-separated 139-byte message, and <C>pof-gate</C> checks that signature through instruction introspection:
          </p>
          <Code lang="text">{`ix 0  ${ED25519_PROGRAM}   verify(attestor, message, signature)
ix 1  pof-gate::submit_attestation(subject, message)
        1. parse and domain-check; verdict = Valid; claim kind known
        2. slot within max_age_slots; expires_at in the future
        3. count distinct allowlisted keys that signed exactly this message in
           earlier Ed25519 instructions whose offsets all point into themselves
        4. count ≥ threshold (k of n)
        5. create ClaimReceipt PDA [b"receipt", subject]   ← one proof, one receipt`}</Code>
          <p>
            A consumer program reads the receipt, checks the audience, the claim value, the expiry and that the signer is the{' '}
            <strong>beneficiary</strong>, then calls <C>mark_consumed</C> by CPI, signed by the beneficiary and by the consumer program’s own{' '}
            <C>[b&quot;consumer&quot;]</C> PDA. <C>pof-credit</C> is the worked example: see <A href="/docs/credit">Credit lines</A>.
          </p>
          <Table
            head={['Program', 'Devnet id']}
            rows={[
              ['pof-gate', <C key="g">{gateIdl.address}</C>],
              ['pof-credit', <C key="c">{creditIdl.address}</C>],
              ['pof-reserve', <C key="r">{reserveIdl.address}</C>],
            ]}
          />
          <p>
            Read the <A href="/docs/trust">trust model</A> before you rely on it, and <A href="/docs/attestor">run your own attestor</A>.
          </p>
        </>
      ),
    },
    {
      id: 'checklist',
      title: 'Integration checklist',
      body: (
        <ul>
          <li>Load only the anchors you trust (mainnet only, if you only accept mainnet).</li>
          <li>Fetch the revocation list at decision time, not once at start-up.</li>
          <li>Name a period in your requests and keep a registry of accepted tags, or reuse is invisible to you.</li>
          <li>Set <C>--tip-height</C> and <C>--max-anchor-age</C> when “unspent” must be recent.</li>
          <li>Treat anything but Valid as a refusal, and show the holder the verdict’s reason.</li>
          <li>Ask for a fresh proof at each decision: a proof is “as of” one block.</li>
        </ul>
      ),
    },
  ],
}

export const rail: Doc = {
  slug: 'rail',
  title: 'Exit certificates',
  lede: 'For a swap rail, an exchange or a desk that receives shielded ZEC: ask for a certificate, check it under your own policy, and match the deposit when it lands. Vouch returns evidence; you decide.',
  sections: [
    {
      id: 'flow',
      title: 'The flow',
      body: (
        <>
          <ExitSequence />
          <p>
            Two checks, at two moments. Before the deposit: is the certificate valid under your policy (amount, period, unmoved-since block, no
            reuse)? After the deposit lands: does the transaction spend exactly the certified notes? The first gives you a pre-cleared deposit to
            expect; the second ties that deposit to the evidence.
          </p>
        </>
      ),
    },
    {
      id: 'policy',
      title: 'Choose a policy',
      body: (
        <Table
          head={['Knob', 'What it buys you', 'Typical choice']}
          rows={[
            ['Threshold', 'Covers the deposit you expect', 'The quote amount, rounded up to 0.125 ZEC'],
            ['Unmoved since H', 'The coins predate an incident and have not moved since', 'A block before the incident you care about'],
            ['Max anchor age', 'The “not moved” fact is recent', 'Small: a few hundred blocks'],
            ['Period (epoch)', 'The same coins certified twice to you show as AlreadyUsed', 'This month'],
            ['Intent', 'The certificate is for this deposit only', 'Your quote or deposit id'],
          ]}
        />
      ),
    },
    {
      id: 'ask',
      title: '1 · Ask',
      body: (
        <>
          <p>
            Build a request at <A href="/request">/request</A> with <strong>Exit certificate</strong> selected, and hand the link to the holder with
            the deposit address.
          </p>
          <Code>{`{ "v": 1, "id": "c1ea4e7e5a1f0002", "claim": "HoldsAtLeast", "zatoshi": "100000000",
  "audience": "rail:example", "expiryDays": 7, "kind": "exit", "epoch": 202610, "dormantSince": 4410000 }`}</Code>
          <p>
            The holder runs <C>pof-prove prove --request …</C>. An exit certificate names every usable note (up to five), bound to the request id as
            the deposit intent.
          </p>
        </>
      ),
    },
    {
      id: 'check',
      title: '2 · Check the certificate',
      body: (
        <>
          <Code>{`pof-verify check certificate.pof --audience rail:example --anchors anchors.json \\
  --epoch 202610 --dormant-since 4410000 --seen your-registry.json`}</Code>
          <p>
            Valid means: at least that much, in notes unmoved since the block, made for you in this period, and none of these notes already used
            with you this period. Record the result’s <C>tags</C> in your registry. Or run the same check in the browser at{' '}
            <A href="/rail">/rail</A>, or through the API:
          </p>
          <Code lang="http">{`POST /v1/certificates   { "certificate": "<base64url>", "audience": "rail:example", "epoch": 202610,
                          "dormantSince": 4410000, "intent": "c1ea4e7e5a1f0002" }
→ 200 { "status": "pre-cleared", "certificate": { "id": "…", "revealed": [ … ], "tags": [ … ] }, "result": { … } }
→ 422 { "status": "refused", "result": { … } }      (with a reason: not a certificate, another intent, …)`}</Code>
        </>
      ),
    },
    {
      id: 'match',
      title: '3 · Match the deposit',
      body: (
        <>
          <MatchFigure />
          <Code>{`pof-anchor tx --network testnet --txid <deposit txid> > deposit.json
pof-verify match --cert certificate.pof --deposit deposit.json        # exit 0: matched

POST /v1/certificates/{id}/match   { "txid": "<deposit txid>" }
→ { "status": "matched" | "mismatch", "certificate": { "deposit": { "result": { "kind": "Matched", "spent": 2 } } } }`}</Code>
          <p>
            Matched means every note the deposit spends is one the certificate named. Value inside one transaction is pooled, so a single
            uncertified spend makes the whole deposit a mismatch.
          </p>
        </>
      ),
    },
    {
      id: 'real',
      title: 'The real testnet exit',
      body: (
        <>
          <p>
            The first attempt gave <strong>Mismatch</strong>: the wallet split change into four outputs, so the bundle carried three dummy spends
            whose nullifiers looked like uncertified notes. It is kept in <C>fixtures/testnet-exit-first-attempt.*</C> as a documented finding.
          </p>
          <p>
            The clean run consolidated the notes first, certified both at anchor 4,460,391 (<C>fixtures/proofs/testnet-exit.pof</C>), then sent
            deposit <C>ff0a2488543a58b852b22c426313ea00c00de1e79a6fa1710dc3cbae69ab256a</C>, spending exactly those notes into two outputs:{' '}
            <strong>Matched</strong>. Try both on <A href="/rail">/rail</A>.
          </p>
        </>
      ),
    },
    {
      id: 'webhooks',
      title: 'Webhooks and the store',
      body: (
        <>
          <Table
            head={['Event', 'When']}
            rows={[
              [<C key="1">certificate.precleared</C>, 'A certificate passed your policy.'],
              [<C key="2">deposit.matched</C>, 'The deposit spends only certified notes.'],
              [<C key="3">deposit.mismatch</C>, 'The deposit spends a note the certificate did not name.'],
            ]}
          />
          <p>
            Bodies are <C>{'{ event, certificate, at }'}</C>, signed with <C>X-Vouch-Signature: sha256=&lt;hmac&gt;</C> under{' '}
            <C>POF_WEBHOOK_SECRET</C>. Set <C>POF_RAIL_TOKEN</C> to require a bearer token on every write, and <C>POF_STORE</C> to persist the
            registry. The store holds ids, tags, revealed nullifiers and verdicts, never proof bytes.
          </p>
        </>
      ),
    },
    {
      id: 'limits',
      title: 'What it does not say',
      body: (
        <>
          <p>
            Unmoved since block H says when the coins last moved, not where they were before H. Coins stolen long before H and left untouched would
            pass, which is why H is your policy’s choice. It is evidence for your risk process, never a “clean” stamp, and not a legal answer to any
            regulation.
          </p>
          <p>
            You see the certified notes’ nullifiers before the deposit lands, so you could see if the holder spent them elsewhere instead. Holders are
            told to make certificates only when they are ready to send.
          </p>
        </>
      ),
    },
  ],
}

export const reserves: Doc = {
  slug: 'reserves',
  title: 'Reserves',
  lede: 'Prove a treasury’s shielded reserves as one batch, check it, and publish it to a Solana feed that a token can only mint within.',
  sections: [
    {
      id: 'batch',
      title: '1 · Prove a batch',
      body: (
        <>
          <BatchFigure />
          <p>
            One proof covers up to five notes. A batch covers every usable note: several version 2 proofs in one scope, against one anchor, in a{' '}
            <C>.pofb</C> file. A request of kind <C>reserves</C> makes a batch by default; <C>--batch-size</C> sets how many notes go in each proof.
          </p>
          <Code>{`pof-prove prove --request <encoded> --snapshot target/snapshots/mainnet-<height>.vsnp \\
                --seed-file ~/.vouch/seed.txt --batch-size 5 --out reserves.pofb`}</Code>
        </>
      ),
    },
    {
      id: 'verify',
      title: '2 · Check it',
      body: (
        <>
          <p>
            The verifier checks every member, refuses a batch in which any tag appears twice (a note counted twice), and states the sum. Natively the
            members’ Halo2 proofs are checked together with one batched multi-scalar multiplication, falling back to one by one to name a bad member.
            Drop it on <A href="/reserves">/reserves</A>, or:
          </p>
          <Code>{`pof-verify check reserves.pofb --audience reserves:wzec-demo --anchors anchors.json`}</Code>
          <Code title="Output">{`Valid batch · 4018.12500000 at least, across 3 proofs · anchor 3491040
  proof 1   Valid
  proof 2   Valid
  proof 3   Valid`}</Code>
          <Code title="A batch that counts one note twice">{`Invalid batch · Proof 2 counts a note another proof in the batch already counted.
  proof 1   Valid
  proof 2   Valid`}</Code>
        </>
      ),
    },
    {
      id: 'publish',
      title: '3 · Publish the feed',
      body: (
        <>
          <ReservesSequence />
          <ReserveLayout />
          <p>
            <C>publish</C> accepts the message only if enough distinct allowlisted attestors signed exactly it, the slot is recent, the proofs have not
            expired, the audience is the feed’s, and the anchor is not older than the one the feed already holds.
          </p>
        </>
      ),
    },
    {
      id: 'mint',
      title: '4 · Secure Mint',
      body: (
        <>
          <FeedStates />
          <p>The feed’s token (its mint authority is the feed PDA) mints only when all of these hold:</p>
          <ul>
            <li>the feed has been published at least once;</li>
            <li>the last publish is within the feed’s heartbeat (the demo feed: 9,000 slots, about an hour);</li>
            <li>the proofs behind it have not expired;</li>
            <li>supply plus the amount stays at or under the proven total;</li>
            <li>the caller is the feed’s issuer.</li>
          </ul>
          <p>
            Try both breakers on <A href="/reserves">/reserves</A>: mint past the reserves, or wait out the heartbeat. Each is refused by the program,
            not by the site.
          </p>
        </>
      ),
    },
    {
      id: 'read',
      title: 'Reading the feed',
      body: (
        <>
          <p>
            Any program can read the feed account, a PDA at <C>[b&quot;feed&quot;, audience]</C> under <C>pof-reserve</C> (<C>{reserveIdl.address}</C>).
            The audience is <C>blake2b-256(&quot;pof-audience:&quot; ‖ id)</C>.
          </p>
          <Code lang="rust">{`pub struct Feed {
    pub audience: [u8; 32],
    pub issuer: Pubkey,        // may call secure_mint
    pub mint: Pubkey,          // PDA [b"mint", feed]
    pub heartbeat_slots: u64,
    pub scope: [u8; 32],
    pub total_zatoshi: u64,    // the proven reserves
    pub members: u16,          // proofs in the batch
    pub anchor_height: u32,    // spent set "as of"
    pub nc_height: u32,        // unmoved since, when earlier
    pub expires_at: i64,
    pub updated_slot: u64,
    pub publishes: u32,
    pub bump: u8,
}`}</Code>
          <p>
            Treat the feed as stale exactly as the program does: no publish yet, more than <C>heartbeat_slots</C> since <C>updated_slot</C>, or past{' '}
            <C>expires_at</C>.
          </p>
        </>
      ),
    },
    {
      id: 'limits',
      title: 'What reserves prove, and what they do not',
      body: (
        <p>
          A feed proves the issuer controlled at least the total at the anchor, with no note counted twice within the batch. It does not prove
          liabilities (that half of proof of solvency is on the roadmap), and it does not lock the coins: a later publish with a lower total lowers
          what can be minted, but cannot claw back what was minted already.
        </p>
      ),
    },
  ],
}

export const credit: Doc = {
  slug: 'credit',
  title: 'Credit lines on Solana',
  lede: 'The worked example of a consumer program: pof-credit opens a credit line against a receipt from pof-gate, pays draws from a pool vault, and stops paying when the line’s proof goes stale.',
  sections: [
    {
      id: 'flow',
      title: 'The flow',
      body: (
        <>
          <CreditSequence />
          <Steps>
            <Step title="Prove, bound to the borrower">
              <p>The holder proves at least the pool’s threshold, to the pool’s audience, bound to their Solana wallet.</p>
            </Step>
            <Step title="Attest and record a receipt">
              <p>The attestor signs the verdict; a relayer submits it to pof-gate, which creates the receipt.</p>
            </Step>
            <Step title="Open the line">
              <p>
                The borrower signs <C>open_line</C>; the relayer pays the rent. pof-credit checks the receipt and consumes it through pof-gate, so it
                can never open a second line.
              </p>
            </Step>
            <Step title="Draw, and refresh">
              <p>Draws pay out from the vault up to the limit while the proof is fresh; a new proof refreshes the line.</p>
            </Step>
          </Steps>
        </>
      ),
    },
    {
      id: 'accounts',
      title: 'Accounts',
      body: <AccountsMap />,
    },
    {
      id: 'terms',
      title: 'Pool terms',
      body: (
        <Table
          head={['Term', 'Set by', 'Demo value']}
          rows={[
            [<C key="1">audience</C>, 'init_pool', <C key="1v">blake2b(&quot;{DEMO_AUDIENCE.id}&quot;)</C>],
            [<C key="2">required_zatoshi</C>, 'init_pool', '50,000,000,000 (500 ZEC)'],
            [<C key="3">line_limit</C>, 'init_pool', '25,000 dUSDC'],
            [<C key="4">fresh_secs</C>, 'set_freshness', '86,400 (24 hours, the default)'],
            [<C key="5">min_anchor_height</C>, 'set_freshness', 'the oldest anchor accepted'],
          ]}
        />
      ),
    },
    {
      id: 'checks',
      title: 'What open_line and refresh_line check',
      body: (
        <>
          <ul>
            <li>the receipt’s audience is the pool’s (<C>WrongAudience</C>);</li>
            <li>its claim value is at least the threshold (<C>BelowThreshold</C>);</li>
            <li>the signer is the receipt’s beneficiary, the bound wallet;</li>
            <li>it has not been consumed (<C>ReceiptConsumed</C>) and its proof has not expired (<C>ProofExpired</C>);</li>
            <li>its anchor is no older than the pool’s floor (<C>AnchorTooOld</C>), and, for a refresh, no older than the line’s last.</li>
          </ul>
          <p>
            A line stays drawable until <C>min(now + fresh_secs, proof expiry)</C>. After that, <C>draw</C> fails with <C>NeedsFreshProof</C> until a
            refresh. A holder who has spent the coins cannot make the new proof.
          </p>
        </>
      ),
    },
    {
      id: 'demo',
      title: 'Try it',
      body: (
        <p>
          <A href="/demo">/demo</A> runs this whole flow on devnet with a demo relayer: the proof, the attestation, the receipt, the line, a 1,000
          dUSDC draw, and the breakers (replay, a stranger’s wallet, a tampered attestation, a tampered proof, a revoked proof).
        </p>
      ),
    },
  ],
}

export const attestor: Doc = {
  slug: 'attestor',
  title: 'Running an attestor',
  lede: 'The one service that must hold a key. It is small, stateless and replaceable on purpose: anyone can run one, and a program can require several.',
  sections: [
    {
      id: 'run',
      title: 'Run one',
      body: (
        <>
          <Code>{`cd backend && cargo build --release -p pof-attest
POF_ATTEST_KEY=<64 hex chars, your Ed25519 seed> \\
POF_ANCHORS=frontend/src/data/anchors.json \\
POF_REVOCATIONS_URL=https://<site>/api/revocations \\
SOLANA_RPC_URL=https://api.devnet.solana.com \\
PORT=8787 ./target/release/pof-attest

curl localhost:8787/v1/pubkey   # your key, the verifier build, the key fingerprint`}</Code>
          <p>
            Or in a container: <C>docker build -f backend/Dockerfile -t pof-attest .</C> from the repository root (with the demo holder), or{' '}
            <C>backend/Dockerfile.render</C> without it. The hosted one is <C>{ATTESTOR}</C>.
          </p>
        </>
      ),
    },
    {
      id: 'env',
      title: 'Configuration',
      body: (
        <Table
          head={['Variable', 'Default', 'Effect']}
          rows={[
            [<C key="1">POF_ATTEST_KEY</C>, 'ephemeral', 'Ed25519 seed, hex. Set it, or the public key changes on every restart.'],
            [<C key="2">POF_ANCHORS</C>, 'required', 'The anchor table it trusts.'],
            [<C key="3">POF_AUDIENCE</C>, 'pof-credit:usdc-pool-1', 'The only audience it attests for.'],
            [<C key="4">POF_REVOCATIONS_URL · _FILE</C>, '—', 'Revocation sources; the URL is cached for 10 s.'],
            [<C key="5">SOLANA_RPC_URL</C>, '—', 'The slot for attestation freshness; /v1/attest answers 503 without it.'],
            [<C key="6">POF_DEMO_WORLD</C>, '—', 'Enables the demo holder (feature demo-prover).'],
            [<C key="7">POF_RAIL_TOKEN</C>, '—', 'Bearer token required on rail writes.'],
            [<C key="8">POF_WEBHOOK_URL · _SECRET</C>, '—', 'Signed rail events.'],
            [<C key="9">POF_STORE</C>, 'memory', 'Persist the rail registry to a JSON file.'],
            [<C key="10">PORT</C>, '8787', ''],
          ]}
        />
      ),
    },
    {
      id: 'api',
      title: 'Endpoints',
      body: (
        <>
          <Table
            head={['Route', 'Does']}
            rows={[
              ['POST /v1/attest', 'Runs pof-verify on {proof}; signs the 139-byte message if Valid and bound; 422 with the verdict otherwise.'],
              ['POST /v1/verify', 'The verdict, unsigned. For integrators who want a hosted check.'],
              ['GET /v1/pubkey', 'Public key, verifier version, verifying-key fingerprint, audience, demo prover on or off.'],
              ['GET /v1/anchor/{h}', 'The anchor records it trusts at a height.'],
              ['POST /v1/certificates', 'Rail API: verify an exit certificate under the rail’s policy and registry.'],
              ['POST /v1/certificates/{id}/match', 'Rail API: read the deposit’s nullifiers from lightwalletd; matched or mismatch.'],
              ['POST /v1/batch', 'Verify a reserves batch; with attest: true, sign it for pof-reserve.'],
              ['POST /v1/demo/prove', 'The demo holder (only with POF_DEMO_WORLD).'],
              ['GET /health', 'Liveness.'],
            ]}
          />
          <p>
            Shapes for every route are in the <A href="/docs/api">HTTP API reference</A>.
          </p>
        </>
      ),
    },
    {
      id: 'ops',
      title: 'Operating it',
      body: (
        <ul>
          <li>Verification runs under a per-core semaphore; when every slot is busy the service answers 429 rather than queueing without bound.</li>
          <li>Request bodies are capped at 64 KiB (2 MiB for batches).</li>
          <li>RPC and revocation-list errors are logged, never returned to callers; the list fails open, keeping the last copy.</li>
          <li>Ship the attestor the same anchor table as your verifiers: it trusts only the anchors it was started with.</li>
          <li>On 0.1 CPU (Render free) one verification takes about 0.3 s, a reserves batch with its attestation about 2 s, and a deposit match about 3.4 s; memory stays near 33 MB.</li>
        </ul>
      ),
    },
    {
      id: 'allowlist',
      title: 'Getting on an allowlist',
      body: (
        <p>
          <C>pof-gate</C> and <C>pof-reserve</C> each keep up to eight attestor keys and a threshold. With threshold 2, a receipt needs two distinct
          allowlisted attestors to have signed the identical message, so one compromised attestor can no longer forge anything. The first{' '}
          <C>initialize</C> must be signed by the program’s upgrade authority, so nobody can claim the config before the deployer; after that the
          admin sets both with <C>set_attestors</C>.
        </p>
      ),
    },
    {
      id: 'logs',
      title: 'What it keeps',
      body: <p>Its key and a ten-second cache of the revocation list. It logs verdicts and latencies, never proof bytes, and holds no user data. The rail store holds ids, tags, revealed nullifiers, verdicts and times.</p>,
    },
  ],
}
