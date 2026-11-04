//! pof-gate and pof-credit against LiteSVM, loading the SBF builds from target/deploy.
//! Build first: `anchor build` (or `cargo build-sbf`) in backend/solana. Then `cargo test`.
//!
//! Every attack from the architecture doc is a test: wrong key, wrong message, offsets that
//! point into another instruction, stale slot, expired proof, replay, unknown claim, below
//! threshold, wrong audience, wrong signer, and double consumption, including by a second
//! consumer program. Plus the admin surface: a front-run initialize, set_attestors, init_pool.
//! And freshness: a line draws only while its latest proof is fresh, and a refresh must meet the
//! pool's terms with an anchor no older than the line's last or the pool's floor.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use ed25519_dalek::{Signer as _, SigningKey};
use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use pof_gate::ClaimReceipt;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_program_runtime::{declare_process_instruction, solana_sbpf::program::BuiltinFunctionDefinition};
use solana_signer::Signer;
use solana_transaction::Transaction;

type Pubkey = anchor_lang::prelude::Pubkey;

const NOW: i64 = 1_790_200_000;
const SLOT: u64 = 400_000_000;
const REQUIRED: u64 = 50_000_000_000; // 500 ZEC
const ROGUE: Pubkey = Pubkey::new_from_array([7; 32]);

// A second consumer program, as a builtin at ROGUE: it spends the receipt named in its data
// (receipt 32 · beneficiary 32) by CPI, signing as its own [b"consumer"] PDA like any consumer.
declare_process_instruction!(Rogue, 0, |ic| {
    let d = ic.transaction_context.get_current_instruction_context()?.get_instruction_data().to_vec();
    let key = |at: usize| Pubkey::new_from_array(d[at..at + 32].try_into().unwrap());
    let (consumer, bump) = Pubkey::find_program_address(&[b"consumer"], &ROGUE);
    let accounts = pof_gate::accounts::MarkConsumed { receipt: key(0), beneficiary: key(32), consumer, consumer_program: ROGUE }.to_account_metas(None);
    ic.native_invoke_signed(Instruction { program_id: pof_gate::ID, accounts, data: pof_gate::instruction::MarkConsumed {}.data() }, &[&[b"consumer", &[bump]]])
});

fn audience(id: &str) -> [u8; 32] {
    let s = format!("pof-audience:{}", id.trim().to_lowercase());
    blake2b_simd::Params::new().hash_length(32).hash(s.as_bytes()).as_bytes().try_into().unwrap()
}

struct Msg {
    subject: [u8; 32],
    beneficiary: Pubkey,
    audience: [u8; 32],
    kind: u8,
    value: u64,
    height: u32,
    expires: u64,
    verdict: u8,
    slot: u64,
}

impl Msg {
    fn valid(beneficiary: Pubkey, subject_seed: u8) -> Self {
        Msg { subject: [subject_seed; 32], beneficiary, audience: audience("pof-credit:usdc-pool-1"), kind: 0, value: REQUIRED, height: 3_491_040, expires: (NOW + 86_400) as u64, verdict: 0, slot: SLOT - 5 }
    }
    fn bytes(&self) -> Vec<u8> {
        let mut m = Vec::with_capacity(139);
        m.extend_from_slice(b"POF-ATTEST-v1");
        m.extend_from_slice(&self.subject);
        m.extend_from_slice(self.beneficiary.as_ref());
        m.extend_from_slice(&self.audience);
        m.push(self.kind);
        m.extend_from_slice(&self.value.to_le_bytes());
        m.extend_from_slice(&self.height.to_le_bytes());
        m.extend_from_slice(&self.expires.to_le_bytes());
        m.push(self.verdict);
        m.extend_from_slice(&self.slot.to_le_bytes());
        assert_eq!(m.len(), 139);
        m
    }
}

/// Ed25519 native-program instruction with every offset pointing into itself.
fn ed25519_ix(keys: &[&SigningKey], msg: &[u8]) -> Instruction {
    let n = keys.len();
    let header = 2 + 14 * n;
    let mut data = vec![n as u8, 0];
    let mut body = Vec::new();
    for k in keys {
        let pk_off = header + body.len();
        body.extend_from_slice(k.verifying_key().as_bytes());
        let sig_off = header + body.len();
        body.extend_from_slice(&k.sign(msg).to_bytes());
        let msg_off = header + body.len();
        body.extend_from_slice(msg);
        for v in [sig_off, 0xFFFF, pk_off, 0xFFFF, msg_off, msg.len(), 0xFFFF] {
            data.extend_from_slice(&(v as u16).to_le_bytes());
        }
    }
    data.extend_from_slice(&body);
    Instruction { program_id: solana_sdk_ids::ed25519_program::ID, accounts: vec![], data }
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    /// Pays every fee and rent, as the demo relayer does. The borrower and stranger hold no SOL.
    relayer: Keypair,
    attestors: Vec<SigningKey>,
    borrower: Keypair,
    stranger: Keypair,
    mint: Pubkey,
}

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

