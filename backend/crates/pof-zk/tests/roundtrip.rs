//! Real proofs over a synthetic tree: honest, tampered, forged, spent, insufficient.
//! Run: cargo test --release -p pof-zk --features prove -- --ignored

#![cfg(feature = "prove")]

use pof_core::{audience_hash, revocation_tag, Anchor, Claim, Envelope, Evidence};
use pof_zk::{base_to_bytes, prove_holding, DenseImtProvider, HeldNote, ImtProvider, NoteTree, ProveError, Verifier, ZkError};
use voting_circuits::ff::Field;
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{commitment::ExtractedNoteCommitment, Note, NoteVersion, Rho},
    value::NoteValue,
};
use voting_crypto_deps::pasta_curves::pallas;

const ZEC: u64 = 100_000_000;

/// The two heights of the dormancy tests: the tree at H0 holds notes 0 and 1 (and the note
/// spent later), the spent set at H1 is the current one.
const H0: u32 = 3_480_000;
const H1: u32 = 3_491_040;

struct World {
    sk: SpendingKey,
    notes: Vec<(Note, u32)>,
    tree: NoteTree,
    /// The tree at H0: every leaf before holder note 2.
    old_tree: NoteTree,
    imt: DenseImtProvider,
    /// Owned, in the tree at H0, spent before H1.
    spent_note: (Note, u32),
}

fn note(fvk: &FullViewingKey, value: u64, rng: &mut OsRng) -> Note {
    let (_, _, dummy) = Note::dummy(rng, None, NoteVersion::V3);
    Note::new(
        fvk.address_at(0u32, Scope::External),
        NoteValue::from_raw(value),
        Rho::from_nf_old(dummy.nullifier(fvk)),
        NoteVersion::V3,
        rng,
    )
}

fn world() -> World {
    let mut rng = OsRng;
    let sk = SpendingKey::random(&mut rng);
    let fvk = FullViewingKey::from(&sk);
    let stranger = FullViewingKey::from(&SpendingKey::random(&mut rng));
    let mut leaves = Vec::new();
    let mut spent_nfs = Vec::new();
    for i in 0..40u64 {
        leaves.push(ExtractedNoteCommitment::from(note(&stranger, i + 1, &mut rng).commitment()).to_bytes());
        spent_nfs.push(pallas::Base::random(&mut rng));
    }
    let spent = note(&fvk, 10 * ZEC, &mut rng);
    let spent_pos = leaves.len() as u32;
    leaves.push(ExtractedNoteCommitment::from(spent.commitment()).to_bytes());
    spent_nfs.push(spent.nullifier(&fvk).inner());
    let mut notes = Vec::new();
    let mut old_size = 0;
    for (i, v) in [2 * ZEC, 3 * ZEC, ZEC + ZEC / 2].into_iter().enumerate() {
        if i == 2 {
            old_size = leaves.len();
        }
        let n = note(&fvk, v, &mut rng);
        notes.push((n, leaves.len() as u32));
        leaves.push(ExtractedNoteCommitment::from(n.commitment()).to_bytes());
    }
    World {
        sk,
        notes,
        tree: NoteTree::from_cmx(&leaves).unwrap(),
        old_tree: NoteTree::from_cmx(&leaves[..old_size]).unwrap(),
        imt: DenseImtProvider::from_nullifiers(&spent_nfs),
        spent_note: (spent, spent_pos),
    }
}

fn envelope(w: &World, zatoshi: u64) -> Envelope {
    Envelope {
        version: pof_core::FORMAT_V1,
        circuit: pof_core::CIRCUIT_THRESHOLD,
        claim: Claim::HoldsAtLeast { zatoshi },
        audience: audience_hash("pof-credit:usdc-pool-1"),
        epoch: 0,
        binding: [0; 32],
        anchor: Anchor::at(H1, w.tree.root(), base_to_bytes(&w.imt.root())),
        issued_at: 1_790_035_200,
        expires_at: 1_790_640_000,
        revocation: revocation_tag(&[42; 32]),
        evidence: Evidence { public_inputs: vec![], proof: vec![], signature: [0; 64] },
    }
}

