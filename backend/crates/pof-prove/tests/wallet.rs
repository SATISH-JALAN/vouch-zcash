//! The real-wallet path end to end, on a snapshot whose holder notes are genuinely
//! note-encrypted Ironwood outputs: key → trial decryption → spent-note filtering → proof →
//! pof-verify against the snapshot's own anchor record.
//!
//! Run: cargo test --release -p pof-prove --test wallet -- --ignored

use pof_anchor::{Action, Snapshot as ChainSnapshot};
use pof_core::{Claim, Envelope};
use pof_prove::{envelope_for, prove, wallet, ProofRequest};
use pof_verify::{verify, AnchorRecord, Context, ZkVerifier};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{ExtractedNoteCommitment, Note, NoteVersion, Nullifier, Rho},
    note_encryption::{IronwoodDomain, IronwoodNoteEncryption},
    value::NoteValue,
};
use voting_crypto_deps::pasta_curves::pallas;
use zcash_note_encryption::Domain;

const ZEC: u64 = 100_000_000;

fn random_base() -> [u8; 32] {
    pallas::Base::random(&mut OsRng).to_repr()
}

/// A real Ironwood output to `fvk`: returns the compact action and the note's own nullifier.
fn output(fvk: &FullViewingKey, value: u64) -> (Action, [u8; 32]) {
    let mut rng = OsRng;
    let nf_old = Nullifier::from_bytes(&random_base()).unwrap();
    let note = Note::new(fvk.address_at(0u32, Scope::External), NoteValue::from_raw(value), Rho::from_nf_old(nf_old), NoteVersion::V3, &mut rng);
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let enc = IronwoodNoteEncryption::new(Some(fvk.to_ovk(Scope::External)), note, [0u8; 512]);
    let ct = enc.encrypt_note_plaintext();
    let action = Action {
        nullifier: nf_old.to_bytes(),
        cmx: cmx.to_bytes(),
        epk: IronwoodDomain::epk_bytes(enc.epk()).0,
        ciphertext: ct[..52].try_into().unwrap(),
    };
    (action, note.nullifier(fvk).to_bytes())
}

fn noise() -> Action {
    Action { nullifier: random_base(), cmx: random_base(), epk: random_base(), ciphertext: [7; 52] }
}

#[test]
#[ignore = "real proof"]
fn seed_to_verified_proof() {
    let seed = [42u8; 32];
    let sk = wallet::spending_key(&seed, "testnet", 0).unwrap();
    let fvk = FullViewingKey::from(&sk);
    let stranger = FullViewingKey::from(&SpendingKey::random(&mut OsRng));

    let mut actions: Vec<Action> = (0..300).map(|_| noise()).collect();
    let (a1, _) = output(&fvk, 300 * ZEC);
    let (a2, _) = output(&fvk, 250 * ZEC);
    let (a3, spent_nf) = output(&fvk, 900 * ZEC);
    let (a4, _) = output(&stranger, 10_000 * ZEC);
    for (i, a) in [a1, a2, a3, a4].into_iter().enumerate() {
        actions.insert(40 + i * 60, a);
    }
    // the 900 ZEC note is spent later: its nullifier appears in a later action
    actions.push(Action { nullifier: spent_nf, ..noise() });

    let chain = ChainSnapshot { network: "testnet".into(), height: 1_234_000, block_hash: [9; 32], actions, checkpoints: vec![] };
    let mut bytes = vec![];
    chain.write(&mut bytes).unwrap();
    let chain = ChainSnapshot::read(&mut &bytes[..]).unwrap();

    let notes = wallet::find_notes(&chain, &fvk);
    assert_eq!(notes.len(), 3, "finds all three of the holder's notes and none of the stranger's");
    let (_, _, record) = chain.anchor().unwrap();
    let snap = wallet::snapshot(&chain).unwrap();

    let req = ProofRequest { v: 1, id: None, claim: "HoldsAtLeast".into(), zatoshi: 500 * ZEC, audience: "otc-desk:acme".into(), expiry_days: 7, respond_by: None, bind: None, kind: None, epoch: None, dormant_since: None };
    let now = 1_790_000_000;
    let mut env: Envelope = envelope_for(&req, snap.anchor(), now, [0; 32], &[5; 32]);
    let used = prove(&sk, &notes, &snap, &mut env).expect("300 + 250 clears 500 without the spent note");
    assert_eq!(used, 2);

    // 1,000 ZEC would need the spent note: refused
    let mut too_much = envelope_for(&ProofRequest { zatoshi: 1_000 * ZEC, ..req.clone() }, snap.anchor(), now, [0; 32], &[6; 32]);
    assert!(prove(&sk, &notes, &snap, &mut too_much).is_err());

    let file = pof_core::encode(&env);
    let anchors = vec![AnchorRecord { network: record.network, height: record.height, block_hash: record.block_hash, nc_root: record.nc_root, nf_root: record.nf_root }];
    let zk = ZkVerifier::new().unwrap();
    let r = verify(&file, &Context { audience: "otc-desk:acme", anchors: &anchors, revoked_secrets: &[], now: now + 60, zk: &zk, policy: Default::default(), seen: &[] });
    assert!(matches!(r.verdict, pof_verify::Verdict::Valid { claim: Claim::HoldsAtLeast { zatoshi }, .. } if zatoshi == 500 * ZEC), "{:?}", r.verdict);
}
