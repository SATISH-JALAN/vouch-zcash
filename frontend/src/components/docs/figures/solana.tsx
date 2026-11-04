import { Diagram, Edge, Node, Zone } from '../diagrams/kit'
import { Bytes } from '../diagrams/Bytes'
import { Sequence } from '../diagrams/Sequence'

/** The two instructions that carry an attestation into pof-gate. */
export function SolanaTx() {
  return (
    <Diagram
      title="One attestation, one transaction"
      width={900}
      height={380}
      minWidth={740}
      caption="Solana's Ed25519 precompile checks the signature; pof-gate then reads that instruction back through the Instructions sysvar and checks that its signer is allowlisted and its message is exactly the one being submitted."
    >
      <Zone x={20} y={20} w={560} h={340} label="Transaction" tone="solana" />
      <Node x={40} y={56} w={520} h={110} title="ix 0 · Ed25519 precompile" sub={['verify(attestor pubkey, message, signature)', 'every offset = u16::MAX: the data is inside this instruction', 'a bad signature fails the whole transaction']} />
      <Node x={40} y={200} w={520} h={140} title="ix 1 · pof-gate::submit_attestation(subject, message)" sub={['reads ix 0 from the Instructions sysvar', 'counts distinct allowlisted signers of exactly this message', 'checks domain, verdict, slot age, expiry, threshold', 'creates ClaimReceipt ["receipt", subject]']} tone="solana" />
      <Edge points={[[300, 200], [300, 166]]} label="introspects" at={[308, 188]} anchor="start" dashed />
      <Node x={640} y={70} w={240} h={80} title="Config PDA · [config]" sub={['attestors (up to 8)', 'threshold k · max_age_slots']} />
      <Node x={640} y={220} w={240} h={100} title="ClaimReceipt PDA" sub={['["receipt", subject]', 'one per proof: replay fails', 'beneficiary = bound wallet']} tone="solana" />
      <Edge points={[[560, 230], [600, 230], [600, 110], [640, 110]]} label="reads" at={[606, 172]} anchor="start" dashed />
      <Edge points={[[560, 290], [640, 290]]} label="creates" at={[600, 283]} />
    </Diagram>
  )
}

export function AttestationLayout() {
  return (
    <Bytes
      title="The attestation message (POF-ATTEST-v1)"
      caption="139 bytes, little-endian, domain-separated. The attestor signs it with Ed25519; pof-gate parses exactly this layout."
      fields={[
        { label: 'domain', size: 13, sub: '"POF-ATTEST-v1"', tone: 'muted' },
        { label: 'subject', size: 32, sub: 'proof id', tone: 'accent' },
        { label: 'beneficiary', size: 32, sub: 'bound wallet' },
        { label: 'audience', size: 32, sub: 'blake2b(id)' },
        { label: 'kind', size: 1, sub: 'claim' },
        { label: 'value', size: 8, sub: 'zatoshi' },
        { label: 'anchor', size: 4, sub: 'height' },
        { label: 'expires', size: 8, sub: 'unix s' },
        { label: 'verdict', size: 1, sub: 'Valid' },
        { label: 'slot', size: 8, sub: 'freshness', tone: 'service' },
      ]}
      total="139 bytes"
    />
  )
}

export function ReserveLayout() {
  return (
    <Bytes
      title="The reserves message (POF-RESERVE-v1)"
      caption="112 bytes, little-endian. The attestor signs it after verify_batch; pof-reserve::publish parses exactly this layout."
      fields={[
        { label: 'domain', size: 14, sub: '"POF-RESERVE-v1"', tone: 'muted' },
        { label: 'scope', size: 32, sub: 'the batch scope', tone: 'accent' },
        { label: 'audience', size: 32, sub: 'blake2b(id)' },
        { label: 'total', size: 8, sub: 'zatoshi', tone: 'accent' },
        { label: 'members', size: 2, sub: 'proofs' },
        { label: 'anchor', size: 4, sub: 'height' },
        { label: 'nc_height', size: 4, sub: 'unmoved since' },
        { label: 'expires', size: 8, sub: 'first expiry' },
        { label: 'slot', size: 8, sub: 'freshness', tone: 'service' },
      ]}
      total="112 bytes"
    />
  )
}

