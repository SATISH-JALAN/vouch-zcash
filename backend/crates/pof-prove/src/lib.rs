//! The holder's side: requests in, `proof.pof` out.
//!
//! Stages: open the holder's notes → pin an anchor (both roots) → select the fewest, largest
//! notes that clear the threshold → Merkle and IMT witnesses → prove and sign → envelope.
//! Nothing here broadcasts anything: there is no transaction type in this crate's graph that
//! could be sent, and `tests/no_broadcast.rs` keeps it that way.

pub mod history;
pub mod request;
pub mod wallet;
pub mod world;

use pof_core::{audience_hash, revocation_tag, Anchor, Claim, Envelope, Evidence, CIRCUIT_THRESHOLD, FORMAT_VERSION, ZAT_PER_UNIT};
use pof_zk::{base_to_bytes, prove_holding, DenseImtProvider, HeldNote, ImtProvider, NoteTree};
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    Note,
};

pub use request::ProofRequest;

/// A note the holder owns, and where it sits in the commitment tree.
#[derive(Clone, Debug)]
pub struct OwnedNote {
    pub note: Note,
    pub position: u32,
    pub scope: Scope,
}

/// Everything needed to prove against one anchor: the note-commitment tree at `nc_height` and
/// the spent set at `height`. With the two heights equal it is a plain "as of" proof; with
/// `nc_height` earlier the proof says the notes have not moved since then.
pub struct Snapshot {
    pub network: String,
    pub height: u32,
    pub tree: NoteTree,
    pub imt: DenseImtProvider,
    pub nc_height: u32,
}

impl Snapshot {
    pub fn anchor(&self) -> Anchor {
        Anchor { height: self.height, nc_root: self.tree.root(), nf_root: base_to_bytes(&self.imt.root()), nc_height: self.nc_height }
    }

    /// Prove against the tree as it stood at `nc_height` (an earlier block), keeping this spent set.
    pub fn since(self, tree: NoteTree, nc_height: u32) -> Self {
        assert!(nc_height <= self.height, "the tree must be from the same block or an earlier one");
        Snapshot { tree, nc_height, ..self }
    }
}

/// A scope of its own for a proof whose verifier named no epoch: the first six bytes of its
/// (already public) revocation tag. Its tags then match no other proof's, as in version 1.
pub fn fresh_epoch(revocation: &[u8; 16]) -> u64 {
    let mut b = [0u8; 8];
    b[..6].copy_from_slice(&revocation[..6]);
    u64::from_le_bytes(b)
}

#[derive(Debug, thiserror::Error)]
pub enum SelectError {
    #[error("no combination of up to 5 unspent notes reaches {need} zatoshi (largest 5 total {best})")]
    Insufficient { need: u64, best: u64 },
}

/// Fewest, largest notes first. Fewer notes means a smaller statement about how the holder's
/// money is arranged; never include a note that is not needed.
pub fn select_notes(notes: &[OwnedNote], need_zat: u64, is_unspent: impl Fn(&OwnedNote) -> bool) -> Result<Vec<OwnedNote>, SelectError> {
    let mut pool: Vec<&OwnedNote> = notes.iter().filter(|n| is_unspent(n)).collect();
    pool.sort_by_key(|n| std::cmp::Reverse(n.note.value().inner()));
    // Proven in whole 0.125 ZEC units, so compare in units.
    let need_units = need_zat.div_ceil(ZAT_PER_UNIT);
    let units = |v: &[&OwnedNote]| v.iter().map(|n| n.note.value().inner()).sum::<u64>() / ZAT_PER_UNIT;
    // Smallest single note that clears it on its own reveals the least structure.
    if let Some(single) = pool.iter().rev().find(|n| n.note.value().inner() / ZAT_PER_UNIT >= need_units) {
        return Ok(vec![(*single).clone()]);
    }
    let mut chosen: Vec<&OwnedNote> = Vec::new();
    for n in &pool {
        if chosen.len() == 5 {
            break;
        }
        chosen.push(n);
        if units(&chosen) >= need_units {
            return Ok(chosen.into_iter().cloned().collect());
        }
    }
    Err(SelectError::Insufficient { need: need_zat, best: pool.iter().take(5).map(|n| n.note.value().inner()).sum() })
}

