//! `pof-verify check proof.pof --audience <id> --anchors anchors.json [--revocations list.json]
//!  [--dormant-since H] [--tip-height H --max-anchor-age N] [--epoch E --seen tags.json] [--json]`
//!
//! A reserves batch (.pofb) is recognised by its magic bytes and checked as one: every member,
//! one scope and anchor, no note twice, the proofs together. The total is what is established.
//!
//! Exit codes: 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run. Reads local
//! files only; fetch the anchor table and revocation list yourself (they are static JSON).

use std::{
    path::{Path, PathBuf},
    process::exit,
    time::SystemTime,
};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use pof_verify::{exit_matches, verify, verify_batch, AnchorRecord, BatchVerdict, Context, ExitMatch, Policy, Verdict, ZkVerifier};

/// Usage errors, unreadable files, bad JSON: kept apart from every verdict code.
const EXIT_OPERATIONAL: i32 = 4;

#[derive(Parser)]
#[command(
    name = "pof-verify",
    version,
    about = "Check a Vouch proof against the public chain.",
    after_help = "Exit codes: 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run (usage, unreadable file, bad JSON)."
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Verify one proof file (binary .pof or base64url text).
    Check {
        file: PathBuf,
        /// Your verifier identifier. Only its hash is compared with the proof.
        #[arg(long)]
        audience: String,
        /// Anchor table (JSON array of {network,height,ncRoot,nfRoot}).
        #[arg(long)]
        anchors: PathBuf,
        /// Revocation list (JSON: {"secrets": [hex…]} or a bare array).
        #[arg(long)]
        revocations: Option<PathBuf>,
        /// Evaluate as of this unix time instead of now.
        #[arg(long)]
        now: Option<u64>,
        /// Require the notes to be unmoved since this block or earlier.
        #[arg(long, value_name = "HEIGHT")]
        dormant_since: Option<u32>,
        /// The chain tip you know of; with --max-anchor-age, refuses a stale spent set.
        #[arg(long, value_name = "HEIGHT", requires = "max_anchor_age")]
        tip_height: Option<u32>,
        /// Refuse a proof whose spent set is more than this many blocks below --tip-height.
        #[arg(long, value_name = "BLOCKS", requires = "tip_height")]
        max_anchor_age: Option<u32>,
        /// Require this period (the epoch your request named), so reuse within it is visible.
        #[arg(long)]
        epoch: Option<u64>,
        /// Your reuse registry: a JSON array of hex tags already accepted in that period.
        #[arg(long, requires = "epoch")]
        seen: Option<PathBuf>,
        /// Print the full JSON result.
        #[arg(long)]
        json: bool,
    },
    /// Does a deposit spend exactly the notes an exit certificate certified? Exit 0 if so.
    Match {
        /// The exit certificate (.pof, circuit 2). Verify it with `check` first.
        #[arg(long)]
        cert: PathBuf,
        /// The deposit's nullifiers: `pof-anchor tx --txid …` output, or a JSON array of hex.
        #[arg(long)]
        deposit: PathBuf,
    },
}

/// `pof-anchor tx` output, or a bare array of hex nullifiers.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum NullifierFile {
    Tx { nullifiers: Vec<String> },
    Bare(Vec<String>),
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum RevocationFile {
    Wrapped { secrets: Vec<String> },
    Bare(Vec<String>),
}

fn main() {
    // clap exits 2 on a usage error, which would read as "expired".
    let cli = Cli::try_parse().unwrap_or_else(|e| {
        let _ = e.print();
        exit(if e.use_stderr() { EXIT_OPERATIONAL } else { 0 })
    });
    match run(cli.cmd) {
        Ok(code) => exit(code),
        Err(e) => {
            eprintln!("pof-verify: {e:#}");
            exit(EXIT_OPERATIONAL)
        }
    }
}

fn read(p: &Path) -> anyhow::Result<Vec<u8>> {
    std::fs::read(p).with_context(|| format!("reading {}", p.display()))
}