fn config() -> Pubkey {
    pda(&[b"config"], &pof_gate::ID)
}
fn receipt(subject: &[u8; 32]) -> Pubkey {
    pda(&[b"receipt", subject], &pof_gate::ID)
}
fn pool(mint: &Pubkey) -> Pubkey {
    pda(&[b"pool", mint.as_ref()], &pof_credit::ID)
}
fn vault(mint: &Pubkey) -> Pubkey {
    pda(&[b"vault", pool(mint).as_ref()], &pof_credit::ID)
}
fn line(subject: &[u8; 32], borrower: &Pubkey) -> Pubkey {
    pda(&[b"line", subject.as_ref(), borrower.as_ref()], &pof_credit::ID)
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Result<(), String> {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &signers, svm.latest_blockhash());
    let r = svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?} {}", e.err, e.meta.logs.join("\n")));
    svm.expire_blockhash();
    r
}

/// Both programs through the upgradeable loader, as deployed, with `authority` as pof-gate's
/// upgrade authority; the clock at SLOT/NOW; the Rogue consumer.
fn svm(authority: &Pubkey) -> LiteSVM {
    let mut svm = LiteSVM::new().with_precompiles();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/deploy");
    svm.add_program_from_file(pof_gate::ID, format!("{dir}/pof_gate.so")).expect("run `anchor build` first");
    svm.add_program_from_file(pof_credit::ID, format!("{dir}/pof_credit.so")).expect("run `anchor build` first");
    // LiteSVM writes ProgramData with no upgrade authority. Layout: tag u32 · slot u64 · Option<Pubkey>.
    let programdata = pda(&[pof_gate::ID.as_ref()], &solana_sdk_ids::bpf_loader_upgradeable::ID);
    let mut acc = svm.get_account(&programdata).unwrap();
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(programdata, acc).unwrap();
    svm.add_builtin(ROGUE, Rogue::register);
    let mut clock: Clock = svm.get_sysvar();
    clock.slot = SLOT;
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);
    svm
}

fn init_ix(admin: &Pubkey, attestors: Vec<Pubkey>, threshold: u8) -> Instruction {
    let program_data = pda(&[pof_gate::ID.as_ref()], &solana_sdk_ids::bpf_loader_upgradeable::ID);
    Instruction {
        program_id: pof_gate::ID,
        accounts: pof_gate::accounts::Initialize { config: config(), admin: *admin, program: pof_gate::ID, program_data, system_program: anchor_lang::system_program::ID }.to_account_metas(None),
        data: pof_gate::instruction::Initialize { attestors, threshold, max_age_slots: 150 }.data(),
    }
}

fn set_ix(admin: &Pubkey, attestors: Vec<Pubkey>, threshold: u8) -> Instruction {
    Instruction {
        program_id: pof_gate::ID,
        accounts: pof_gate::accounts::AdminOnly { config: config(), admin: *admin }.to_account_metas(None),
        data: pof_gate::instruction::SetAttestors { attestors, threshold, max_age_slots: 150 }.data(),
    }
}

fn init_pool_ix(authority: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::InitPool {
            pool: pool(mint),
            mint: *mint,
            vault: vault(mint),
            authority: *authority,
            token_program: litesvm_token::TOKEN_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::InitPool { audience: audience("pof-credit:usdc-pool-1"), required_zatoshi: REQUIRED, line_limit: 25_000_000_000 }.data(),
    }
}

fn world(threshold: u8, n_attestors: usize) -> World {
    let admin = Keypair::new();
    let mut svm = svm(&admin.pubkey());
    let relayer = Keypair::new();
    for k in [&admin, &relayer] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let attestors: Vec<SigningKey> = (0..n_attestors).map(|i| SigningKey::from_bytes(&[i as u8 + 1; 32])).collect();
    let keys: Vec<Pubkey> = attestors.iter().map(|k| Pubkey::new_from_array(k.verifying_key().to_bytes())).collect();
    send(&mut svm, &[init_ix(&admin.pubkey(), keys, threshold)], &admin, &[]).unwrap();

    let mint = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
    send(&mut svm, &[init_pool_ix(&admin.pubkey(), &mint)], &admin, &[]).unwrap();
    MintTo::new(&mut svm, &admin, &mint, &vault(&mint), 1_000_000_000_000).send().unwrap();
    World { svm, admin, relayer, attestors, borrower: Keypair::new(), stranger: Keypair::new(), mint }
}

