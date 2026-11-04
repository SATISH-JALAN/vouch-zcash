//! A dense Ironwood note-commitment tree (Sinsemilla, depth 32) over a known leaf list.
//! Used to recompute `nc_root` from public chain data and to cut Merkle paths for the prover.

use incrementalmerkletree::{Hashable, Level};
use voting_crypto_deps::orchard::{tree::MerkleHashOrchard, tree::MerklePath, NOTE_COMMITMENT_TREE_DEPTH};

const DEPTH: usize = NOTE_COMMITMENT_TREE_DEPTH;

#[derive(Clone, Debug)]
pub struct NoteTree {
    /// `levels[h]` holds every node at height `h`, padded to even length.
    levels: Vec<Vec<MerkleHashOrchard>>,
    root: MerkleHashOrchard,
    size: usize,
}

impl NoteTree {
    /// Leaves are extracted note commitments (`cmx`), in chain order. Returns `None` if any
    /// is not a canonical field element.
    pub fn from_cmx(leaves: &[[u8; 32]]) -> Option<Self> {
        let mut level = Vec::with_capacity(leaves.len() + 1);
        for l in leaves {
            level.push(Option::<MerkleHashOrchard>::from(MerkleHashOrchard::from_bytes(l))?);
        }
        let size = level.len();
        let mut levels = Vec::with_capacity(DEPTH);
        for h in 0..DEPTH {
            let lvl = Level::from(h as u8);
            // Pad to an even, non-zero length: an empty tree still has a (empty) root.
            if level.is_empty() {
                level.push(MerkleHashOrchard::empty_root(lvl));
            }
            if level.len() % 2 == 1 {
                level.push(MerkleHashOrchard::empty_root(lvl));
            }
            let next = combine_level(lvl, &level);
            levels.push(level);
            level = next;
        }
        Some(NoteTree { levels, root: level[0], size })
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn root(&self) -> [u8; 32] {
        self.root.to_bytes()
    }

    pub fn path(&self, position: u32) -> Option<MerklePath> {
        if position as usize >= self.size {
            return None;
        }
        let mut idx = position as usize;
        let mut auth = [MerkleHashOrchard::empty_leaf(); DEPTH];
        for (h, slot) in auth.iter_mut().enumerate() {
            *slot = self.levels[h][idx ^ 1];
            idx >>= 1;
        }
        Some(MerklePath::from_parts(position, auth))
    }
}

/// One level up. Large levels are split across threads when `parallel` is on.
fn combine_level(lvl: Level, level: &[MerkleHashOrchard]) -> Vec<MerkleHashOrchard> {
    #[cfg(feature = "parallel")]
    if level.len() > 8_192 {
        use rayon::prelude::*;
        return level
            .par_chunks(4_096)
            .flat_map_iter(|chunk| MerkleHashOrchard::combine_batch(lvl, chunk.chunks(2).map(|p| (&p[0], &p[1]))))
            .collect();
    }
    MerkleHashOrchard::combine_batch(lvl, level.chunks(2).map(|p| (&p[0], &p[1])))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_tree_has_the_empty_root() {
        let t = NoteTree::from_cmx(&[]).unwrap();
        assert_eq!(t.size(), 0);
        assert_eq!(t.root(), MerkleHashOrchard::empty_root(Level::from(DEPTH as u8)).to_bytes());
        assert!(t.path(0).is_none());
    }
}