/// Version 2: the tree at H0, the spent set at H1, in `epoch`.
fn envelope_since(w: &World, zatoshi: u64, epoch: u64) -> Envelope {
    let mut e = envelope(w, zatoshi);
    e.version = pof_core::FORMAT_VERSION;
    e.epoch = epoch;
    e.anchor = Anchor { height: H1, nc_root: w.old_tree.root(), nf_root: base_to_bytes(&w.imt.root()), nc_height: H0 };
    e
}

fn held_in(tree: &NoteTree, w: &World, which: &[usize]) -> Vec<HeldNote> {
    which
        .iter()
        .map(|&i| {
            let (n, pos) = w.notes[i];
            HeldNote { note: n, merkle_path: tree.path(pos).unwrap(), scope: Scope::External }
        })
        .collect()
}

fn held(w: &World, which: &[usize]) -> Vec<HeldNote> {
    held_in(&w.tree, w, which)
}

#[test]
#[ignore = "real proofs"]
fn dormant_since_an_earlier_block() {
    let w = world();
    let v = Verifier::new().unwrap();

    let mut env = envelope_since(&w, 5 * ZEC, 7);
    prove_holding(&w.sk, held_in(&w.old_tree, &w, &[0, 1]), &w.imt, &mut env).unwrap();
    v.verify_holding(&env).expect("notes in the tree at H0, unspent at H1");
    assert_eq!(env.dormant_since(), Some(H0));
    let (decoded, _) = pof_core::decode(&pof_core::encode(&env)).unwrap();
    v.verify_holding(&decoded).expect("survives the wire");

    // Every statement field is held by the signature, including the version 2 ones.
    for (what, edit) in [
        ("the note-commitment height", Box::new(|e: &mut Envelope| e.anchor.nc_height -= 1) as Box<dyn Fn(&mut Envelope)>),
        ("the spent-set height", Box::new(|e: &mut Envelope| e.anchor.height += 1)),
        ("the epoch", Box::new(|e: &mut Envelope| e.epoch += 1)),
        ("the binding", Box::new(|e: &mut Envelope| e.binding[0] ^= 1)),
        ("the revocation tag", Box::new(|e: &mut Envelope| e.revocation[0] ^= 1)),
    ] {
        let mut e = env.clone();
        edit(&mut e);
        assert_eq!(v.verify_holding(&e), Err(ZkError::BadSignature), "{what}");
    }

    // A note that arrived after H0 has no path in the tree at H0, and its current path does
    // not lead to the H0 root.
    assert!(w.old_tree.path(w.notes[2].1).is_none());
    let mut env = envelope_since(&w, ZEC, 7);
    assert!(matches!(prove_holding(&w.sk, held(&w, &[2]), &w.imt, &mut env), Err(ProveError::AnchorMismatch)));

    // A note that was there at H0 but moved before H1.
    let (n, pos) = w.spent_note;
    let moved = vec![HeldNote { note: n, merkle_path: w.old_tree.path(pos).unwrap(), scope: Scope::External }];
    let mut env = envelope_since(&w, ZEC, 7);
    assert!(matches!(prove_holding(&w.sk, moved, &w.imt, &mut env), Err(ProveError::Spent)));
}

