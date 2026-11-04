//! Anchors from public data.
//!
//! A Vouch proof is checked against two roots at one finalised height: the Ironwood
//! note-commitment tree root (`nc_root`) and the root of the indexed Merkle tree of every
//! Ironwood nullifier revealed so far (`nf_root`). lightwalletd serves the first; nobody serves
//! the second. Both are recomputed here from compact blocks, so anyone can rebuild any anchor
//! Vouch publishes, and nobody has to take our word for one.
//!
//! A *snapshot* is every Ironwood compact action from activation to a height, in chain order:
//! the public data a verifier needs for the roots and a holder needs to find their own notes.
//!
//! ```text
//!  magic "VSNP" · u16 version · u8 network len · network · u32 height · 32 block hash ·
//!  u64 count · count × (nullifier 32 · cmx 32 · epk 32 · compact ciphertext 52) ·
//!  [v2] u32 n · n × (u32 height · u64 actions so far · 32 block hash) · blake2b-256
//! ```
//!
//! The checkpoints (every 1,000th block and the last) let one snapshot answer for an earlier
//! block too: the tree at a checkpoint is the first `actions` leaves.

use std::io::{Read, Write};

use pof_zk::{base_from_bytes, base_to_bytes, DenseImtProvider, ImtProvider, NoteTree};
use serde::{Deserialize, Serialize};
use voting_crypto_deps::pasta_curves::pallas;

#[cfg(feature = "client")]
pub mod client;

/// First block of the Ironwood pool on mainnet (NU6.3).
pub const IRONWOOD_ACTIVATION_MAINNET: u32 = 3_428_143;
/// First block of the Ironwood pool on testnet (NU6.3, ZIP 258).
pub const IRONWOOD_ACTIVATION_TESTNET: u32 = 4_134_000;

/// The networks anchors are rebuilt for, with the defaults each one needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet,
}

impl Network {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "mainnet" => Some(Network::Mainnet),
            "testnet" => Some(Network::Testnet),
            _ => None,
        }
    }

    /// The label written into snapshots and anchor records.
    pub fn name(self) -> &'static str {
        match self {
            Network::Mainnet => "mainnet",
            Network::Testnet => "testnet",
        }
    }

    pub fn ironwood_activation(self) -> u32 {
        match self {
            Network::Mainnet => IRONWOOD_ACTIVATION_MAINNET,
            Network::Testnet => IRONWOOD_ACTIVATION_TESTNET,
        }
    }

    /// A public lightwalletd for this network.
    pub fn default_server(self) -> &'static str {
        match self {
            Network::Mainnet => "https://zec.rocks:443",
            Network::Testnet => "https://testnet.zec.rocks:443",
        }
    }

    /// What lightwalletd reports as `chain_name` for this network.
    pub fn chain_name(self) -> &'static str {
        match self {
            Network::Mainnet => "main",
            Network::Testnet => "test",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub nullifier: [u8; 32],
    pub cmx: [u8; 32],
    pub epk: [u8; 32],
    pub ciphertext: [u8; 52],
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub network: String,
    pub height: u32,
    pub block_hash: [u8; 32],
    pub actions: Vec<Action>,
    /// Where the chain stood at earlier blocks inside the scan: every 1,000th block and the last.
    /// One snapshot then gives the tree at an older block (`at`), for "unmoved since" proofs.
    pub checkpoints: Vec<Checkpoint>,
}

/// The number of Ironwood actions up to and including `height`, and that block's hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    pub height: u32,
    pub actions: u64,
    pub block_hash: [u8; 32],
}

/// Checkpoints are kept at multiples of this many blocks.
pub const CHECKPOINT_EVERY: u32 = 1_000;

/// Mirrors `pof_verify::AnchorRecord` (JSON, camelCase).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorRecord {
    pub network: String,
    pub height: u32,
    #[serde(default)]
    pub block_hash: Option<String>,
    pub nc_root: String,
    pub nf_root: String,
}

const MAGIC: &[u8; 4] = b"VSNP";
/// Version 2 appends the checkpoint table; version 1 files still read (one checkpoint, the end).
const VERSION: u16 = 2;
const RECORD: usize = 32 + 32 + 32 + 52;
const CHECKPOINT: usize = 4 + 8 + 32;