fn run(cmd: Cmd) -> anyhow::Result<i32> {
    let cmd = match cmd {
        Cmd::Match { cert, deposit } => {
            // Check the certificate first with `check`; this only compares coins.
            let bytes = pof_verify::to_bytes(&read(&cert)?).map_err(|e| anyhow::anyhow!(e))?;
            let (env, _) = pof_core::decode(&bytes).map_err(|e| anyhow::anyhow!(e))?;
            let nfs = match serde_json::from_slice::<NullifierFile>(&read(&deposit)?).with_context(|| format!("parsing {}", deposit.display()))? {
                NullifierFile::Tx { nullifiers } | NullifierFile::Bare(nullifiers) => nullifiers,
            };
            let nfs = nfs
                .iter()
                .map(|h| hex::decode(h.trim()).ok().and_then(|b| <[u8; 32]>::try_from(b).ok()).ok_or_else(|| anyhow::anyhow!("not a 32-byte hex nullifier: {h}")))
                .collect::<anyhow::Result<Vec<_>>>()?;
            let m = exit_matches(&env, &nfs);
            println!("{}", serde_json::to_string(&m)?);
            return Ok(match m {
                ExitMatch::Matched { .. } => 0,
                _ => 1,
            });
        }
        check => check,
    };
    let Cmd::Check { file, audience, anchors, revocations, now, dormant_since, tip_height, max_anchor_age, epoch, seen, json } = cmd else {
        unreachable!("match is handled above")
    };
    let policy = Policy { tip_height, max_anchor_age, dormant_since, epoch };
    let seen: Vec<String> = match seen {
        Some(p) => serde_json::from_slice(&read(&p)?).with_context(|| format!("parsing {}", p.display()))?,
        None => vec![],
    };
    let input = read(&file)?;
    let anchors: Vec<AnchorRecord> = serde_json::from_slice(&read(&anchors)?).with_context(|| format!("parsing {}", anchors.display()))?;
    let revoked = match revocations {
        Some(p) => match serde_json::from_slice::<RevocationFile>(&read(&p)?).with_context(|| format!("parsing {}", p.display()))? {
            RevocationFile::Wrapped { secrets } | RevocationFile::Bare(secrets) => secrets,
        },
        None => vec![],
    };
    let now = now.unwrap_or_else(|| SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs());
    let zk = ZkVerifier::new().map_err(|e| anyhow::anyhow!(e))?;
    let ctx = Context { audience: &audience, anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk, policy, seen: &seen };
    if pof_core::is_batch(&input) {
        let r = verify_batch(&input, &ctx);
        if json {
            println!("{}", serde_json::to_string_pretty(&r)?);
        } else {
            match &r.verdict {
                BatchVerdict::Valid { total_zatoshi, members, anchor_height, dormant_since, .. } => {
                    let since = dormant_since.map(|h| format!(" · unmoved since block {h}")).unwrap_or_default();
                    println!("Valid batch · {} at least, across {members} proofs · anchor {anchor_height}{since}", zec(*total_zatoshi));
                }
                BatchVerdict::Invalid { reason, .. } => println!("Invalid batch · {reason}"),
                BatchVerdict::Malformed { reason } => println!("Malformed batch · {reason}"),
            }
            for (i, m) in r.members.iter().enumerate() {
                let kind = serde_json::to_value(&m.verdict)?["kind"].as_str().unwrap_or("?").to_string();
                println!("  proof {:<3} {kind}", i + 1);
            }
        }
        return Ok(match r.verdict {
            BatchVerdict::Valid { .. } => 0,
            BatchVerdict::Malformed { .. } => 3,
            BatchVerdict::Invalid { .. } => 1,
        });
    }
    let r = verify(&input, &ctx);

    if json {
        println!("{}", serde_json::to_string_pretty(&r)?);
    } else {
        let line = match &r.verdict {
            Verdict::Valid { claim, anchor_height, dormant_since } => {
                let network = r.anchor.as_ref().map_or("?", |a| a.network.as_str());
                let unit = if network == "testnet" { "TAZ" } else { "ZEC" };
                let since = dormant_since.map(|h| format!(" · unmoved since block {h}")).unwrap_or_default();
                format!("Valid · {} {unit} at least · anchor {anchor_height} ({network}){since}", zec(claim.zatoshi()))
            }
            Verdict::Expired { at } => format!("Expired · at unix {at}"),
            Verdict::Revoked => "Invalid · revoked by the holder".into(),
            Verdict::WrongAudience => "Invalid · made for a different verifier".into(),
            Verdict::AnchorNotFound => "Invalid · anchor not found".into(),
            Verdict::AnchorTooOld { anchor_height } => format!("Invalid · spent set at block {anchor_height} is too old for this verifier"),
            Verdict::NotDormantLongEnough { dormant_since, required } => {
                format!("Invalid · unmoved since block {dormant_since}, but block {required} or earlier is required")
            }
            Verdict::WrongScope { epoch, required } => format!("Invalid · made for period {epoch}, not the period {required} you asked for"),
            Verdict::AlreadyUsed => "Invalid · these notes were already used with you in this period".into(),
            Verdict::ProofInvalid { detail } => format!("Invalid · {detail}"),
            Verdict::Malformed { reason } => format!("Malformed · {reason}"),
        };
        println!("{line}");
        if matches!(r.verdict, Verdict::Valid { .. }) && r.anchor.as_ref().is_some_and(|a| a.network == "demo") {
            println!("WARNING: demo ledger. This anchor is the synthetic demonstration tree, not Zcash mainnet: it says nothing about real funds.");
        }
        if matches!(r.verdict, Verdict::Valid { .. }) && r.anchor.as_ref().is_some_and(|a| a.network == "testnet") {
            println!("NOTE: Zcash testnet. A real proof over real testnet notes, but TAZ has no monetary value: it says nothing about mainnet funds.");
        }
        for c in &r.checks {
            println!("  {:<10} {:<8} {}", c.id, format!("{:?}", c.status).to_lowercase(), c.detail);
        }
    }
    Ok(r.verdict.exit_code())
}

fn zec(z: u64) -> String {
    format!("{}.{:08}", z / 100_000_000, z % 100_000_000)
}