/// Version 2 derives the nullifier domain from the scope: the same notes give the same tags in
/// one scope (so the verifier sees reuse) and unrelated tags in another.
#[test]
#[ignore = "real proofs"]
fn tags_repeat_inside_a_scope_only() {
    let w = world();
    let v = Verifier::new().unwrap();
    let prove = |epoch: u64| {
        let mut e = envelope_since(&w, 5 * ZEC, epoch);
        prove_holding(&w.sk, held_in(&w.old_tree, &w, &[0, 1]), &w.imt, &mut e).unwrap();
        v.verify_holding(&e).unwrap();
        e
    };
    let (a, b, c) = (prove(7), prove(7), prove(8));
    let shared = |x: &Envelope, y: &Envelope| pof_zk::tags(x).iter().filter(|t| pof_zk::tags(y).contains(t)).count();
    assert_eq!(shared(&a, &b), 2, "both real notes repeat in the same scope; padding does not");
    assert_eq!(shared(&a, &c), 0, "another epoch shares nothing");
    assert_eq!(pof_zk::scope_key(&a), pof_zk::scope_key(&b));
    assert_ne!(pof_zk::scope_key(&a), pof_zk::scope_key(&c));
}

#[test]
#[ignore = "real proofs"]
fn threshold_roundtrip_and_tampering() {
    let w = world();
    let v = Verifier::new().unwrap();
    let mut env = envelope(&w, 5 * ZEC);
    prove_holding(&w.sk, held(&w, &[0, 1]), &w.imt, &mut env).unwrap();
    v.verify_holding(&env).expect("honest proof verifies");
    let file = pof_core::encode(&env);
    println!("proof file: {} bytes, proof {} bytes", file.len(), env.evidence.proof.len());

    let mut e = env.clone();
    e.expires_at += 86_400;
    assert_eq!(v.verify_holding(&e), Err(ZkError::BadSignature), "extended expiry");
    let mut e = env.clone();
    e.claim = Claim::HoldsAtLeast { zatoshi: 6 * ZEC };
    assert!(v.verify_holding(&e).is_err(), "raised claim");
    let mut e = env.clone();
    e.audience = audience_hash("someone-else");
    assert!(v.verify_holding(&e).is_err(), "swapped audience");
    let mut e = env.clone();
    e.evidence.proof[777] ^= 1;
    assert_eq!(v.verify_holding(&e), Err(ZkError::ProofInvalid), "flipped proof byte");
    let mut e = env.clone();
    e.evidence.signature[3] ^= 1;
    assert!(v.verify_holding(&e).is_err(), "flipped signature");
    let mut e = env.clone();
    e.anchor.nc_root[0] ^= 1;
    assert!(v.verify_holding(&e).is_err(), "wrong anchor root");
}

#[test]
#[ignore = "real proofs"]
fn refuses_what_it_cannot_prove() {
    let w = world();
    let mut env = envelope(&w, 7 * ZEC);
    assert!(matches!(
        prove_holding(&w.sk, held(&w, &[0, 1, 2]), &w.imt, &mut env),
        Err(ProveError::Insufficient { .. })
    ));
    let mut env = envelope(&w, ZEC);
    let (n, pos) = w.spent_note;
    let spent = vec![HeldNote { note: n, merkle_path: w.tree.path(pos).unwrap(), scope: Scope::External }];
    assert!(matches!(prove_holding(&w.sk, spent, &w.imt, &mut env), Err(ProveError::Spent)));
    let mut env = envelope(&w, ZEC + 1);
    assert!(matches!(prove_holding(&w.sk, held(&w, &[0]), &w.imt, &mut env), Err(ProveError::NotWholeUnits)));
}

