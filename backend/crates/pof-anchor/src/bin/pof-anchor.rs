//! pof-anchor — rebuild and publish Vouch anchors from public chain data.
//!
//!   pof-anchor scan   [--network mainnet|testnet] [--to tip-100]      (server, activation height and
//!                     table default per network; override with --server / --from / --table)
//!   pof-anchor scan   … --also-at 4410000[,4420000]   (also publish anchors at earlier checkpoints of the
//!                     same scan: the tree at an older block, for "unmoved since" proofs)
//!   pof-anchor check  --snapshot target/snapshots/testnet-4390000.vsnp [--at H] [--server …]   (re-derive and compare)
//!
//! Defaults assume the working directory the READMEs use: backend/. The server must report the same
//! chain as --network, so a testnet anchor can never be published as mainnet.
//!
//! `scan` streams every Ironwood compact action since activation, rebuilds the note-commitment
//! tree and checks its root, size and block hash against lightwalletd's own tree state, builds the
//! spent-nullifier IMT, writes the snapshot, and merges the anchor into the published table.

use std::{path::PathBuf, time::Instant};

use clap::{Parser, Subcommand};
use pof_anchor::{client::Lightwalletd, publish, Network, Snapshot};

#[derive(Parser)]
#[command(name = "pof-anchor", version, about = "Rebuild Vouch anchors from public Zcash data.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Scan {
        /// lightwalletd. Default: https://zec.rocks:443 (mainnet), https://testnet.zec.rocks:443 (testnet).
        #[arg(long)]
        server: Option<String>,
        #[arg(long, default_value = "mainnet", value_parser = ["mainnet", "testnet"])]
        network: String,
        /// First block to scan. Default: Ironwood activation on this network (3,428,143 / 4,134,000).
        #[arg(long)]
        from: Option<u32>,
        /// Anchor height. Default: tip − 100, rounded down to a multiple of 1,000 (finalised).
        #[arg(long)]
        to: Option<u32>,
        #[arg(long, default_value = "target/snapshots")]
        out: PathBuf,
        /// Anchor table to merge into. Default: ../fixtures/anchors.<network>.json.
        #[arg(long)]
        table: Option<PathBuf>,
        /// Also check and publish anchors at these earlier checkpoints (multiples of 1,000).
        #[arg(long, value_delimiter = ',')]
        also_at: Vec<u32>,
    },
    /// The Ironwood nullifiers a mined transaction reveals (JSON): what an exit certificate's
    /// deposit is matched against with `pof-verify match`.
    Tx {
        /// Transaction id, hex as explorers show it.
        #[arg(long)]
        txid: String,
        #[arg(long, default_value = "mainnet", value_parser = ["mainnet", "testnet"])]
        network: String,
        #[arg(long)]
        server: Option<String>,
    },
    Check {
        #[arg(long)]
        snapshot: PathBuf,
        /// Check the snapshot as it stood at this earlier checkpoint instead of its last block.
        #[arg(long)]
        at: Option<u32>,
        /// lightwalletd. Default: the public server for the snapshot's network.
        #[arg(long)]
        server: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Scan { server, network, from, to, out, table, also_at } => {
            let net = Network::parse(&network).expect("clap restricts --network");
            let server = server.unwrap_or_else(|| net.default_server().into());
            let from = from.unwrap_or(net.ironwood_activation());
            let table = table.unwrap_or_else(|| PathBuf::from(format!("../fixtures/anchors.{network}.json")));
            let mut lwd = Lightwalletd::connect(&server).await?;
            lwd.ensure_chain(net).await?;
            let tip = lwd.tip().await?;
            let to = to.unwrap_or((tip.saturating_sub(100) / 1_000) * 1_000);
            anyhow::ensure!(to >= from, "anchor height {to} is before activation {from}");
            if let Some(h) = also_at.iter().find(|&&h| h < from || h >= to || !h.is_multiple_of(pof_anchor::CHECKPOINT_EVERY)) {
                anyhow::bail!("--also-at {h} must be a multiple of {} between {from} and {to}", pof_anchor::CHECKPOINT_EVERY);
            }
            eprintln!("tip {tip} · scanning Ironwood actions {from}..={to} from {server}");
            let t = Instant::now();
            let snap = lwd
                .scan(&network, from, to, |h, n| eprintln!("  block {h} · {n} actions · {:.0}s", t.elapsed().as_secs_f32()))
                .await?;
            eprintln!("scanned {} actions in {:.1}s", snap.actions.len(), t.elapsed().as_secs_f32());
            for h in also_at {
                eprintln!("— the chain at checkpoint {h}");
                finish(&mut lwd, snap.at(h)?, Some(&table), None).await?;
            }
            finish(&mut lwd, snap, Some(&table), Some(&out)).await
        }
        Cmd::Tx { txid, network, server } => {
            let net = Network::parse(&network).expect("clap restricts --network");
            let mut lwd = Lightwalletd::connect(&server.unwrap_or_else(|| net.default_server().into())).await?;
            lwd.ensure_chain(net).await?;
            let (height, nfs) = lwd.transaction_nullifiers(&txid).await?;
            let nullifiers: Vec<String> = nfs.iter().map(hex::encode).collect();
            println!("{}", serde_json::to_string_pretty(&serde_json::json!({ "txid": txid, "network": network, "height": height, "nullifiers": nullifiers }))?);
            Ok(())
        }
        Cmd::Check { snapshot, at, server } => {
            let mut snap = Snapshot::read(&mut std::fs::File::open(&snapshot)?)?;
            if let Some(h) = at {
                snap = snap.at(h)?;
            }
            let net = Network::parse(&snap.network).ok_or_else(|| anyhow::anyhow!("snapshot is for unknown network {:?}", snap.network))?;
            let server = server.unwrap_or_else(|| net.default_server().into());
            let mut lwd = Lightwalletd::connect(&server).await?;
            lwd.ensure_chain(net).await?;
            finish(&mut lwd, snap, None, None).await
        }
    }
}