/// Build the envelope a request asks for, with empty evidence, in the latest format. Every field
/// here is bound into the proof. The scope is the request's epoch when it names one; otherwise
/// the proof gets a scope of its own ([`fresh_epoch`]), so nobody can link it to another.
pub fn envelope_for(req: &ProofRequest, anchor: Anchor, now: u64, binding: [u8; 32], revocation_secret: &[u8; 32]) -> Envelope {
    let revocation = revocation_tag(revocation_secret);
    Envelope {
        version: FORMAT_VERSION,
        circuit: CIRCUIT_THRESHOLD,
        claim: Claim::HoldsAtLeast { zatoshi: req.zatoshi },
        audience: audience_hash(&req.audience),
        epoch: req.epoch.unwrap_or_else(|| fresh_epoch(&revocation)),
        binding,
        anchor,
        issued_at: now,
        expires_at: now + req.expiry_days as u64 * 86_400,
        revocation,
        evidence: Evidence { public_inputs: vec![], proof: vec![], signature: [0; 64] },
    }
}

/// Split the holder's usable notes into reserves-batch members of at most `size` notes (the
/// circuit takes five), largest first. Members that cannot clear one 0.125 ZEC unit are dropped:
/// they would add a proof and nothing to the total.
pub fn batch_groups(mut notes: Vec<OwnedNote>, size: usize) -> Vec<Vec<OwnedNote>> {
    let size = size.clamp(1, 5);
    notes.sort_by_key(|n| std::cmp::Reverse(n.note.value().inner()));
    notes
        .chunks(size)
        .map(<[OwnedNote]>::to_vec)
        .filter(|g| g.iter().map(|n| n.note.value().inner()).sum::<u64>() >= ZAT_PER_UNIT)
        .collect()
}

/// A reserves batch: one proof per group, all in `template`'s scope and against its anchor, each
/// claiming the whole 0.125 ZEC units its group holds. The members share the template's
/// revocation tag, so publishing one secret revokes the whole batch.
pub fn prove_batch(sk: &SpendingKey, groups: &[Vec<OwnedNote>], snap: &Snapshot, template: &Envelope) -> anyhow::Result<Vec<Envelope>> {
    groups
        .iter()
        .map(|g| {
            let units = g.iter().map(|n| n.note.value().inner()).sum::<u64>() / ZAT_PER_UNIT;
            let mut env = template.clone();
            env.claim = Claim::HoldsAtLeast { zatoshi: units * ZAT_PER_UNIT };
            prove(sk, g, snap, &mut env)?;
            Ok(env)
        })
        .collect()
}

/// Stages 3–7: select, witness, prove, sign. `env` must be otherwise final.
pub fn prove(sk: &SpendingKey, notes: &[OwnedNote], snap: &Snapshot, env: &mut Envelope) -> anyhow::Result<usize> {
    let fvk = FullViewingKey::from(sk);
    let need = env.claim.zatoshi();
    // Only notes already in the tree at nc_height can be shown unmoved since then.
    let in_tree = |n: &OwnedNote| (n.position as usize) < snap.tree.size();
    let picked = match select_notes(notes, need, |n| in_tree(n) && snap.imt.non_membership_proof(n.note.nullifier(&fvk).inner()).is_ok()) {
        Ok(picked) => picked,
        Err(e) if snap.nc_height < snap.height && notes.iter().any(|n| !in_tree(n)) => {
            anyhow::bail!("{e}. Notes that arrived after block {} do not count: they cannot be shown unmoved since then.", snap.nc_height)
        }
        Err(e) => return Err(e.into()),
    };
    prove_exact(sk, &picked, snap, env)
}

/// Prove with exactly these notes (at most five), rather than the fewest that clear the claim.
/// An exit certificate uses it: it must name every note the wallet might spend in the deposit.
pub fn prove_exact(sk: &SpendingKey, notes: &[OwnedNote], snap: &Snapshot, env: &mut Envelope) -> anyhow::Result<usize> {
    let held = notes
        .iter()
        .map(|n| {
            let merkle_path = snap.tree.path(n.position).ok_or_else(|| {
                anyhow::anyhow!("a selected note (position {}) arrived after block {}, so it cannot be shown unmoved since then", n.position, snap.nc_height)
            })?;
            Ok(HeldNote { note: n.note, merkle_path, scope: n.scope })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    prove_holding(sk, held, &snap.imt, env)?;
    Ok(notes.len())
}