/// The circuit checks each note slot on its own, so a proof that repeats one note in all five
/// slots is a valid Halo2 proof of five times the holding. The verifier must refuse it.
#[test]
#[ignore = "real proofs"]
fn one_note_cannot_be_counted_twice() {
    use pof_core::signing_message;
    use pof_zk::round_id;
    use voting_circuits::delegation::{build_delegation_bundle, create_delegation_proof, verify_delegation_proof, RealNoteInput};
    use voting_crypto_deps::orchard::keys::{SpendAuthorizingKey, SpendValidatingKey};

    let w = world();
    let v = Verifier::new().unwrap();

    // The prover refuses outright.
    let mut env = envelope(&w, 5 * ZEC);
    assert!(matches!(prove_holding(&w.sk, held(&w, &[1, 1]), &w.imt, &mut env), Err(ProveError::DuplicateNote)));

    // A hand-built proof: the 3 ZEC note five times, claiming 15 ZEC.
    let mut rng = OsRng;
    let mut env = envelope(&w, 15 * ZEC);
    let fvk = FullViewingKey::from(&w.sk);
    let real = held(&w, &[1, 1, 1, 1, 1])
        .into_iter()
        .map(|h| RealNoteInput {
            imt_proof: w.imt.non_membership_proof(h.note.nullifier(&fvk).inner()).unwrap(),
            note: h.note,
            fvk: fvk.clone(),
            merkle_path: h.merkle_path,
            scope: h.scope,
        })
        .collect();
    let alpha = pallas::Scalar::random(&mut rng);
    let nc_root = pof_zk::base_from_bytes(&env.anchor.nc_root).unwrap();
    let bundle = build_delegation_bundle(
        real,
        &fvk,
        alpha,
        fvk.address_at(0u32, Scope::Internal),
        round_id(&env),
        nc_root,
        pallas::Base::random(&mut rng),
        &w.imt,
        &mut rng,
        None,
    )
    .unwrap();
    let instance = bundle.instance.with_min_ballots(15 * 8);
    let proof = create_delegation_proof(bundle.circuit, &instance).unwrap();
    assert!(verify_delegation_proof(&proof, &instance).is_ok(), "the circuit alone accepts the repeated note");

    let rk = SpendValidatingKey::from(fvk.clone()).randomize(&alpha);
    let mut inputs = vec![base_to_bytes(&instance.nf_signed.inner()), <[u8; 32]>::from(&rk)];
    inputs.push(base_to_bytes(&instance.cmx_new));
    inputs.push(base_to_bytes(&instance.van_comm));
    inputs.extend(instance.gov_null.iter().map(base_to_bytes));
    env.evidence.public_inputs = inputs;
    env.evidence.proof = proof;
    let sig = SpendAuthorizingKey::from(&w.sk).randomize(&alpha).sign(rng, &signing_message(&env));
    env.evidence.signature = <[u8; 64]>::from(&sig);
    assert_eq!(v.verify_holding(&env), Err(ZkError::DuplicateNote));
}

/// Circuit 2: an exit certificate publishes the real nullifiers of the notes it proves, so the
/// deposit can be matched to exactly them; editing one breaks the holder's signature.
#[test]
#[ignore = "real proofs"]
fn exit_certificate_names_its_notes() {
    let w = world();
    let v = Verifier::new().unwrap();
    let mut env = envelope_since(&w, 5 * ZEC, 7);
    env.circuit = pof_core::CIRCUIT_REVEAL;
    env.binding = pof_core::intent_binding("near-intents:quote-123");
    prove_holding(&w.sk, held_in(&w.old_tree, &w, &[0, 1]), &w.imt, &mut env).unwrap();
    assert_eq!(env.evidence.public_inputs.len(), pof_zk::CARRIED_INPUTS_REVEAL);
    v.verify_holding(&env).expect("exit certificate verifies");
    let (decoded, _) = pof_core::decode(&pof_core::encode(&env)).unwrap();
    v.verify_holding(&decoded).expect("survives the wire");

    let fvk = FullViewingKey::from(&w.sk);
    let revealed = pof_zk::revealed_nullifiers(&env).expect("reveal = 1");
    for i in [0, 1] {
        assert!(revealed.contains(&w.notes[i].0.nullifier(&fvk).to_bytes()), "note {i} is named");
    }
    assert!(!revealed.contains(&w.notes[2].0.nullifier(&fvk).to_bytes()), "an unproven note is not");

    let mut e = env.clone();
    e.evidence.public_inputs[10][0] ^= 1;
    assert!(v.verify_holding(&e).is_err(), "a swapped revealed nullifier");
    let mut e = env.clone();
    e.circuit = pof_core::CIRCUIT_THRESHOLD;
    assert!(v.verify_holding(&e).is_err(), "relabelled as a plain proof");
}