/// Re-derive both roots, check the tree and block hash against lightwalletd, then optionally
/// publish the record to `table` and write the snapshot file into `out`.
async fn finish(lwd: &mut Lightwalletd, snap: Snapshot, table: Option<&PathBuf>, out: Option<&PathBuf>) -> anyhow::Result<()> {
    let t = Instant::now();
    let (tree, imt, record) = snap.anchor()?;
    eprintln!("rebuilt both roots in {:.1}s ({} leaves, {} IMT leaves)", t.elapsed().as_secs_f32(), tree.size(), imt.leaf_count());
    let (root, size, hash) = lwd.ironwood_root(snap.height).await?;
    anyhow::ensure!(size as usize == tree.size(), "tree size {} disagrees with lightwalletd's {size}", tree.size());
    anyhow::ensure!(root == tree.root(), "note-commitment root disagrees with lightwalletd's tree state");
    // the record holds the compact block's hash reversed into display order, as the tree state does
    let ours = record.block_hash.as_deref().unwrap_or_default();
    anyhow::ensure!(ours.eq_ignore_ascii_case(&hash), "block hash {ours} disagrees with lightwalletd's {hash} at {}", snap.height);
    eprintln!("✓ nc_root and block hash match lightwalletd's Ironwood tree state at {} (block {hash})", snap.height);
    if let Some(out) = out {
        std::fs::create_dir_all(out)?;
        let path = out.join(format!("{}-{}.vsnp", snap.network, snap.height));
        snap.write(&mut std::fs::File::create(&path)?)?;
        eprintln!("wrote {} ({} checkpoints)", path.display(), snap.checkpoints.len());
    }
    if let Some(table) = table {
        publish(table, record.clone())?;
        eprintln!("published to {}", table.display());
    }
    println!("{}", serde_json::to_string_pretty(&record)?);
    Ok(())
}
