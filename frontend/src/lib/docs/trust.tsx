import { A, C, Table } from '@/components/docs/content'
import { TrustBoundaries } from '@/components/docs/figures/security'
import { LINKS } from '../site'
import type { Doc } from './types'

export const trust: Doc = {
  slug: 'trust',
  title: 'Where trust still sits',
  lede: 'Vouch is trust-minimised, not trustless. This page says exactly where, before anyone has to ask.',
  sections: [
    {
      id: 'boundaries',
      title: 'The boundaries',
      body: (
        <>
        <TrustBoundaries />
        <Table
          head={['Party', 'Trusted for', 'Why that is acceptable']}
          rows={[
            ['Holder’s device', 'Keys and proving', 'Keys never leave it. The prover links no network client; nothing is broadcast.'],
            ['Zcash chain', 'The truth', 'Both anchor roots are rebuilt from public compact blocks, and nc_root is checked against lightwalletd.'],
            ['Anchor table', 'Which roots are real', 'Anyone can re-derive every entry with pof-anchor. A wrong entry can only make honest proofs fail.'],
            ['pof-verify', 'Checking', 'Open source, one implementation compiled natively and to WASM; every verdict can be re-derived.'],
            ['pof-attest', 'Solana only', 'Signs verdicts for a chain that cannot read Zcash. Allowlisted, k-of-n capable, and anyone can run one.'],
            ['Revocation list', 'Availability', 'A hash lock: only the holder knows the secret, so the list can drop an entry but never forge one.'],
          ]}
        />
        </>
      ),
    },
    {
      id: 'attestor',
      title: 'The attestor, plainly',
      body: (
        <>
          <p>
            Verification of a Zcash fact by a Solana program goes through attestors. The program trusts its allowlist and threshold and nothing
            else. If enough allowlisted attestors lie together, the program believes them. That is the honest cost of today’s design; the <A href="/docs/threats">threat model</A> lists what each party could do.
          </p>
          <p>
            It is mitigated by making attestors boring and plural: stateless, re-runnable against the same proof and public data, and combinable
            (2 of 3 is a configuration change). A Zcash light client on Solana removes the attestor for the anchor; verifying the Halo2 proof
            inside a zkVM and checking a Groth16 wrapper on Solana removes it for the proof. Both are on the roadmap.
          </p>
        </>
      ),
    },
    {
      id: 'leak',
      title: 'What a leaked proof exposes',
      body: (
        <p>
          That some holder cleared a threshold at a block height, for a named audience, and nothing else: not the balance, not which notes or how
          many (the five slots are always filled), not the addresses. The governance nullifiers are unlinkable to on-chain nullifiers. A proof bound
          to a Solana account is useless to anyone else on-chain.
        </p>
      ),
    },
    {
      id: 'cannot',
      title: 'What this cannot do',
      body: (
        <ul>
          <li>Prove where funds came from before they entered the shielded pool.</li>
          <li>Prove a negative: that a holder has nothing elsewhere.</li>
          <li>
            Stop a holder spending the funds right after proving. Proofs are point-in-time; the anchor says which point. A consumer has to ask
            again, as a lender asks for a new bank statement: <C>pof-credit</C> draws only while a line’s latest proof is fresh (24 hours by
            default, never past the proof’s expiry), and a refresh needs a new proof at an anchor no older than the line’s last or the pool’s
            floor. A holder who spent the funds cannot make one.
          </li>
          <li>Stop the same notes backing proofs to several audiences. Each proof is single-use where it lands (one receipt, one credit line), but the funds are not locked.</li>
          <li>Prove more than five notes’ worth in one proof. A wallet with many small notes consolidates first.</li>
          <li>Make an institution accept a proof. That is a conversation, not a feature.</li>
        </ul>
      ),
    },
    {
      id: 'demo',
      title: 'The demo ledger',
      body: (
        <p>
          So that anyone can see a real proof without owning ZEC, the site ships a demo ledger: a real key, five real Ironwood notes, and a published
          tree and nullifier set that are ours, not mainnet’s. Every verdict against it says “demo anchor”. Mainnet anchors come only from{' '}
          <C>pof-anchor</C>.
        </p>
      ),
    },
    {
      id: 'credits',
      title: 'What we built on',
      body: (
        <>
          <p>
            The holding proof is the delegation circuit from <A href={LINKS.votingCircuits}>voting-circuits</A> (Valar Group), driven the way{' '}
            <A href={LINKS.zcashVoting}>zcash_voting</A> (Chainapsis) drives it, over the Zakura Orchard/Ironwood crates; all MIT / Apache-2.0. We
            added two circuit changes (the threshold, and the revealed nullifiers of exit certificates as a second circuit), a dense IMT, a precomputed-key loader, and a WASM build fix; each is listed in the vendored
            crate’s <C>VOUCH-MODIFICATIONS.md</C>.
          </p>
          <p>
            What we built is the envelope and its binding to the circuit, the anchor indexer, the prover and verifier, the attestor, the Solana
            programs and this site. No audit and no formal verification have been done. <strong>This is not production-ready.</strong>
          </p>
        </>
      ),
    },
  ],
}