fn submit_raw(payer: &Pubkey, subject: &[u8; 32], message: Vec<u8>) -> Instruction {
    Instruction {
        program_id: pof_gate::ID,
        accounts: pof_gate::accounts::SubmitAttestation {
            config: config(),
            receipt: receipt(subject),
            payer: *payer,
            instructions: solana_sdk_ids::sysvar::instructions::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_gate::instruction::SubmitAttestation { subject: *subject, message }.data(),
    }
}

fn submit_ix(payer: &Pubkey, m: &Msg) -> Instruction {
    submit_raw(payer, &m.subject, m.bytes())
}

fn open_line_ix(w: &World, borrower: &Pubkey, subject: &[u8; 32]) -> Instruction {
    Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::OpenLine {
            pool: pool(&w.mint),
            receipt: receipt(subject),
            line: line(subject, borrower),
            borrower: *borrower,
            payer: w.relayer.pubkey(),
            consumer: pda(&[b"consumer"], &pof_credit::ID),
            consumer_program: pof_credit::ID,
            gate_program: pof_gate::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::OpenLine {}.data(),
    }
}

/// open_line signed by `who`, paid for by the relayer.
fn open(w: &mut World, who: &Keypair, subject: &[u8; 32]) -> Result<(), String> {
    let (ix, r) = (open_line_ix(w, &who.pubkey(), subject), w.relayer.insecure_clone());
    send(&mut w.svm, &[ix], &r, &[who])
}

/// The Rogue consumer spending `subject`'s receipt, signed by `who`.
fn rogue(w: &mut World, who: &Keypair, subject: &[u8; 32]) -> Result<(), String> {
    let r = receipt(subject);
    let mut accounts = pof_gate::accounts::MarkConsumed { receipt: r, beneficiary: who.pubkey(), consumer: pda(&[b"consumer"], &ROGUE), consumer_program: ROGUE }.to_account_metas(None);
    accounts[2].is_signer = false; // the PDA signs inside the CPI, not in the transaction
    accounts.push(AccountMeta::new_readonly(pof_gate::ID, false));
    let ix = Instruction { program_id: ROGUE, accounts, data: [r.as_ref(), who.pubkey().as_ref()].concat() };
    let relayer = w.relayer.insecure_clone();
    send(&mut w.svm, &[ix], &relayer, &[who])
}

fn draw_ix(w: &World, signer: &Pubkey, line: Pubkey, token: Pubkey, amount: u64) -> Instruction {
    let p = pool(&w.mint);
    Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::Draw { pool: p, line, borrower: *signer, vault: vault(&w.mint), borrower_token: token, token_program: litesvm_token::TOKEN_ID }.to_account_metas(None),
        data: pof_credit::instruction::Draw { amount }.data(),
    }
}

fn set_freshness_ix(mint: &Pubkey, authority: &Pubkey, fresh_secs: i64, min_anchor_height: u32) -> Instruction {
    Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::SetFreshness { pool: pool(mint), authority: *authority }.to_account_metas(None),
        data: pof_credit::instruction::SetFreshness { fresh_secs, min_anchor_height }.data(),
    }
}

/// refresh_line on the line opened against `opened`, with the receipt for `fresh`, signed by `who`.
fn refresh(w: &mut World, who: &Keypair, opened: &[u8; 32], fresh: &[u8; 32]) -> Result<(), String> {
    let ix = Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::RefreshLine {
            pool: pool(&w.mint),
            line: line(opened, &who.pubkey()),
            receipt: receipt(fresh),
            borrower: who.pubkey(),
            consumer: pda(&[b"consumer"], &pof_credit::ID),
            consumer_program: pof_credit::ID,
            gate_program: pof_gate::ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::RefreshLine {}.data(),
    };
    let r = w.relayer.insecure_clone();
    send(&mut w.svm, &[ix], &r, &[who])
}

fn read_line(w: &World, subject: &[u8; 32], borrower: &Pubkey) -> pof_credit::CreditLine {
    let acc = w.svm.get_account(&line(subject, borrower)).expect("line exists");
    pof_credit::CreditLine::try_deserialize(&mut &acc.data[..]).unwrap()
}

