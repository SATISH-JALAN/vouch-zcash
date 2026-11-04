//! The prover's local record of what it has proven, to whom, and how to revoke it.
//! Lives on the holder's machine only. The revocation secret never leaves it until the holder
//! chooses to revoke.

use std::{io::Write, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// First 8 bytes of the revocation tag, hex. Short enough to type.
    pub id: String,
    pub claim: String,
    pub audience: String,
    pub network: String,
    pub anchor_height: u32,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revocation_tag: String,
    /// Publishing this revokes the proof.
    pub revocation_secret: String,
    #[serde(default)]
    pub revoked_at: Option<u64>,
    pub file: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct History {
    pub entries: Vec<Entry>,
}

impl History {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        match std::fs::read(path) {
            Ok(b) => Ok(serde_json::from_slice(&b)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(History::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Atomically (temp file, then rename), so a failed write never loses the secrets already
    /// recorded; owner-only on unix.
    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp); // a stale one from a crash: create_new sets the mode afresh
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let mut f = opts.open(&tmp)?;
        f.write_all(&serde_json::to_vec_pretty(self)?)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// The one entry whose id (or full revocation tag) starts with `prefix`. At least 8 hex
    /// characters, so a slip like `revoke ""` cannot pick a proof.
    pub fn find(&mut self, prefix: &str) -> anyhow::Result<&mut Entry> {
        let p = prefix.trim().to_ascii_lowercase();
        anyhow::ensure!(p.len() >= 8 && p.bytes().all(|b| b.is_ascii_hexdigit()), "a proof id is at least 8 hex characters");
        let hits: Vec<usize> = (0..self.entries.len()).filter(|&i| self.entries[i].id.starts_with(&p) || self.entries[i].revocation_tag.starts_with(&p)).collect();
        match hits[..] {
            [i] => Ok(&mut self.entries[i]),
            [] => anyhow::bail!("no proof with id {p}"),
            _ => anyhow::bail!("{} proofs start with {p}: give more of the id", hits.len()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(tag: &str) -> Entry {
        Entry {
            id: tag[..16].into(),
            claim: String::new(),
            audience: String::new(),
            network: "demo".into(),
            anchor_height: 1,
            issued_at: 0,
            expires_at: 1,
            revocation_tag: tag.into(),
            revocation_secret: "00".into(),
            revoked_at: None,
            file: String::new(),
        }
    }

    #[test]
    fn find_needs_a_unique_prefix_of_eight() {
        let mut h = History { entries: vec![entry(&format!("aaaaaaaa11{}", "0".repeat(54))), entry(&format!("aaaaaaaa22{}", "0".repeat(54)))] };
        assert!(h.find("").is_err());
        assert!(h.find("aaaaaaa").is_err(), "7 characters");
        assert!(h.find("aaaaaaaa").unwrap_err().to_string().contains("2 proofs"));
        assert!(h.find("aaaaaaaz").is_err(), "not hex");
        assert!(h.find("bbbbbbbb").is_err());
        assert_eq!(h.find(" AAAAAAAA22 ").unwrap().id, "aaaaaaaa22000000");
    }

    #[test]
    fn save_replaces_atomically() {
        let dir = std::env::temp_dir().join(format!("pof-history-{}", std::process::id()));
        let path = dir.join("history.json");
        let mut h = History { entries: vec![entry(&"ab".repeat(32))] };
        h.save(&path).unwrap();
        h.entries.push(entry(&"cd".repeat(32)));
        h.save(&path).unwrap();
        assert_eq!(History::load(&path).unwrap().entries.len(), 2);
        assert!(!path.with_extension("json.tmp").exists());
        #[cfg(unix)]
        assert_eq!(std::os::unix::fs::PermissionsExt::mode(&std::fs::metadata(&path).unwrap().permissions()) & 0o777, 0o600);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