export const threats: Doc = {
  slug: 'threats',
  title: 'Threat model',
  lede: 'What an attacker could try at each layer, what stops it, and the test that shows it is stopped. Where something is not stopped, this page says so.',
  sections: [
    {
      id: 'assets',
      title: 'What is being protected',
      body: (
        <Table
          head={['Asset', 'Threat', 'Who wants it']}
          rows={[
            ['The holder’s privacy', 'Learning the balance, the notes or addresses; linking proofs', 'Verifiers, observers, other verifiers'],
            ['The verifier’s decision', 'A false Valid: forged, edited, borrowed, reused, stale or revoked proofs', 'A dishonest holder, or a thief of a proof'],
            ['On-chain value', 'A receipt, a line or a mint without a real proof behind it', 'Anyone who can send a transaction'],
            ['The holder’s keys', 'Exfiltration while proving', 'Malware, a malicious build'],
          ]}
        />
      ),
    },
    {
      id: 'proof',
      title: 'Attacks on the proof',
      body: (
        <Table
          head={['Attack', 'Stopped by', 'Shown by']}
          rows={[
            ['Edit the claim (500 → 5,000 ZEC) and re-seal the checksum', 'The signature covers the statement', 'forged-claim vector → ProofInvalid'],
            ['Re-address a proof to yourself', 'The audience is in the signed statement', 'readdressed vector → ProofInvalid'],
            ['Flip a byte of the evidence', 'Halo2 verification', 'tampered vector; the e2e tampered-proof check'],
            ['Extend the expiry', 'The expiry is signed', 'extended-expiry vector → ProofInvalid'],
            ['Truncate or corrupt the file', 'Checksum; injective decoding', 'codec tests → Malformed'],
            ['Count one note in several slots', 'The distinct-tag check before Halo2', 'real-proof test: one note five times, refused'],
            ['Prove more than you hold', 'The threshold constraint', 'vouch_threshold; the impossible-claim test'],
            ['Use a note created after H₀', 'The tree at H₀ does not contain it', 'refused at proving; dormant-too-young vector'],
            ['Use a spent note', 'IMT non-membership at the spent-set root', 'real-proof dormancy tests'],
            ['Prove with only a viewing key', 'The RedPallas spend-authority signature', 'by construction'],
          ]}
        />
      ),
    },
    {
      id: 'context',
      title: 'Attacks on the context',
      body: (
        <Table
          head={['Attack', 'Stopped by', 'Residual risk']}
          rows={[
            ['Show a proof to a verifier it was not made for', 'The audience check', 'none'],
            ['Use a revoked proof', 'The revocation list at verify time', 'A verifier that never fetches the list'],
            ['Pledge the same coins twice to one verifier', 'Scope tags and the verifier’s registry → AlreadyUsed', 'A verifier that names no period, or keeps no registry'],
            ['Pledge the same coins to two verifiers', '—', 'Not stopped: funds are not locked. Each proof is single-use where it lands.'],
            ['Spend right after proving', '—', 'Not stopped: a proof is as of one block. Ask again; pof-credit enforces freshness.'],
            ['Feed a verifier a fake anchor', 'Anchors come from the verifier’s own table', 'A wrong entry can only make honest proofs fail'],
          ]}
        />
      ),
    },
    {
      id: 'solana',
      title: 'Attacks on the programs',
      body: (
        <Table
          head={['Attack', 'Stopped by', 'LiteSVM test']}
          rows={[
            ['Replay an attestation', 'One receipt per proof id', <C key="1">replay_of_the_same_proof_fails</C>],
            ['Sign with a key not on the allowlist', 'The allowlist', <C key="2">wrong_key_is_refused</C>],
            ['Reuse a signature over another message', 'Exact message match', <C key="3">signature_over_a_different_message_is_refused</C>],
            ['Point Ed25519 offsets into other data', 'Every offset must be u16::MAX', <C key="4">offsets_into_another_instruction_are_refused</C>],
            ['Put the signature after the submit, or truncate it', 'Only earlier, complete entries count', <C key="5">a_signature_after_submit_or_a_truncated_entry_does_not_count</C>],
            ['Submit a stale, future, expired or invalid verdict', 'Slot age, expiry and verdict checks', <C key="6">stale_future_expired_invalid_and_unknown_are_refused</C>],
            ['Open a line from someone else’s receipt', 'The beneficiary must sign', <C key="7">only_the_bound_account_can_open_a_line</C>],
            ['Consume a receipt twice, or as a fake consumer', 'The consumed flag; the consumer-program PDA signature', <C key="8">mark_consumed_needs_a_consumer_program_signature</C>],
            ['Claim the config before the deployer', 'initialize needs the upgrade authority', <C key="9">only_the_upgrade_authority_initializes_once</C>],
            ['Draw on a stale proof', 'fresh_until', <C key="10">a_line_draws_only_while_its_proof_is_fresh</C>],
            ['Refresh with an older anchor', 'Anchor no older than the last', <C key="11">a_refresh_must_meet_the_terms_and_not_go_back_in_time</C>],
            ['Mint from a stale feed', 'Secure Mint freshness', <C key="12">a_stale_feed_mints_nothing_until_refreshed</C>],
            ['Mint as someone other than the issuer', 'has_one = issuer', <C key="13">only_the_issuer_mints</C>],
            ['Publish a wrong-signer, older or expired batch', 'publish checks', <C key="14">publish_refuses_what_it_must</C>],
          ]}
        />
      ),
    },
    {
      id: 'attestor',
      title: 'The attestor',
      body: (
        <>
          <p>
            An attestor that lies can make a Solana program believe a false verdict. This is the one place trust is concentrated, and it is
            mitigated, not removed:
          </p>
          <ul>
            <li>programs can require k of n distinct allowlisted attestors (2 of 3 is tested);</li>
            <li>every verdict an attestor signs can be re-derived by anyone from the proof and public data, so a lie is detectable after the fact;</li>
            <li>the attestor holds no user data and never sees keys: a compromised attestor cannot spend anyone’s ZEC.</li>
          </ul>
          <p>
            A Zcash light client on Solana would remove the attestor for anchors; verifying the Halo2 proof in a zkVM and checking a Groth16 wrapper on
            Solana would remove it for proofs. Both are on the roadmap.
          </p>
        </>
      ),
    },
    {
      id: 'privacy',
      title: 'Privacy leaks to know about',
      body: (
        <Table
          head={['Leak', 'To whom', 'Mitigation']}
          rows={[
            ['The threshold and the anchor heights', 'The verifier', 'By design: that is the fact proven'],
            ['Reuse within a period', 'That verifier only', 'By design, when the verifier names a period'],
            ['The certified notes’ nullifiers (exits)', 'The rail', 'Make the certificate only when ready to send'],
            ['Timing between certificate and deposit', 'The rail', 'Not mitigated'],
            ['The verify link', 'Whoever has the link', 'The proof is after the #, so it never reaches a server log'],
          ]}
        />
      ),
    },
    {
      id: 'out-of-scope',
      title: 'Out of scope',
      body: (
        <ul>
          <li>The origin of funds before they entered the shielded pool, and any “clean funds” claim.</li>
          <li>Compliance with any specific regulation.</li>
          <li>Side channels on the holder’s machine, and malicious builds of the prover (check the release SHA-256, or build from source).</li>
          <li>Availability of lightwalletd, the site, the attestor or Solana.</li>
        </ul>
      ),
    },
  ],
}

