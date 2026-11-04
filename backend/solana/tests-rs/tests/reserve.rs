//! pof-reserve against LiteSVM (SBF build from target/deploy; `anchor build` first).
//!
//! The feed takes only an allowlisted attestor's signature over the exact reserve message, from
//! this instruction's own Ed25519 entries, fresh, unexpired, for its own audience, never with an
//! older anchor; and the Secure Mint refuses to mint past the proven reserves, on a stale feed,
//! or for anyone but the issuer.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use ed25519_dalek::{Signer as _, SigningKey};
use litesvm::LiteSVM;
use litesvm_token::CreateAssociatedTokenAccount;
use pof_reserve::Feed;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

type Pubkey = anchor_lang::prelude::Pubkey;

const NOW: i64 = 1_790_200_000;
const SLOT: u64 = 400_000_000;
const TOTAL: u64 = 401_812_500_000; // 4,018.125 ZEC, the demo reserves batch
const HEARTBEAT: u64 = 1_000;

fn audience(id: &str) -> [u8; 32] {
    let s = format!("pof-audience:{}", id.trim().to_lowercase());
    blake2b_simd::Params::new().hash_length(32).hash(s.as_bytes()).as_bytes().try_into().unwrap()
}

struct Msg {
    audience: [u8; 32],
    total: u64,
    members: u16,
    height: u32,
    nc_height: u32,
    expires: u64,
    slot: u64,
}

impl Msg {
    fn valid() -> Self {
        Msg { audience: audience("reserves:wzec-demo"), total: TOTAL, members: 3, height: 3_491_040, nc_height: 3_491_040, expires: (NOW + 86_400) as u64, slot: SLOT - 5 }
    }
    fn bytes(&self) -> Vec<u8> {
        let mut m = Vec::with_capacity(112);
        m.extend_from_slice(b"POF-RESERVE-v1");
        m.extend_from_slice(&[9u8; 32]); // scope
        m.extend_from_slice(&self.audience);
        m.extend_from_slice(&self.total.to_le_bytes());
        m.extend_from_slice(&self.members.to_le_bytes());
        m.extend_from_slice(&self.height.to_le_bytes());
        m.extend_from_slice(&self.nc_height.to_le_bytes());
        m.extend_from_slice(&self.expires.to_le_bytes());
        m.extend_from_slice(&self.slot.to_le_bytes());
        assert_eq!(m.len(), 112);
        m
    }
}

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

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pof_reserve::ID).0
}
fn config() -> Pubkey {
    pda(&[b"config"])
}
fn feed(a: &[u8; 32]) -> Pubkey {
    pda(&[b"feed", a])
}
fn mint(a: &[u8; 32]) -> Pubkey {
    pda(&[b"mint", feed(a).as_ref()])
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Result<(), String> {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &signers, svm.latest_blockhash());
    let r = svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?} {}", e.err, e.meta.logs.join("\n")));
    svm.expire_blockhash();
    r
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    attestor: SigningKey,
    aud: [u8; 32],
    holder_token: Pubkey,
}

fn world() -> World {
    let admin = Keypair::new();
    let mut svm = LiteSVM::new().with_precompiles();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/deploy");
    svm.add_program_from_file(pof_reserve::ID, format!("{dir}/pof_reserve.so")).expect("run `anchor build` first");
    let programdata = Pubkey::find_program_address(&[pof_reserve::ID.as_ref()], &solana_sdk_ids::bpf_loader_upgradeable::ID).0;
    let mut acc = svm.get_account(&programdata).unwrap();
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(programdata, acc).unwrap();
    let mut clock: Clock = svm.get_sysvar();
    clock.slot = SLOT;
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let attestor = SigningKey::from_bytes(&[1; 32]);
    let key = Pubkey::new_from_array(attestor.verifying_key().to_bytes());
    let init = Instruction {
        program_id: pof_reserve::ID,
        accounts: pof_reserve::accounts::Initialize { config: config(), admin: admin.pubkey(), program: pof_reserve::ID, program_data: programdata, system_program: anchor_lang::system_program::ID }
            .to_account_metas(None),
        data: pof_reserve::instruction::Initialize { attestors: vec![key], threshold: 1, max_age_slots: 150 }.data(),
    };
    send(&mut svm, &[init], &admin, &[]).unwrap();
    let aud = audience("reserves:wzec-demo");
    let init_feed = Instruction {
        program_id: pof_reserve::ID,
        accounts: pof_reserve::accounts::InitFeed {
            config: config(),
            feed: feed(&aud),
            mint: mint(&aud),
            admin: admin.pubkey(),
            token_program: litesvm_token::TOKEN_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_reserve::instruction::InitFeed { audience: aud, heartbeat_slots: HEARTBEAT, issuer: admin.pubkey() }.data(),
    };
    send(&mut svm, &[init_feed], &admin, &[]).unwrap();
    let holder = Keypair::new();
    let holder_token = CreateAssociatedTokenAccount::new(&mut svm, &admin, &mint(&aud)).owner(&holder.pubkey()).send().unwrap();
    World { svm, admin, attestor, aud, holder_token }
}

fn publish_ix(aud: &[u8; 32], message: Vec<u8>) -> Instruction {
    Instruction {
        program_id: pof_reserve::ID,
        accounts: pof_reserve::accounts::Publish { config: config(), feed: feed(aud), instructions: solana_sdk_ids::sysvar::instructions::ID }.to_account_metas(None),
        data: pof_reserve::instruction::Publish { message }.data(),
    }
}

fn mint_ix(aud: [u8; 32], to: Pubkey, issuer: &Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: pof_reserve::ID,
        accounts: pof_reserve::accounts::SecureMint { feed: feed(&aud), mint: mint(&aud), to, issuer: *issuer, token_program: litesvm_token::TOKEN_ID }
            .to_account_metas(None),
        data: pof_reserve::instruction::SecureMint { amount }.data(),
    }
}

