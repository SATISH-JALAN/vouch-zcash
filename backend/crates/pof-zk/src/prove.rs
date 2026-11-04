//! Holder-side proving. Never compiled into the verifier or the WASM build.

use pof_core::{signing_message, Envelope, CIRCUIT_REVEAL, CIRCUIT_THRESHOLD, ZAT_PER_UNIT};
use voting_circuits::delegation::{build_delegation_bundle, create_delegation_proof, create_reveal_proof, ImtProvider, RealNoteInput, RevealCircuit};
use voting_circuits::ff::Field;
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendAuthorizingKey, SpendValidatingKey, SpendingKey},
    note::ExtractedNoteCommitment,
    tree::MerklePath,
    Note,
};
use voting_crypto_deps::pasta_curves::pallas;

use crate::{base_from_bytes, base_to_bytes, min_ballots, round_id, ZkError};

/// One of the holder's unspent Ironwood notes, with its path to the anchor's `nc_root`.
#[derive(Debug)]
pub struct HeldNote {
    pub note: Note,
    pub merkle_path: MerklePath,
    pub scope: Scope,
}

#[derive(Debug, thiserror::Error)]
pub enum ProveError {
    #[error("a holding proof can only assert HoldsAtLeast")]
    UnsupportedClaim,
    #[error("this prover has no circuit {0}")]
    UnsupportedCircuit(u8),
    #[error("the threshold must be a whole number of 0.125 ZEC units")]
    NotWholeUnits,
    #[error("between 1 and 5 notes are required, got {0}")]
    NoteCount(usize),
    #[error("the selected notes total {have} zatoshi, below the {need} zatoshi threshold")]
    Insufficient { have: u64, need: u64 },
    #[error("the envelope's anchor roots do not match the tree and IMT used for proving")]
    AnchorMismatch,
    #[error("a note's nullifier is already spent at this anchor")]
    Spent,
    #[error("the same note is selected more than once")]
    DuplicateNote,
    #[error("building the circuit failed: {0}")]
    Build(String),
    #[error("proving failed: {0}")]
    Prove(String),
}

impl From<ZkError> for ProveError {
    /// The claim checks the prover shares with the verifier ([`min_ballots`]).
    fn from(e: ZkError) -> Self {
        match e {
            ZkError::UnsupportedClaim => ProveError::UnsupportedClaim,
            ZkError::NotWholeUnits => ProveError::NotWholeUnits,
            ZkError::UnsupportedCircuit(c) => ProveError::UnsupportedCircuit(c),
            other => ProveError::Build(other.to_string()),
        }
    }
}

/// Fill `env.evidence` with a real proof that `notes` (owned by `sk`) total at least the claimed
/// threshold. Each note's `merkle_path` must lead to `env.anchor.nc_root` (the tree at
/// `nc_height`) and `imt` must be the spent set at `env.anchor.height`; when the two heights
/// differ the proof says the notes existed at `nc_height` and have not moved since. Every other
/// envelope field must already be final: the proof binds to them.
pub fn prove_holding(
    sk: &SpendingKey,
    notes: Vec<HeldNote>,
    imt: &impl ImtProvider,
    env: &mut Envelope,
) -> Result<(), ProveError> {
    if env.circuit != CIRCUIT_THRESHOLD && env.circuit != CIRCUIT_REVEAL {
        return Err(ProveError::UnsupportedCircuit(env.circuit));
    }
    let min = min_ballots(&env.claim)?;
    if notes.is_empty() || notes.len() > 5 {
        return Err(ProveError::NoteCount(notes.len()));
    }
    let have: u64 = notes.iter().map(|n| n.note.value().inner()).sum();
    // The circuit also needs at least one ballot (0.125 ZEC), whatever the claim.
    let need = env.claim.zatoshi().max(ZAT_PER_UNIT);
    if have < need {
        return Err(ProveError::Insufficient { have, need });
    }
    let nc_root = base_from_bytes(&env.anchor.nc_root).map_err(|_| ProveError::AnchorMismatch)?;
    if base_to_bytes(&imt.root()) != env.anchor.nf_root {
        return Err(ProveError::AnchorMismatch);
    }

    // Everything the circuit checks per note is checked here too, so a bad input fails with a
    // reason instead of producing a proof that will never verify.
    let fvk = FullViewingKey::from(sk);
    let mut rng = OsRng;
    let mut real = Vec::with_capacity(notes.len());
    let mut seen = Vec::with_capacity(notes.len());
    for held in notes {
        let nf = held.note.nullifier(&fvk);
        if seen.contains(&nf) {
            return Err(ProveError::DuplicateNote);
        }
        seen.push(nf);
        if held.merkle_path.root(ExtractedNoteCommitment::from(held.note.commitment())).to_bytes() != env.anchor.nc_root {
            return Err(ProveError::AnchorMismatch);
        }
        let imt_proof = imt.non_membership_proof(nf.inner()).map_err(|_| ProveError::Spent)?;
        real.push(RealNoteInput { note: held.note, fvk: fvk.clone(), merkle_path: held.merkle_path, imt_proof, scope: held.scope });
    }

    let alpha = pallas::Scalar::random(&mut rng);
    let bundle = build_delegation_bundle(
        real,
        &fvk,
        alpha,
        fvk.address_at(0u32, Scope::Internal),
        round_id(env),
        nc_root,
        pallas::Base::random(&mut rng),
        imt,
        &mut rng,
        None,
    )
    .map_err(|e| ProveError::Build(e.to_string()))?;
    let instance = bundle.instance.with_min_ballots(min);
    // Circuit 2 (an exit certificate) publishes the notes' real nullifiers, so the recipient can
    // match the deposit to exactly these notes.
    let (instance, proof) = if env.circuit == CIRCUIT_REVEAL {
        let instance = instance.with_reveal(true, bundle.real_nullifiers);
        let proof = create_reveal_proof(RevealCircuit(bundle.circuit), &instance);
        (instance, proof)
    } else {
        let proof = create_delegation_proof(bundle.circuit, &instance);
        (instance, proof)
    };
    let proof = proof.map_err(|e| ProveError::Prove(e.to_string()))?;

    let rk = SpendValidatingKey::from(fvk.clone()).randomize(&alpha);
    env.evidence.public_inputs = [
        base_to_bytes(&instance.nf_signed.inner()),
        <[u8; 32]>::from(&rk),
        base_to_bytes(&instance.cmx_new),
        base_to_bytes(&instance.van_comm),
    ]
    .into_iter()
    .chain(instance.gov_null.iter().map(base_to_bytes))
    .chain(instance.reveal.iter().flat_map(|(flag, nfs)| std::iter::once(base_to_bytes(flag)).chain(nfs.iter().map(base_to_bytes))))
    .collect();
    env.evidence.proof = proof;

    let rsk = SpendAuthorizingKey::from(sk).randomize(&alpha);
    let sig = rsk.sign(rng, &signing_message(env));
    env.evidence.signature = <[u8; 64]>::from(&sig);
    Ok(())
}