export const faq: Doc = {
  slug: 'faq',
  title: 'Asked before you ask',
  lede: 'The questions a lender, a regulator, a judge or a Zcash developer asks in the first five minutes.',
  sections: [
    { id: 'mixer', title: 'Is this a mixer?', body: <p>The opposite. A mixer hides; Vouch makes one fact visible again, to one named party, with an expiry. Nothing is moved and nothing is hidden that was not already hidden.</p> },
    { id: 'bridge', title: 'Is this a bridge?', body: <p>No. Nothing is bridged: the ZEC never leaves Zcash. Only a proof moves, and on Solana only a signed verdict about it.</p> },
    {
      id: 'exchange',
      title: 'Does it get shielded funds through an exchange or a swap?',
      body: (
        <p>
          It gives the rail evidence, not a pass. An exit certificate shows the coins were already in the chain at a block the rail picks (say,
          before an incident) and have not moved since, and names them, so the deposit can be matched to exactly them. Whether that releases a
          held deposit is the rail’s policy. See <A href="/docs/rail">Exit certificates</A>.
        </p>
      ),
    },
    {
      id: 'clean',
      title: 'Does it prove the coins are clean?',
      body: (
        <p>
          No, and it never says so. It proves when the coins last moved, not where they were before. Tracing shielded funds is impossible by
          design; that is what the shielded pool is for. Coins stolen long before the block a rail picks, and left untouched, would pass, which is
          why the block is the rail’s choice.
        </p>
      ),
    },
    {
      id: 'spend',
      title: 'What stops them spending right after proving?',
      body: (
        <p>
          Nothing, and the proof says so: it is “as of” one block. A lender asks for a fresh proof at each check, can require a recent spent set,
          and, by naming a period in its request, sees the same coins pledged twice to it. An exit certificate is different: it names the coins,
          and the rail matches them against the deposit itself.
        </p>
      ),
    },
    { id: 'viewingkey', title: 'Why not just use a viewing key?', body: <p>A viewing key shows every payment ever received, forever, and cannot be revoked or scoped. A proof shows one fact, to one party, until one date, and can be revoked.</p> },
    {
      id: 'notes',
      title: 'What if my ZEC is in many small notes?',
      body: (
        <p>
          One proof covers up to five notes. Prove a batch instead (<A href="/reserves">reserves</A>): several proofs, one total, no note counted
          twice. Or send yourself the amount first so it sits in fewer notes; but a self-transfer makes new notes, so it restarts any “unmoved
          since” clock.
        </p>
      ),
    },
    { id: 'orchard', title: 'Why Ironwood and not Orchard?', body: <p>Ironwood replaced Orchard in July 2026 after the Orchard counterfeiting flaw, and holders are migrating. Anything built against Orchard alone is built against a closing door.</p> },
    { id: 'reuse', title: 'What did you build versus reuse?', body: <p>See <A href="/docs/trust#credits">What we built on</A>. The circuit is Valar Group’s with two Vouch additions (the threshold, and the optional revealed nullifiers of exit certificates); everything around it is ours.</p> },
      {
      id: 'quantum',
      title: 'Is it post-quantum?',
      body: <p>No. Like Zcash’s shielded pools today, the proofs rest on elliptic-curve assumptions (the Pasta curves and RedPallas), and the attestations on Ed25519.</p>,
    },
    {
      id: 'offline',
      title: 'Can I verify without trusting your website?',
      body: (
        <p>
          Yes. Download pof-verify from the releases (or build it), re-derive the anchors with pof-anchor from any lightwalletd, and check the file on
          your own machine. The site is a convenience: it runs the same verifier in your browser and never receives the proof.
        </p>
      ),
    },
    {
      id: 'amount',
      title: 'Does the verifier learn my balance?',
      body: <p>No. It learns that the proven notes hold at least the threshold. The sum is committed inside the proof and never revealed, and unused slots are filled, so even the number of notes is hidden.</p>,
    },
    {
      id: 'two-verifiers',
      title: 'Can two verifiers compare notes?',
      body: <p>They can compare the claims they received, but not link the coins: tags are derived per scope, so the same notes give unrelated tags to different verifiers. An exit certificate is the exception by design: it reveals the notes’ nullifiers to the rail, which can then see them spent.</p>,
    },
    {
      id: 'audit',
      title: 'Has it been audited?',
      body: <p>No. Neither circuit change, the programs nor the attestor has been audited or formally verified. It is a hackathon build, testnet only, and says so everywhere.</p>,
    },
  ],
}
