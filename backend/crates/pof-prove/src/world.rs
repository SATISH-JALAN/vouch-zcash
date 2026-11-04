//! The demo world: a committed, synthetic Ironwood-shaped ledger with one demo holder.
//!
//! It exists so anyone can produce and check *real* Halo2 proofs without owning ZEC. Its
//! anchor is published with `network: "demo"` and every surface labels it as such: the notes
//! are real Ironwood V3 notes under a real key, but the tree is ours, not mainnet's.

use serde::{Deserialize, Serialize};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{commitment::ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho},
    value::NoteValue,
    Address,
};
use voting_crypto_deps::pasta_curves::pallas;

use crate::{OwnedNote, Snapshot};
use pof_zk::{DenseImtProvider, NoteTree};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNote {
    pub address: String,
    pub value: u64,
    pub rho: String,
    pub rseed: String,
    pub position: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoWorld {
    pub network: String,
    pub height: u32,
    /// Demo only. This key controls synthetic notes in a synthetic tree and nothing else.
    pub spending_key: String,
    pub holder: Vec<StoredNote>,
    pub leaves: Vec<String>,
    pub spent: Vec<String>,
    /// Earlier blocks of the demo ledger: how many leaves the tree had then. The demo's spent
    /// set never changes, so a checkpoint only cuts the tree.
    #[serde(default)]
    pub checkpoints: Vec<WorldCheckpoint>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldCheckpoint {
    pub height: u32,
    pub leaves: usize,
}

/// How far before the demo anchor its one checkpoint sits.
pub const DEMO_CHECKPOINT_BACK: u32 = 10_040;

const ZEC: u64 = 100_000_000;

fn hex_array<const N: usize>(h: &str, what: &str) -> anyhow::Result<[u8; N]> {
    hex::decode(h).ok().and_then(|v| v.try_into().ok()).ok_or_else(|| anyhow::anyhow!("bad {what}: expected {N} bytes of hex"))
}

/// The demo holder's notes: 4,018.2 ZEC across five notes, the figure the landing page uses.
pub const DEMO_NOTES_ZAT: [u64; 5] = [1_500 * ZEC, 1_200 * ZEC, 800 * ZEC, 318 * ZEC + 20_000_000, 200 * ZEC];

impl DemoWorld {
    pub fn generate(height: u32, strangers: usize) -> Self {
        let mut rng = OsRng;
        let sk = SpendingKey::random(&mut rng);
        let fvk = FullViewingKey::from(&sk);
        let random_base = |rng: &mut OsRng| hex::encode(pallas::Base::random(rng).to_repr());
        let mut leaves: Vec<String> = (0..strangers).map(|_| random_base(&mut rng)).collect();
        let spent: Vec<String> = (0..strangers / 2).map(|_| random_base(&mut rng)).collect();
        let mut holder = Vec::new();
        for (i, value) in DEMO_NOTES_ZAT.iter().enumerate() {
            let (_, _, dummy) = Note::dummy(&mut rng, None, NoteVersion::V3);
            let note = Note::new(
                fvk.address_at(i as u32, Scope::External),
                NoteValue::from_raw(*value),
                Rho::from_nf_old(dummy.nullifier(&fvk)),
                NoteVersion::V3,
                &mut rng,
            );
            // spread the holder's notes through the tree: after (i+1)/6 of the strangers and the
            // holder's earlier notes, so positions strictly increase and no insert shifts one
            let position = ((i + 1) * strangers / 6 + i) as u32;
            leaves.insert(position as usize, hex::encode(ExtractedNoteCommitment::from(note.commitment()).to_bytes()));
            holder.push(StoredNote {
                address: hex::encode(note.recipient().to_raw_address_bytes()),
                value: *value,
                rho: hex::encode(note.rho().to_bytes()),
                rseed: hex::encode(note.rseed().as_bytes()),
                position,
            });
        }
        // The tree before the holder's last note (200 ZEC): the other four are "unmoved since" then.
        let checkpoints = vec![WorldCheckpoint { height: height.saturating_sub(DEMO_CHECKPOINT_BACK), leaves: holder[4].position as usize }];
        DemoWorld { network: "demo".into(), height, spending_key: hex::encode(sk.to_bytes()), holder, leaves, spent, checkpoints }
    }

    pub fn spending_key(&self) -> anyhow::Result<SpendingKey> {
        Option::from(SpendingKey::from_bytes(hex_array(&self.spending_key, "demo key")?)).ok_or_else(|| anyhow::anyhow!("invalid demo key"))
    }

    pub fn notes(&self) -> anyhow::Result<Vec<OwnedNote>> {
        self.holder
            .iter()
            .map(|s| {
                let rho: [u8; 32] = hex_array(&s.rho, "rho")?;
                let recipient = Option::<Address>::from(Address::from_raw_address_bytes(&hex_array(&s.address, "address")?)).ok_or_else(|| anyhow::anyhow!("bad address"))?;
                let rho = Option::<Rho>::from(Rho::from_bytes(&rho)).ok_or_else(|| anyhow::anyhow!("bad rho"))?;
                let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes(hex_array(&s.rseed, "rseed")?, &rho)).ok_or_else(|| anyhow::anyhow!("bad rseed"))?;
                let note = Option::<Note>::from(Note::from_parts(recipient, NoteValue::from_raw(s.value), rho, rseed, NoteVersion::V3))
                    .ok_or_else(|| anyhow::anyhow!("note does not commit"))?;
                Ok(OwnedNote { note, position: s.position, scope: Scope::External })
            })
            .collect()
    }

    pub fn snapshot(&self) -> anyhow::Result<Snapshot> {
        let leaves = self.leaves.iter().map(|h| hex_array(h, "leaf")).collect::<anyhow::Result<Vec<[u8; 32]>>>()?;
        let spent = self
            .spent
            .iter()
            .map(|h| pof_zk::base_from_bytes(&hex_array(h, "nullifier")?).map_err(|e| anyhow::anyhow!(e)))
            .collect::<anyhow::Result<Vec<pallas::Base>>>()?;
        Ok(Snapshot {
            network: self.network.clone(),
            height: self.height,
            tree: NoteTree::from_cmx(&leaves).ok_or_else(|| anyhow::anyhow!("non-canonical leaf"))?,
            imt: DenseImtProvider::from_nullifiers(&spent),
            nc_height: self.height,
        })
    }

    /// The tree as it stood at an earlier checkpoint, with today's spent set: a snapshot for
    /// "unmoved since `height`" proofs.
    pub fn snapshot_since(&self, height: u32) -> anyhow::Result<Snapshot> {
        let cp = self.checkpoints.iter().find(|c| c.height == height).ok_or_else(|| anyhow::anyhow!("the demo ledger has no checkpoint at block {height}"))?;
        let leaves = self.leaves[..cp.leaves.min(self.leaves.len())].iter().map(|h| hex_array(h, "leaf")).collect::<anyhow::Result<Vec<[u8; 32]>>>()?;
        let old = NoteTree::from_cmx(&leaves).ok_or_else(|| anyhow::anyhow!("non-canonical leaf"))?;
        Ok(self.snapshot()?.since(old, height))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every stored position holds that note's commitment, however few strangers there are.
    #[test]
    fn holder_positions_match_the_tree() {
        for strangers in [0, 1, 2, 3, 4, 5, 6, 7, 12, 64] {
            let w = DemoWorld::generate(1, strangers);
            assert_eq!(w.leaves.len(), strangers + DEMO_NOTES_ZAT.len());
            for (n, s) in w.notes().unwrap().iter().zip(&w.holder) {
                assert_eq!(w.leaves[s.position as usize], hex::encode(ExtractedNoteCommitment::from(n.note.commitment()).to_bytes()), "strangers {strangers}");
            }
        }
    }
}