/// Move the clock to `unix_timestamp`, leaving the slot (and so attestation freshness) alone.
fn set_time(w: &mut World, unix_timestamp: i64) {
    let mut clock: Clock = w.svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    w.svm.set_sysvar(&clock);
}

fn attest_raw(w: &mut World, subject: &[u8; 32], msg: Vec<u8>) -> Result<(), String> {
    let (a0, r) = (w.attestors[0].clone(), w.relayer.insecure_clone());
    send(&mut w.svm, &[ed25519_ix(&[&a0], &msg), submit_raw(&r.pubkey(), subject, msg)], &r, &[])
}

fn attest(w: &mut World, m: &Msg) -> Result<(), String> {
    attest_raw(w, &m.subject, m.bytes())
}

fn read_receipt(w: &World, subject: &[u8; 32]) -> ClaimReceipt {
    let acc = w.svm.get_account(&receipt(subject)).expect("receipt exists");
    ClaimReceipt::try_deserialize(&mut &acc.data[..]).unwrap()
}

#[test]
fn happy_path_opens_and_draws() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 1);
    attest(&mut w, &m).expect("valid attestation is accepted");
    let r = read_receipt(&w, &m.subject);
    assert_eq!(r.claim_value, REQUIRED);
    assert!(!r.consumed);

    let b = w.borrower.insecure_clone();
    open(&mut w, &b, &m.subject).expect("open_line");
    let r = read_receipt(&w, &m.subject);
    assert!(r.consumed);
    assert_eq!(r.consumed_by, pof_credit::ID, "the consumer program is recorded");
    assert_eq!(w.svm.get_balance(&b.pubkey()).unwrap_or(0), 0, "the relayer paid the line's rent; the borrower needs no SOL");

    let relayer = w.relayer.insecure_clone();
    let ata = CreateAssociatedTokenAccount::new(&mut w.svm, &relayer, &w.mint).owner(&b.pubkey()).send().unwrap();
    let mut draw = |amount| {
        let ix = draw_ix(&w, &b.pubkey(), line(&m.subject, &b.pubkey()), ata, amount);
        send(&mut w.svm, &[ix], &relayer, &[&b])
    };
    draw(1_000_000_000).expect("draw within limit");
    assert!(draw(25_000_000_000).unwrap_err().contains("OverLimit"), "over the limit");
    assert!(draw(0).unwrap_err().contains("OverLimit"), "zero");
}

#[test]
fn draw_needs_the_borrower_and_the_pool_mint() {
    let mut w = world(1, 1);
    let (b, s, relayer) = (w.borrower.insecure_clone(), w.stranger.insecure_clone(), w.relayer.insecure_clone());
    let m = Msg::valid(b.pubkey(), 20);
    attest(&mut w, &m).unwrap();
    open(&mut w, &b, &m.subject).unwrap();
    let their = CreateAssociatedTokenAccount::new(&mut w.svm, &relayer, &w.mint).owner(&s.pubkey()).send().unwrap();
    let ix = draw_ix(&w, &s.pubkey(), line(&m.subject, &b.pubkey()), their, 1);
    assert!(send(&mut w.svm, &[ix], &relayer, &[&s]).unwrap_err().contains("ConstraintSeeds"), "another signer on the borrower's line");
    let other_mint = CreateMint::new(&mut w.svm, &w.admin).decimals(6).send().unwrap();
    let wrong = CreateAssociatedTokenAccount::new(&mut w.svm, &relayer, &other_mint).owner(&b.pubkey()).send().unwrap();
    let ix = draw_ix(&w, &b.pubkey(), line(&m.subject, &b.pubkey()), wrong, 1);
    assert!(send(&mut w.svm, &[ix], &relayer, &[&b]).unwrap_err().contains("ConstraintTokenMint"), "a token account of another mint");
}

#[test]
fn replay_of_the_same_proof_fails() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 2);
    attest(&mut w, &m).unwrap();
    let mut again = Msg::valid(w.borrower.pubkey(), 2);
    again.slot = SLOT - 1; // re-attested later: different message, same proof id
    assert!(attest(&mut w, &again).is_err(), "one proof, one receipt");
}

#[test]
fn wrong_key_is_refused() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 3);
    let (rogue, r) = (SigningKey::from_bytes(&[99; 32]), w.relayer.insecure_clone());
    let e = send(&mut w.svm, &[ed25519_ix(&[&rogue], &m.bytes()), submit_ix(&r.pubkey(), &m)], &r, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "{e}");
}