/** From a receipt to a credit line and a draw. */
export function CreditSequence() {
  return (
    <Sequence
      title="A credit line from a proof"
      caption="The demo relayer pays every fee and the line's rent, so the borrower only signs. pof-credit consumes the receipt through a CPI that only its own consumer PDA can sign."
      actors={[
        { id: 'b', label: 'Borrower', sub: 'the bound wallet', tone: 'accent' },
        { id: 'r', label: 'Relayer', sub: 'pays fees' },
        { id: 'g', label: 'pof-gate', tone: 'solana' },
        { id: 'c', label: 'pof-credit', tone: 'solana' },
      ]}
      steps={[
        { from: 'r', to: 'g', label: 'submit_attestation', detail: 'after the Ed25519 instruction' },
        { from: 'g', to: 'g', label: 'ClaimReceipt', detail: '["receipt", subject]' },
        { from: 'b', to: 'c', label: 'open_line (signs; relayer pays)' },
        { from: 'c', to: 'g', label: 'CPI mark_consumed', detail: 'borrower + [consumer] PDA sign' },
        { from: 'g', to: 'g', label: 'consumed_by = pof-credit' },
        { from: 'c', to: 'c', label: 'CreditLine', detail: '["line", subject, borrower]' },
        { from: 'b', to: 'c', label: 'draw(1,000 dUSDC)' },
        { from: 'c', to: 'b', label: 'dUSDC from the pool vault', dashed: true, tone: 'good' },
        { note: 'Draws only while the line’s latest proof is fresh (24 h by default, never past its expiry)', over: ['b', 'c'], tone: 'muted' },
        { from: 'b', to: 'c', label: 'refresh_line(new receipt)', detail: 'anchor no older than the last' },
      ]}
    />
  )
}

/** Program-derived accounts across the three programs. */
export function AccountsMap() {
  return (
    <Diagram
      title="Program-derived accounts"
      width={900}
      height={400}
      minWidth={740}
      caption="Seeds in brackets. A receipt is keyed by the proof id, so one proof makes one receipt; a credit line is keyed by the receipt and the borrower; a feed is keyed by its audience, and its mint's authority is the feed itself."
    >
      <Zone x={20} y={20} w={270} h={360} label="pof-gate" tone="solana" />
      <Node x={40} y={60} w={230} h={64} title="Config" sub="[config]" tone="solana" />
      <Node x={40} y={160} w={230} h={84} title="ClaimReceipt" sub={['[receipt, subject]', 'consumed · consumed_by']} tone="solana" />
      <Zone x={315} y={20} w={270} h={360} label="pof-credit" tone="solana" />
      <Node x={335} y={60} w={230} h={64} title="Pool" sub="[pool, mint]" tone="solana" />
      <Node x={335} y={150} w={230} h={64} title="Vault" sub="[vault, pool]" tone="solana" />
      <Node x={335} y={240} w={230} h={64} title="CreditLine" sub="[line, subject, borrower]" tone="solana" />
      <Node x={335} y={320} w={230} h={44} title="[consumer] · signs the CPI" tone="muted" />
      <Zone x={610} y={20} w={270} h={360} label="pof-reserve" tone="solana" />
      <Node x={630} y={60} w={230} h={64} title="Config" sub="[config]" tone="solana" />
      <Node x={630} y={160} w={230} h={84} title="Feed" sub={['[feed, audience]', 'total · heights · slot']} tone="solana" />
      <Node x={630} y={280} w={230} h={64} title="Mint" sub="[mint, feed] · authority: feed" tone="solana" />
      <Edge points={[[335, 272], [300, 272], [300, 202], [270, 202]]} label="opened against" at={[296, 258]} anchor="end" />
      <Edge points={[[335, 342], [290, 342], [290, 236], [270, 236]]} dashed />
      <Edge points={[[450, 124], [450, 150]]} />
      <Edge points={[[745, 244], [745, 280]]} label="mint authority" at={[752, 266]} anchor="start" />
    </Diagram>
  )
}