impl Snapshot {
    pub fn write(&self, w: &mut impl Write) -> anyhow::Result<()> {
        anyhow::ensure!(self.network.len() <= 255, "network name longer than 255 bytes");
        let mut buf = Vec::with_capacity(64 + self.actions.len() * RECORD);
        buf.extend_from_slice(MAGIC);
        buf.extend_from_slice(&VERSION.to_le_bytes());
        buf.push(self.network.len() as u8);
        buf.extend_from_slice(self.network.as_bytes());
        buf.extend_from_slice(&self.height.to_le_bytes());
        buf.extend_from_slice(&self.block_hash);
        buf.extend_from_slice(&(self.actions.len() as u64).to_le_bytes());
        for a in &self.actions {
            buf.extend_from_slice(&a.nullifier);
            buf.extend_from_slice(&a.cmx);
            buf.extend_from_slice(&a.epk);
            buf.extend_from_slice(&a.ciphertext);
        }
        buf.extend_from_slice(&(self.checkpoints.len() as u32).to_le_bytes());
        for cp in &self.checkpoints {
            buf.extend_from_slice(&cp.height.to_le_bytes());
            buf.extend_from_slice(&cp.actions.to_le_bytes());
            buf.extend_from_slice(&cp.block_hash);
        }
        let sum = blake2b_simd::Params::new().hash_length(32).hash(&buf);
        buf.extend_from_slice(sum.as_bytes());
        w.write_all(&buf)?;
        Ok(())
    }

    /// Snapshots are downloaded files: every malformed one is an error, never a panic.
    pub fn read(r: &mut impl Read) -> anyhow::Result<Self> {
        let mut b = Vec::new();
        r.read_to_end(&mut b)?;
        anyhow::ensure!(b.len() > 4 + 2 + 1 + 4 + 32 + 8 + 32, "snapshot too short");
        let (body, sum) = b.split_at(b.len() - 32);
        anyhow::ensure!(blake2b_simd::Params::new().hash_length(32).hash(body).as_bytes() == sum, "snapshot checksum mismatch");
        let mut c = Cursor(body);
        anyhow::ensure!(&c.array::<4>()? == MAGIC, "not a Vouch snapshot");
        let version = u16::from_le_bytes(c.array()?);
        anyhow::ensure!(version == 1 || version == VERSION, "unknown snapshot version");
        let [nlen] = c.array()?;
        let network = String::from_utf8(c.take(nlen as usize)?.to_vec())?;
        let height = u32::from_le_bytes(c.array()?);
        let block_hash = c.array()?;
        let count = u64::from_le_bytes(c.array()?);
        let len = usize::try_from(count).ok().and_then(|n| n.checked_mul(RECORD)).ok_or_else(|| anyhow::anyhow!("snapshot count is too large"))?;
        let records = if version == 1 { std::mem::take(&mut c.0) } else { c.take(len)? };
        let (records, rest) = records.as_chunks::<RECORD>();
        anyhow::ensure!(rest.is_empty() && records.len() as u64 == count, "snapshot length does not match its count");
        let actions = records
            .iter()
            .map(|rec| {
                let mut c = Cursor(rec);
                Ok(Action { nullifier: c.array()?, cmx: c.array()?, epk: c.array()?, ciphertext: c.array()? })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let checkpoints = if version == 1 {
            vec![Checkpoint { height, actions: count, block_hash }]
        } else {
            let n = u32::from_le_bytes(c.array()?) as usize;
            let (cps, rest) = c.0.as_chunks::<CHECKPOINT>();
            anyhow::ensure!(rest.is_empty() && cps.len() == n, "snapshot checkpoint table does not match its count");
            cps.iter()
                .map(|b| {
                    let mut c = Cursor(b);
                    Ok(Checkpoint { height: u32::from_le_bytes(c.array()?), actions: u64::from_le_bytes(c.array()?), block_hash: c.array()? })
                })
                .collect::<anyhow::Result<Vec<_>>>()?
        };
        // Ordered, inside the snapshot, and never more actions than it holds.
        let ordered = checkpoints.windows(2).all(|w| w[0].height < w[1].height && w[0].actions <= w[1].actions);
        anyhow::ensure!(ordered && checkpoints.iter().all(|cp| cp.height <= height && cp.actions <= count), "snapshot checkpoints are inconsistent");
        Ok(Snapshot { network, height, block_hash, actions, checkpoints })
    }

    /// The chain as it stood at an earlier checkpoint: the same actions, cut at that block.
    pub fn at(&self, height: u32) -> anyhow::Result<Snapshot> {
        if height == self.height {
            return Ok(self.clone());
        }
        let cp = self.checkpoints.iter().find(|cp| cp.height == height).ok_or_else(|| {
            anyhow::anyhow!("this snapshot has no checkpoint at block {height}; scan again with pof-anchor (checkpoints fall every {CHECKPOINT_EVERY} blocks)")
        })?;
        Ok(Snapshot {
            network: self.network.clone(),
            height,
            block_hash: cp.block_hash,
            actions: self.actions[..cp.actions as usize].to_vec(),
            checkpoints: self.checkpoints.iter().copied().filter(|c| c.height <= height).collect(),
        })
    }

    pub fn tree(&self) -> anyhow::Result<NoteTree> {
        let leaves: Vec<[u8; 32]> = self.actions.iter().map(|a| a.cmx).collect();
        NoteTree::from_cmx(&leaves).ok_or_else(|| anyhow::anyhow!("a note commitment is not canonical"))
    }

    pub fn imt(&self) -> anyhow::Result<DenseImtProvider> {
        let nfs = self
            .actions
            .iter()
            .map(|a| base_from_bytes(&a.nullifier).map_err(|e| anyhow::anyhow!(e)))
            .collect::<anyhow::Result<Vec<pallas::Base>>>()?;
        Ok(DenseImtProvider::from_nullifiers(&nfs))
    }

    /// Both roots, and the record verifiers trust.
    pub fn anchor(&self) -> anyhow::Result<(NoteTree, DenseImtProvider, AnchorRecord)> {
        let tree = self.tree()?;
        let imt = self.imt()?;
        let mut hash = self.block_hash;
        hash.reverse(); // display order, as explorers show it
        let record = AnchorRecord {
            network: self.network.clone(),
            height: self.height,
            block_hash: Some(hex::encode(hash)),
            nc_root: hex::encode(tree.root()),
            nf_root: hex::encode(base_to_bytes(&imt.root())),
        };
        Ok((tree, imt, record))
    }
}

/// A bounds-checked reader over a byte slice.
struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> anyhow::Result<&'a [u8]> {
        anyhow::ensure!(n <= self.0.len(), "snapshot truncated");
        let (head, rest) = self.0.split_at(n);
        self.0 = rest;
        Ok(head)
    }