#[test]
fn signature_over_a_different_message_is_refused() {
    let mut w = world(1, 1);
    let signed = Msg::valid(w.borrower.pubkey(), 4);
    let mut claimed = Msg::valid(w.borrower.pubkey(), 4);
    claimed.value = REQUIRED * 10; // raise the claim after signing
    let (a0, r) = (w.attestors[0].clone(), w.relayer.insecure_clone());
    let e = send(&mut w.svm, &[ed25519_ix(&[&a0], &signed.bytes()), submit_ix(&r.pubkey(), &claimed)], &r, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "{e}");
}

#[test]
fn offsets_into_another_instruction_are_refused() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 5);
    let (a0, r) = (w.attestors[0].clone(), w.relayer.insecure_clone());
    // The signature is genuine, but the message offset points into instruction 1's data
    // (anchor discriminator 8 + subject 32 + vec length 4 = 44).
    let mut ix = ed25519_ix(&[&a0], &m.bytes());
    // offsets entry: sig_off 2..4 · sig_ix 4..6 · pk_off 6..8 · pk_ix 8..10 · msg_off 10..12 · msg_len 12..14 · msg_ix 14..16
    ix.data[10..12].copy_from_slice(&44u16.to_le_bytes()); // message offset inside instruction 1
    ix.data[12..14].copy_from_slice(&139u16.to_le_bytes());
    ix.data[14..16].copy_from_slice(&1u16.to_le_bytes()); // message instruction index = 1
    let e = send(&mut w.svm, &[ix, submit_ix(&r.pubkey(), &m)], &r, &[]).unwrap_err();
    assert!(e.contains("ForeignOffsets"), "{e}");
}

#[test]
fn a_signature_after_submit_or_a_truncated_entry_does_not_count() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 21);
    let (a0, r) = (w.attestors[0].clone(), w.relayer.insecure_clone());
    let e = send(&mut w.svm, &[submit_ix(&r.pubkey(), &m), ed25519_ix(&[&a0], &m.bytes())], &r, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "only earlier instructions count: {e}");
    // The message runs past the end of the data. The Ed25519 program refuses it before pof-gate
    // runs; the gate's own bounds checks (BadEd25519) are the second line.
    let mut ix = ed25519_ix(&[&a0], &m.bytes());
    ix.data.pop();
    assert!(send(&mut w.svm, &[ix, submit_ix(&r.pubkey(), &m)], &r, &[]).is_err());
    assert!(w.svm.get_account(&receipt(&m.subject)).is_none(), "no receipt");
}

#[test]
fn stale_future_expired_invalid_and_unknown_are_refused() {
    let mut w = world(1, 1);
    let mut m = Msg::valid(w.borrower.pubkey(), 6);
    m.slot = SLOT - 1_000;
    assert!(attest(&mut w, &m).unwrap_err().contains("Stale"));
    m.slot = SLOT + 1;
    assert!(attest(&mut w, &m).unwrap_err().contains("Stale"), "from the future");
    let mut m = Msg::valid(w.borrower.pubkey(), 7);
    m.expires = (NOW - 1) as u64;
    assert!(attest(&mut w, &m).unwrap_err().contains("Expired"));
    let mut m = Msg::valid(w.borrower.pubkey(), 8);
    m.verdict = 1;
    assert!(attest(&mut w, &m).unwrap_err().contains("NotValid"));
    let mut m = Msg::valid(w.borrower.pubkey(), 9);
    m.kind = 2;
    assert!(attest(&mut w, &m).unwrap_err().contains("UnknownClaim"));
}

#[test]
fn malformed_attestations_are_refused() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 22);
    assert!(attest_raw(&mut w, &[23; 32], m.bytes()).unwrap_err().contains("SubjectMismatch"));
    let mut bad = m.bytes();
    bad[0] ^= 1;
    assert!(attest_raw(&mut w, &m.subject, bad).unwrap_err().contains("BadDomain"));
    let mut short = m.bytes();
    short.pop();
    assert!(attest_raw(&mut w, &m.subject, short).unwrap_err().contains("BadLength"));
    let mut far = Msg::valid(w.borrower.pubkey(), 22);
    far.expires = u64::MAX; // not an i64
    assert!(attest(&mut w, &far).unwrap_err().contains("BadExpiry"));
}