fn publish(w: &mut World, m: &Msg, signer: &SigningKey) -> Result<(), String> {
    let bytes = m.bytes();
    let ixs = [ed25519_ix(&[signer], &bytes), publish_ix(&w.aud.clone(), bytes)];
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, &ixs, &admin, &[])
}

fn read_feed(w: &World) -> Feed {
    Feed::try_deserialize(&mut &w.svm.get_account(&feed(&w.aud)).unwrap().data[..]).unwrap()
}

fn warp(svm: &mut LiteSVM, slots: u64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.slot += slots;
    svm.set_sysvar(&clock);
}

#[test]
fn publish_then_mint_within_the_reserves() {
    let mut w = world();
    let admin = w.admin.insecure_clone();
    // nothing published: no mint
    assert!(send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &admin.pubkey(), 1)], &admin, &[]).unwrap_err().contains("NeverPublished"));
    let attestor = w.attestor.clone();
    publish(&mut w, &Msg::valid(), &attestor).unwrap();
    let f = read_feed(&w);
    assert_eq!((f.total_zatoshi, f.members, f.anchor_height, f.publishes), (TOTAL, 3, 3_491_040, 1));
    send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &admin.pubkey(), TOTAL - 1)], &admin, &[]).unwrap();
    let e = send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &admin.pubkey(), 2)], &admin, &[]).unwrap_err();
    assert!(e.contains("OverReserves"), "{e}");
    send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &admin.pubkey(), 1)], &admin, &[]).unwrap();
}

#[test]
fn only_the_issuer_mints() {
    let mut w = world();
    let attestor = w.attestor.clone();
    publish(&mut w, &Msg::valid(), &attestor).unwrap();
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &stranger.pubkey(), 1)], &stranger, &[]).is_err());
}

#[test]
fn a_stale_feed_mints_nothing_until_refreshed() {
    let mut w = world();
    let admin = w.admin.insecure_clone();
    let attestor = w.attestor.clone();
    publish(&mut w, &Msg::valid(), &attestor).unwrap();
    warp(&mut w.svm, HEARTBEAT + 1);
    let e = send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &admin.pubkey(), 1)], &admin, &[]).unwrap_err();
    assert!(e.contains("StaleFeed"), "{e}");
    let mut fresh = Msg::valid();
    fresh.slot = SLOT + HEARTBEAT;
    fresh.height = 3_492_000;
    publish(&mut w, &fresh, &attestor).unwrap();
    send(&mut w.svm, &[mint_ix(w.aud, w.holder_token, &admin.pubkey(), 1)], &admin, &[]).unwrap();
}

#[test]
fn publish_refuses_what_it_must() {
    let mut w = world();
    let attestor = w.attestor.clone();
    let stranger_key = SigningKey::from_bytes(&[2; 32]);
    let err = |w: &mut World, m: Msg, k: &SigningKey| publish(w, &m, k).unwrap_err();

    assert!(err(&mut w, Msg::valid(), &stranger_key).contains("NotEnoughSignatures"), "an unknown attestor");
    let mut m = Msg::valid();
    m.audience = audience("reserves:someone-else");
    assert!(err(&mut w, m, &attestor).contains("WrongAudience"));
    let mut m = Msg::valid();
    m.slot = SLOT - 1_000;
    assert!(err(&mut w, m, &attestor).contains("Stale"));
    let mut m = Msg::valid();
    m.expires = (NOW - 1) as u64;
    assert!(err(&mut w, m, &attestor).contains("Expired"));
    let mut m = Msg::valid();
    m.nc_height = m.height + 1;
    assert!(err(&mut w, m, &attestor).contains("BadMessage"));

    publish(&mut w, &Msg::valid(), &attestor).unwrap();
    let mut older = Msg::valid();
    (older.height, older.nc_height) = (3_490_000, 3_490_000);
    assert!(err(&mut w, older, &attestor).contains("OlderAnchor"), "never back to an older anchor");

    // a signature over another message, presented with this one
    let bytes = Msg::valid().bytes();
    let mut other = Msg::valid();
    other.total = TOTAL * 10;
    let ixs = [ed25519_ix(&[&attestor], &bytes), publish_ix(&w.aud.clone(), other.bytes())];
    let admin = w.admin.insecure_clone();
    assert!(send(&mut w.svm, &ixs, &admin, &[]).unwrap_err().contains("NotEnoughSignatures"), "signature over another message");
}