    fn array<const N: usize>(&mut self) -> anyhow::Result<[u8; N]> {
        Ok(self.take(N)?.try_into()?)
    }
}

/// Merge `record` into an anchor table file, keeping it sorted and free of duplicates. A
/// published anchor is never silently replaced: a different record for the same network and
/// height is an error, and the file is left as it was.
pub fn publish(path: &std::path::Path, record: AnchorRecord) -> anyhow::Result<Vec<AnchorRecord>> {
    let mut table: Vec<AnchorRecord> = match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => return Err(e.into()),
    };
    table.push(record);
    // stable, so identical records end up adjacent and dedup removes them
    table.sort_by(|a, b| (&a.network, a.height).cmp(&(&b.network, b.height)));
    table.dedup();
    if let Some(w) = table.windows(2).find(|w| w[0].network == w[1].network && w[0].height == w[1].height) {
        anyhow::bail!("{} already has a different anchor for {} block {}: not replacing it", path.display(), w[0].network, w[0].height);
    }
    // temp file, then rename: a failed write never leaves a truncated table
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&table)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn networks_have_their_own_defaults() {
        for n in [Network::Mainnet, Network::Testnet] {
            assert_eq!(Network::parse(n.name()), Some(n));
        }
        assert_eq!(Network::parse("demo"), None);
        assert_eq!(Network::Testnet.ironwood_activation(), 4_134_000);
        assert_eq!(Network::Testnet.chain_name(), "test");
        assert!(Network::Testnet.default_server().contains("testnet"));
    }

    fn snapshot() -> Snapshot {
        let action = |i: u8| Action { nullifier: [i; 32], cmx: [i + 1; 32], epk: [i + 2; 32], ciphertext: [i + 3; 52] };
        let checkpoints = vec![
            Checkpoint { height: 3_492_000, actions: 1, block_hash: [8; 32] },
            Checkpoint { height: 3_493_000, actions: 2, block_hash: [9; 32] },
        ];
        Snapshot { network: "mainnet".into(), height: 3_493_000, block_hash: [9; 32], actions: vec![action(1), action(10)], checkpoints }
    }

    fn bytes(s: &Snapshot) -> Vec<u8> {
        let mut b = vec![];
        s.write(&mut b).unwrap();
        b
    }

    /// Re-seal a crafted body the way a forger would, so it passes the checksum.
    fn seal(mut body: Vec<u8>) -> Vec<u8> {
        let sum = blake2b_simd::Params::new().hash_length(32).hash(&body);
        body.extend_from_slice(sum.as_bytes());
        body
    }

    #[test]
    fn round_trips() {
        let s = snapshot();
        let back = Snapshot::read(&mut &bytes(&s)[..]).unwrap();
        assert_eq!((back.network, back.height, back.block_hash, back.actions), (s.network, s.height, s.block_hash, s.actions));
        assert_eq!(back.checkpoints, s.checkpoints);
    }

    #[test]
    fn an_earlier_checkpoint_cuts_the_actions() {
        let s = snapshot();
        let old = s.at(3_492_000).unwrap();
        assert_eq!((old.height, old.block_hash, old.actions.len()), (3_492_000, [8; 32], 1));
        assert_eq!(old.actions[0], s.actions[0]);
        assert!(s.at(3_492_500).is_err(), "no checkpoint there");
    }

    #[test]
    fn inconsistent_checkpoints_are_refused() {
        let mut s = snapshot();
        s.checkpoints[0].actions = 3;
        assert!(Snapshot::read(&mut &bytes(&s)[..]).is_err(), "more actions than the snapshot holds");
        let mut s = snapshot();
        s.checkpoints.swap(0, 1);
        assert!(Snapshot::read(&mut &bytes(&s)[..]).is_err(), "out of order");
    }

    #[test]
    fn crafted_files_are_errors_not_panics() {
        let good = bytes(&snapshot());
        let body = good[..good.len() - 32].to_vec();
        let count_at = 4 + 2 + 1 + 7 + 4 + 32;
        let mut cases = vec![];
        // network length past the end of the file
        let mut b = body[..100].to_vec();
        b[6] = 255;
        cases.push(b);
        // count that overflows count * RECORD
        let mut b = body.clone();
        b[count_at..count_at + 8].copy_from_slice(&u64::MAX.to_le_bytes());
        cases.push(b);
        // count one more than the records present, and a partial record
        let mut b = body.clone();
        b[count_at..count_at + 8].copy_from_slice(&3u64.to_le_bytes());
        cases.push(b);
        let mut b = body.clone();
        b.truncate(b.len() - 1);
        cases.push(b);
        // header cut inside the block hash
        cases.push(body[..count_at - 5].to_vec());
        for (i, b) in cases.into_iter().enumerate() {
            assert!(Snapshot::read(&mut &seal(b)[..]).is_err(), "case {i}");
        }
        for n in 0..good.len() {
            assert!(Snapshot::read(&mut &good[..n]).is_err());
        }
    }

    #[test]
    fn long_network_names_are_refused() {
        let s = Snapshot { network: "x".repeat(256), ..snapshot() };
        assert!(s.write(&mut vec![]).is_err());
    }

    #[test]
    fn publish_merges_and_never_replaces() {
        let dir = std::env::temp_dir().join(format!("pof-anchor-publish-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("anchors.json");
        let rec = |network: &str, height: u32, root: &str| AnchorRecord {
            network: network.into(),
            height,
            block_hash: Some("00".repeat(32)),
            nc_root: root.into(),
            nf_root: root.into(),
        };
        assert_eq!(publish(&path, rec("mainnet", 2, "aa")).unwrap().len(), 1);
        assert_eq!(publish(&path, rec("mainnet", 1, "bb")).unwrap().len(), 2);
        let table = publish(&path, rec("mainnet", 2, "aa")).unwrap();
        assert_eq!(table.iter().map(|r| r.height).collect::<Vec<_>>(), [1, 2], "sorted, and the same record once");
        let before = std::fs::read(&path).unwrap();
        assert!(publish(&path, rec("mainnet", 2, "cc")).is_err(), "different roots at a published height");
        assert_eq!(std::fs::read(&path).unwrap(), before);
        // an existing file that does not parse is an error, not an empty table
        std::fs::write(&path, b"not json").unwrap();
        assert!(publish(&path, rec("mainnet", 3, "dd")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not json");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