#[test]
fn only_the_bound_account_can_open_a_line() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 10);
    attest(&mut w, &m).unwrap();
    let (b, s) = (w.borrower.insecure_clone(), w.stranger.insecure_clone());
    assert!(open(&mut w, &s, &m.subject).unwrap_err().contains("NotBoundToSigner"));
    // and still refused once the rightful borrower has opened the line
    open(&mut w, &b, &m.subject).unwrap();
    assert!(open(&mut w, &s, &m.subject).unwrap_err().contains("NotBoundToSigner"));
}

#[test]
fn below_threshold_wrong_audience_and_expired_are_refused() {
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    let mut low = Msg::valid(b.pubkey(), 11);
    low.value = REQUIRED - 12_500_000;
    attest(&mut w, &low).unwrap();
    assert!(open(&mut w, &b, &low.subject).unwrap_err().contains("BelowThreshold"));

    let mut other = Msg::valid(b.pubkey(), 12);
    other.audience = audience("otc-desk:someone-else");
    attest(&mut w, &other).unwrap();
    assert!(open(&mut w, &b, &other.subject).unwrap_err().contains("WrongAudience"));

    let m = Msg::valid(b.pubkey(), 24);
    attest(&mut w, &m).unwrap();
    let mut clock: Clock = w.svm.get_sysvar();
    clock.unix_timestamp = m.expires as i64;
    w.svm.set_sysvar(&clock);
    assert!(open(&mut w, &b, &m.subject).unwrap_err().contains("ProofExpired"));
}

#[test]
fn a_receipt_is_consumed_once_across_consumers() {
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    // pof-credit first: another consumer program is refused by pof-gate
    let m = Msg::valid(b.pubkey(), 13);
    attest(&mut w, &m).unwrap();
    open(&mut w, &b, &m.subject).unwrap();
    assert!(rogue(&mut w, &b, &m.subject).unwrap_err().contains("AlreadyConsumed"));
    assert!(open(&mut w, &b, &m.subject).unwrap_err().contains("already in use"), "the line for this proof exists");
    // another consumer first: pof-credit sees the receipt spent
    let m = Msg::valid(b.pubkey(), 17);
    attest(&mut w, &m).unwrap();
    rogue(&mut w, &b, &m.subject).expect("any consumer program may spend a receipt once");
    assert_eq!(read_receipt(&w, &m.subject).consumed_by, ROGUE);
    assert!(open(&mut w, &b, &m.subject).unwrap_err().contains("ReceiptConsumed"));
}

#[test]
fn mark_consumed_needs_a_consumer_program_signature() {
    let mut w = world(1, 1);
    let (b, fake, r) = (w.borrower.insecure_clone(), Keypair::new(), w.relayer.insecure_clone());
    let m = Msg::valid(b.pubkey(), 18);
    attest(&mut w, &m).unwrap();
    // the beneficiary signing with a plain keypair as the "consumer", naming a real program or itself
    for consumer_program in [pof_credit::ID, fake.pubkey()] {
        let accounts = pof_gate::accounts::MarkConsumed { receipt: receipt(&m.subject), beneficiary: b.pubkey(), consumer: fake.pubkey(), consumer_program }.to_account_metas(None);
        let ix = Instruction { program_id: pof_gate::ID, accounts, data: pof_gate::instruction::MarkConsumed {}.data() };
        assert!(send(&mut w.svm, &[ix], &r, &[&b, &fake]).unwrap_err().contains("ConstraintSeeds"));
    }
    assert!(!read_receipt(&w, &m.subject).consumed);
}

#[test]
fn one_wallet_can_open_a_line_per_proof() {
    // Every visitor to the demo shares one borrower: an open line must not block the next proof.
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    for seed in [15, 16] {
        let m = Msg::valid(b.pubkey(), seed);
        attest(&mut w, &m).unwrap();
        open(&mut w, &b, &m.subject).expect("a fresh proof opens its own line");
    }
}

#[test]
fn threshold_two_of_three() {
    let mut w = world(2, 3);
    let m = Msg::valid(w.borrower.pubkey(), 14);
    assert!(attest(&mut w, &m).unwrap_err().contains("NotEnoughSignatures"), "one signature is not enough");
    let (a, b, r) = (w.attestors[0].clone(), w.attestors[2].clone(), w.relayer.insecure_clone());
    // the same key twice counts once
    let e = send(&mut w.svm, &[ed25519_ix(&[&a, &a], &m.bytes()), submit_ix(&r.pubkey(), &m)], &r, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "{e}");
    send(&mut w.svm, &[ed25519_ix(&[&a, &b], &m.bytes()), submit_ix(&r.pubkey(), &m)], &r, &[]).expect("two distinct attestors");
    assert_eq!(read_receipt(&w, &m.subject).signers, 2);
}

#[test]
fn only_the_upgrade_authority_initializes_once() {
    let (admin, s) = (Keypair::new(), Keypair::new());
    let mut svm = svm(&admin.pubkey());
    for k in [&admin, &s] {
        svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    }
    let set = || vec![Pubkey::new_from_array([1; 32])];
    let e = send(&mut svm, &[init_ix(&s.pubkey(), set(), 1)], &s, &[]).unwrap_err();
    assert!(e.contains("NotUpgradeAuthority"), "a front-runner cannot become admin: {e}");
    send(&mut svm, &[init_ix(&admin.pubkey(), set(), 1)], &admin, &[]).expect("the upgrade authority initializes");
    assert!(send(&mut svm, &[init_ix(&admin.pubkey(), set(), 1)], &admin, &[]).unwrap_err().contains("already in use"), "re-initialize");
}

#[test]
fn attestor_sets_are_admin_only_and_validated() {
    let mut w = world(1, 1);
    let (admin, s, r) = (w.admin.insecure_clone(), w.stranger.insecure_clone(), w.relayer.insecure_clone());
    let k = |i: u8| Pubkey::new_from_array([i; 32]);
    assert!(send(&mut w.svm, &[set_ix(&s.pubkey(), vec![k(1)], 1)], &r, &[&s]).unwrap_err().contains("ConstraintHasOne"));
    let bad: [(Vec<Pubkey>, u8); 5] = [(vec![], 1), (vec![k(1), k(1)], 1), (vec![k(1)], 0), (vec![k(1), k(2)], 3), ((1..=9).map(k).collect(), 1)];
    for (set, threshold) in bad {
        assert!(send(&mut w.svm, &[set_ix(&admin.pubkey(), set, threshold)], &admin, &[]).unwrap_err().contains("BadAttestorSet"));
    }
    send(&mut w.svm, &[set_ix(&admin.pubkey(), (1..=8).map(k).collect(), 8)], &admin, &[]).expect("eight distinct keys, 8 of 8");
}

#[test]
fn a_line_draws_only_while_its_proof_is_fresh() {
    let mut w = world(1, 1);
    let (admin, b, relayer) = (w.admin.insecure_clone(), w.borrower.insecure_clone(), w.relayer.insecure_clone());
    send(&mut w.svm, &[set_freshness_ix(&w.mint, &admin.pubkey(), 3_600, 0)], &admin, &[]).unwrap();
    let first = Msg::valid(b.pubkey(), 30);
    attest(&mut w, &first).unwrap();
    open(&mut w, &b, &first.subject).unwrap();
    let l = read_line(&w, &first.subject, &b.pubkey());
    assert_eq!(l.fresh_until, NOW + 3_600);
    assert_eq!((l.refreshed_against, l.refreshes), (first.subject, 0));

    let ata = CreateAssociatedTokenAccount::new(&mut w.svm, &relayer, &w.mint).owner(&b.pubkey()).send().unwrap();
    let draw = |w: &mut World, amount| {
        let ix = draw_ix(w, &b.pubkey(), line(&first.subject, &b.pubkey()), ata, amount);
        send(&mut w.svm, &[ix], &relayer, &[&b])
    };
    draw(&mut w, 1_000_000).expect("fresh");
    set_time(&mut w, NOW + 3_600);
    assert!(draw(&mut w, 1_000_000).unwrap_err().contains("NeedsFreshProof"), "the window has closed");

    // A new proof (same notes, newer anchor) reopens the window; drawn is kept.
    let mut second = Msg::valid(b.pubkey(), 31);
    second.height += 1_000;
    attest(&mut w, &second).unwrap();
    refresh(&mut w, &b, &first.subject, &second.subject).expect("refresh with a fresh proof");
    let l = read_line(&w, &first.subject, &b.pubkey());
    assert_eq!((l.anchor_height, l.refreshed_against, l.refreshes), (second.height, second.subject, 1));
    assert_eq!(l.fresh_until, NOW + 7_200);
    assert_eq!(l.drawn, 1_000_000, "a refresh does not reset what was drawn");
    assert!(read_receipt(&w, &second.subject).consumed, "the refresh spent its receipt");
    draw(&mut w, 1_000_000).expect("fresh again");
}

#[test]
fn freshness_never_outlasts_the_proof() {
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    let mut m = Msg::valid(b.pubkey(), 32);
    m.expires = (NOW + 600) as u64; // shorter than the pool's default window
    attest(&mut w, &m).unwrap();
    open(&mut w, &b, &m.subject).unwrap();
    assert_eq!(read_line(&w, &m.subject, &b.pubkey()).fresh_until, NOW + 600);
}

#[test]
fn a_refresh_must_meet_the_terms_and_not_go_back_in_time() {
    let mut w = world(1, 1);
    let (b, s) = (w.borrower.insecure_clone(), w.stranger.insecure_clone());
    let first = Msg::valid(b.pubkey(), 33);
    attest(&mut w, &first).unwrap();
    open(&mut w, &b, &first.subject).unwrap();

    assert!(refresh(&mut w, &b, &first.subject, &first.subject).unwrap_err().contains("ReceiptConsumed"), "the opening proof again");

    let mut older = Msg::valid(b.pubkey(), 34);
    older.height -= 1;
    attest(&mut w, &older).unwrap();
    assert!(refresh(&mut w, &b, &first.subject, &older.subject).unwrap_err().contains("AnchorTooOld"), "an older snapshot");

    let mut low = Msg::valid(b.pubkey(), 35);
    low.value = REQUIRED - 12_500_000;
    attest(&mut w, &low).unwrap();
    assert!(refresh(&mut w, &b, &first.subject, &low.subject).unwrap_err().contains("BelowThreshold"), "the funds fell below the threshold");

    let mut other = Msg::valid(b.pubkey(), 36);
    other.audience = audience("otc-desk:someone-else");
    attest(&mut w, &other).unwrap();
    assert!(refresh(&mut w, &b, &first.subject, &other.subject).unwrap_err().contains("WrongAudience"));

    // someone else's proof cannot refresh the borrower's line, signed by either of them
    let theirs = Msg::valid(s.pubkey(), 37);
    attest(&mut w, &theirs).unwrap();
    assert!(refresh(&mut w, &s, &first.subject, &theirs.subject).unwrap_err().contains("AccountNotInitialized"), "the stranger has no such line");
    assert!(refresh(&mut w, &b, &first.subject, &theirs.subject).unwrap_err().contains("NotBoundToSigner"));

    let same_anchor = Msg::valid(b.pubkey(), 38);
    attest(&mut w, &same_anchor).unwrap();
    refresh(&mut w, &b, &first.subject, &same_anchor.subject).expect("the same anchor is allowed: the pool's floor decides staleness");
}

#[test]
fn the_pool_floor_and_window_are_the_authoritys() {
    let mut w = world(1, 1);
    let (admin, b, s, r) = (w.admin.insecure_clone(), w.borrower.insecure_clone(), w.stranger.insecure_clone(), w.relayer.insecure_clone());
    let m = Msg::valid(b.pubkey(), 39);
    attest(&mut w, &m).unwrap();

    assert!(send(&mut w.svm, &[set_freshness_ix(&w.mint, &s.pubkey(), 60, 0)], &r, &[&s]).unwrap_err().contains("ConstraintHasOne"));
    assert!(send(&mut w.svm, &[set_freshness_ix(&w.mint, &admin.pubkey(), 0, 0)], &admin, &[]).unwrap_err().contains("BadTerms"));
    send(&mut w.svm, &[set_freshness_ix(&w.mint, &admin.pubkey(), 60, m.height + 1)], &admin, &[]).unwrap();
    assert!(open(&mut w, &b, &m.subject).unwrap_err().contains("AnchorTooOld"), "below the pool's floor");

    send(&mut w.svm, &[set_freshness_ix(&w.mint, &admin.pubkey(), 60, m.height)], &admin, &[]).unwrap();
    open(&mut w, &b, &m.subject).expect("at the floor");
    assert_eq!(read_line(&w, &m.subject, &b.pubkey()).fresh_until, NOW + 60);
}

#[test]
fn a_pool_needs_the_mint_authority() {
    let mut w = world(1, 1);
    let r = w.relayer.insecure_clone();
    let admins_mint = CreateMint::new(&mut w.svm, &w.admin).decimals(6).send().unwrap();
    let e = send(&mut w.svm, &[init_pool_ix(&r.pubkey(), &admins_mint)], &r, &[]).unwrap_err();
    assert!(e.contains("ConstraintMintMintAuthority"), "{e}");
}
