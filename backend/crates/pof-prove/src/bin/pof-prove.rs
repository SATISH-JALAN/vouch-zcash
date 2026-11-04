//! pof-prove — the holder's CLI. Keys stay in this process; nothing is broadcast.
//!
//!   pof-prove prove          --request <encoded> --snapshot target/snapshots/mainnet-3500000.vsnp --seed-file ~/.vouch/seed.txt --out proof.pof
//!                            (testnet: a testnet-*.vsnp snapshot; --network defaults to the snapshot's)
//!                            [--since 4410000]  (notes in the chain at that checkpoint and unmoved since)
//!   pof-prove demo init      --out fixtures/
//!   pof-prove demo prove     --world fixtures/demo-world.json --request <encoded> --out proof.pof
//!   pof-prove demo fixtures  --world fixtures/demo-world.json --out fixtures/
//!   … prove / demo prove --exit --intent <deposit id>   (an exit certificate: circuit 2, naming the
//!                            notes so the recipient can match the deposit; binding = the intent)
//!   … prove / demo prove --batch-size 5 --out reserves.pofb   (a reserves batch: every usable note,
//!                            in proofs of up to N notes, one scope, summed by the verifier)
//!   pof-prove history
//!   pof-prove revoke <id>    --endpoint https://…/api/revocations

use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use anyhow::{bail, Context};
use clap::{Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use pof_core::{audience_hash, encode, to_base64url, Claim, Envelope};
use pof_prove::{envelope_for, history::Entry, history::History, prove, prove_exact, request::zec, select_notes, wallet, world::DemoWorld, ProofRequest};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::keys::FullViewingKey;
use voting_crypto_deps::pasta_curves::pallas;

#[derive(Parser)]
#[command(name = "pof-prove", version, about = "Prove one fact about your shielded ZEC. Keys never leave this machine.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// The demo ledger: synthetic notes in a published demo tree, real proofs.
    #[command(subcommand)]
    Demo(Demo),
    /// Answer a proof request with your own wallet, against a published chain snapshot.
    Prove {
        /// The encoded request from a /prove link (the `r=` value, or the whole link).
        #[arg(long)]
        request: String,
        /// A snapshot written by `pof-anchor scan` (public data; its anchor must be published).
        #[arg(long)]
        snapshot: PathBuf,
        /// A BIP 39 mnemonic or a hex seed. Read locally; never leaves this process.
        #[arg(long)]
        seed_file: PathBuf,
        #[arg(long, default_value_t = 0)]
        account: u32,
        /// mainnet or testnet (ZIP 32 coin type 133 or 1). Default: the snapshot's network.
        #[arg(long, value_parser = ["mainnet", "testnet"])]
        network: Option<String>,
        #[arg(long)]
        bind_solana: Option<String>,
        /// Prove the notes were already in the chain at this checkpoint of the snapshot (a
        /// multiple of 1,000) and have not moved since: "unmoved since block H".
        #[arg(long)]
        since: Option<u32>,
        /// A reserves batch instead of one proof: every usable note, in proofs of up to N notes.
        #[arg(long, value_parser = clap::value_parser!(u8).range(1..=5))]
        batch_size: Option<u8>,
        /// An exit certificate (circuit 2): it names the notes, so the recipient can check the
        /// deposit spends exactly them. Make it when you are ready to send.
        #[arg(long, conflicts_with_all = ["batch_size", "bind_solana"])]
        exit: bool,
        /// The deposit or quote id the certificate is for (default: the request id).
        #[arg(long, requires = "exit")]
        intent: Option<String>,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        yes: bool,
    },
    /// Proofs you have made: claim, audience, expiry, status.
    History {
        /// Also print revocation secrets (to revoke from another machine or the web page).
        #[arg(long)]
        secrets: bool,
    },
    /// Revoke a proof by publishing its revocation secret.
    Revoke {
        /// The proof id from `history`: at least its first 8 hex characters.
        id: String,
        /// The revocation list your verifiers check, e.g. https://<site>/api/revocations.
        #[arg(long, value_name = "URL")]
        endpoint: String,
    },
}

#[derive(Subcommand)]
enum Demo {
    /// Generate a new demo world and its anchor record.
    Init {
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 3_491_040)]
        height: u32,
        #[arg(long, default_value_t = 2_048)]
        strangers: usize,
    },
    /// Answer a proof request as the demo holder.
    Prove {
        #[arg(long)]
        world: PathBuf,
        /// The encoded request from a /request link (the `r=` value, or the whole link).
        #[arg(long)]
        request: String,
        /// Bind the proof to this Solana account (base58). Required by on-chain audiences.
        #[arg(long)]
        bind_solana: Option<String>,
        /// Prove the notes were in the ledger at this demo checkpoint and have not moved since.
        #[arg(long)]
        since: Option<u32>,
        /// A reserves batch instead of one proof: every usable note, in proofs of up to N notes.
        #[arg(long, value_parser = clap::value_parser!(u8).range(1..=5))]
        batch_size: Option<u8>,
        /// An exit certificate (circuit 2): it names the notes, so the recipient can check the
        /// deposit spends exactly them. Make it when you are ready to send.
        #[arg(long, conflicts_with_all = ["batch_size", "bind_solana"])]
        exit: bool,
        /// The deposit or quote id the certificate is for (default: the request id).
        #[arg(long, requires = "exit")]
        intent: Option<String>,
        #[arg(long)]
        out: PathBuf,
        /// Skip the confirmation prompt.
        #[arg(long)]
        yes: bool,
    },
    /// A pool of single-use proofs for the site's /demo, so it runs live without a proving server:
    /// ≥ 500 ZEC for the demo credit pool, each bound to the demo borrower, each a fresh proof id.
    Pool {
        #[arg(long)]
        world: PathBuf,
        /// The demo borrower's Solana pubkey (base58).
        #[arg(long)]
        borrower: String,
        #[arg(long, default_value_t = 120)]
        count: usize,
        #[arg(long)]
        out: PathBuf,
    },
    /// Regenerate every committed test vector from real proofs.
    Fixtures {
        #[arg(long)]
        world: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// The demo borrower's Solana pubkey for the on-chain vector.
        #[arg(long)]
        borrower: Option<String>,
    },
}

fn anchor_line(snap: &pof_prove::Snapshot) -> String {
    if snap.nc_height < snap.height {
        format!("notes as of block {}, unspent at block {}", snap.nc_height, snap.height)
    } else {
        format!("anchor at block {}", snap.height)
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs()
}

fn history_path() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".vouch").join("history.json")
}

fn secret() -> [u8; 32] {
    pallas::Base::random(&mut OsRng).to_repr()
}

fn stage(msg: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(ProgressStyle::with_template("  {spinner} {msg} {elapsed:.dim}").unwrap());
    pb.enable_steady_tick(Duration::from_millis(80));
    pb.set_message(msg.to_string());
    pb
}

fn done(pb: ProgressBar, msg: String) {
    pb.finish_with_message(format!("✓ {msg}"));
}

fn plural(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

/// The `r` parameter of a request link, or the input itself when it is the bare encoded request.
fn request_param(s: &str) -> &str {
    let s = s.trim();
    let query = s.split_once('?').map_or(s, |(_, q)| q);
    let query = query.split('#').next().unwrap_or(query);
    query.split('&').find_map(|kv| kv.strip_prefix("r=")).unwrap_or(s)
}

fn parse_request(s: &str) -> anyhow::Result<ProofRequest> {
    Ok(ProofRequest::decode(request_param(s))?)
}

fn solana_key(b58: &str) -> anyhow::Result<[u8; 32]> {
    let v = bs58::decode(b58.trim()).into_vec().context("binding is not base58")?;
    v.try_into().map_err(|_| anyhow::anyhow!("a Solana pubkey is 32 bytes"))
}

/// Returns the file as written.
fn write_proof(path: &Path, env: &Envelope) -> anyhow::Result<Vec<u8>> {
    let file = encode(env);
    std::fs::write(path, &file)?;
    Ok(file)
}

/// The review screen, as on the web, then confirmation. Returns the binding.
fn review(req: &ProofRequest, bind_solana: Option<&str>, yes: bool) -> anyhow::Result<[u8; 32]> {
    println!("\n  {}\n", req.sentence());
    println!("  They will learn: the claim, the block it is as of, that it was made for them, the expiry.");
    println!("  They will never learn: your balance, which notes, how many, any address, any payment.\n");
    let t = now();
    if let Some(by) = req.respond_by.filter(|&by| by < t) {
        println!("  They asked for an answer by unix time {by}; that has passed ({} ago). You can still answer.\n", plural(((t - by) / 86_400) as usize, "day"));
    }
    if req.bind.as_deref() == Some("solana") && bind_solana.is_none() {
        bail!("this request must be bound to your Solana account: pass --bind-solana <pubkey>");
    }
    let binding = bind_solana.map(solana_key).transpose()?.unwrap_or([0; 32]);
    if !yes {
        eprint!("  Generate this proof? [y/N] ");
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        if !line.trim().eq_ignore_ascii_case("y") {
            bail!("cancelled; nothing was generated");
        }
    }
    Ok(binding)
}

/// Write the proof and record it. `history` is loaded before proving, so a broken history file
/// fails before the work; if saving still fails, the secret goes to stderr, because a proof
/// whose secret is lost can never be revoked.
/// The intent an exit certificate is bound to, when one is being made: `--exit`, or a request of
/// kind "exit". The intent is `--intent`, else the request id.
fn exit_intent(req: &ProofRequest, exit: bool, intent: Option<String>) -> anyhow::Result<Option<String>> {
    if !exit && req.kind.as_deref() != Some("exit") {
        return Ok(None);
    }
    anyhow::ensure!(req.bind.is_none(), "an exit certificate is bound to its deposit intent, not to a Solana account");
    let intent = intent.or_else(|| req.id.clone()).ok_or_else(|| anyhow::anyhow!("an exit certificate needs --intent <deposit or quote id> (the request has no id)"))?;
    eprintln!("  exit certificate for intent {intent}: it names the notes it proves, so make it only when you are ready to send them.");
    Ok(Some(intent))
}

/// The notes an exit certificate names: every usable note, largest first, up to five. The wallet
/// chooses which notes the deposit spends, so the certificate must cover all it might choose.
fn exit_notes(mut usable: Vec<pof_prove::OwnedNote>, need: u64) -> anyhow::Result<Vec<pof_prove::OwnedNote>> {
    usable.sort_by_key(|n| std::cmp::Reverse(n.note.value().inner()));
    if usable.len() > 5 {
        eprintln!("  you have {} usable notes; the certificate names the 5 largest. Send from those only.", usable.len());
        usable.truncate(5);
    }
    let total: u64 = usable.iter().map(|n| n.note.value().inner()).sum();
    anyhow::ensure!(total >= need, "your usable notes total {} ZEC, below the {} ZEC asked for", zec(total), zec(need));
    Ok(usable)
}

/// Turn the envelope into an exit certificate (circuit 2), bound to the intent.
fn certify(env: &mut Envelope, intent: Option<&str>) {
    if let Some(intent) = intent {
        env.circuit = pof_core::CIRCUIT_REVEAL;
        env.binding = pof_core::intent_binding(intent);
    }
}

/// The holder's notes a proof against `snap` can use: in its tree and not in its spent set.
fn usable_notes(notes: Vec<pof_prove::OwnedNote>, snap: &pof_prove::Snapshot, sk: &voting_crypto_deps::orchard::keys::SpendingKey) -> Vec<pof_prove::OwnedNote> {
    use pof_zk::ImtProvider;
    let fvk = FullViewingKey::from(sk);
    notes
        .into_iter()
        .filter(|n| (n.position as usize) < snap.tree.size() && snap.imt.non_membership_proof(n.note.nullifier(&fvk).inner()).is_ok())
        .collect()
}

/// Prove a reserves batch and write it as one .pofb, recorded once in the history.
#[allow(clippy::too_many_arguments)]
fn reserves(
    mut history: History,
    out: &Path,
    sk: &voting_crypto_deps::orchard::keys::SpendingKey,
    usable: Vec<pof_prove::OwnedNote>,
    size: u8,
    snap: &pof_prove::Snapshot,
    template: &Envelope,
    rs: &[u8; 32],
    req: &ProofRequest,
    note: Option<String>,
) -> anyhow::Result<()> {
    let groups = pof_prove::batch_groups(usable, size as usize);
    anyhow::ensure!(!groups.is_empty(), "no usable notes clear one 0.125 ZEC unit");
    anyhow::ensure!(groups.len() <= pof_core::MAX_BATCH, "{} proofs needed; a batch holds at most {}", groups.len(), pof_core::MAX_BATCH);
    let pb = stage(&format!("proving {} for the batch", plural(groups.len(), "proof")));
    let envs = pof_prove::prove_batch(sk, &groups, snap, template)?;
    let total: u64 = envs.iter().map(|e| e.claim.zatoshi()).sum();
    done(pb, format!("{} in total, across {}", zec(total), plural(envs.len(), "proof")));
    anyhow::ensure!(total >= req.zatoshi, "the batch totals {} ZEC, below the {} ZEC asked for", zec(total), zec(req.zatoshi));
    let file = pof_core::encode_batch(&envs.iter().map(encode).collect::<Vec<_>>());
    std::fs::write(out, &file)?;
    let tag = hex::encode(template.revocation);
    history.entries.push(Entry {
        id: tag[..16].to_string(),
        claim: format!("Reserves at least {} (batch of {})", zec(total), envs.len()),
        audience: req.audience.clone(),
        network: snap.network.clone(),
        anchor_height: snap.height,
        issued_at: template.issued_at,
        expires_at: template.expires_at,
        revocation_tag: tag.clone(),
        revocation_secret: hex::encode(rs),
        revoked_at: None,
        file: out.display().to_string(),
    });
    let path = history_path();
    if let Err(e) = history.save(&path) {
        eprintln!("
  wrote {}, but could not record it in {}.", out.display(), path.display());
        eprintln!("  Keep this revocation secret; it is the only way to revoke the batch:
  {}
", hex::encode(rs));
        return Err(e);
    }
    println!("
  wrote {} ({} bytes). Nothing was broadcast.", out.display(), file.len());
    if let Some(n) = note {
        println!("  {n}");
    }
    println!("  batch id {} · revoke with: pof-prove revoke {} --endpoint https://<site>/api/revocations", &tag[..16], &tag[..16]);
    Ok(())
}

fn record(mut history: History, out: &Path, env: &Envelope, rs: &[u8; 32], req: &ProofRequest, network: &str, note: Option<String>) -> anyhow::Result<()> {
    let file = write_proof(out, env)?;
    let tag = hex::encode(env.revocation);
    history.entries.push(Entry {
        id: tag[..16].to_string(),
        claim: format!("Holds at least {} {}", zec(req.zatoshi), if network == "testnet" { "TAZ" } else { "ZEC" }),
        audience: req.audience.clone(),
        network: network.to_string(),
        anchor_height: env.anchor.height,
        issued_at: env.issued_at,
        expires_at: env.expires_at,
        revocation_tag: tag.clone(),
        revocation_secret: hex::encode(rs),
        revoked_at: None,
        file: out.display().to_string(),
    });
    let path = history_path();
    if let Err(e) = history.save(&path) {
        eprintln!("\n  wrote {}, but could not record it in {}.", out.display(), path.display());
        eprintln!("  Keep this revocation secret; it is the only way to revoke the proof:\n  {}\n", hex::encode(rs));
        return Err(e);
    }
    println!("\n  wrote {} ({} bytes). Nothing was broadcast.", out.display(), file.len());
    if let Some(note) = note {
        println!("  {note}");
    }
    println!("  proof id {} · revoke with: pof-prove revoke {} --endpoint https://<site>/api/revocations", &tag[..16], &tag[..16]);
    println!("\n  base64url (paste into /verify):\n{}", to_base64url(&file));
    Ok(())
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Demo(Demo::Init { out, height, strangers }) => {
            std::fs::create_dir_all(&out)?;
            let pb = stage("generating the demo ledger");
            let world = DemoWorld::generate(height, strangers);
            let snap = world.snapshot()?;
            let anchor = snap.anchor();
            std::fs::write(out.join("demo-world.json"), serde_json::to_vec(&world)?)?;
            done(pb, format!("{} leaves, {} spent nullifiers", snap.tree.size(), world.spent.len()));
            let mut records = vec![serde_json::json!({
                "network": "demo", "height": height, "blockHash": null,
                "ncRoot": hex::encode(anchor.nc_root), "nfRoot": hex::encode(anchor.nf_root),
            })];
            for cp in &world.checkpoints {
                let a = world.snapshot_since(cp.height)?.anchor();
                records.insert(0, serde_json::json!({
                    "network": "demo", "height": cp.height, "blockHash": null,
                    "ncRoot": hex::encode(a.nc_root), "nfRoot": hex::encode(a.nf_root),
                }));
            }
            std::fs::write(out.join("anchors.demo.json"), serde_json::to_vec_pretty(&records)?)?;
            println!("wrote {}/demo-world.json and anchors.demo.json", out.display());
        }

        Cmd::Demo(Demo::Prove { world, request, bind_solana, since, batch_size, exit, intent, out, yes }) => {
            let req = parse_request(&request)?;
            // The request's own terms are the defaults: its block for "unmoved since", a batch for reserves.
            let since = since.or(req.dormant_since);
            let batch_size = batch_size.or((req.kind.as_deref() == Some("reserves")).then_some(5));
            let exit = exit_intent(&req, exit, intent)?;
            let binding = review(&req, bind_solana.as_deref(), yes)?;
            let history = History::load(&history_path())?;
            let world: DemoWorld = serde_json::from_slice(&std::fs::read(&world)?)?;
            let pb = stage("pinning the anchor and rebuilding both roots");
            let snap = match since {
                Some(h) => world.snapshot_since(h)?,
                None => world.snapshot()?,
            };
            done(pb, anchor_line(&snap));
            let rs = secret();
            let mut env = envelope_for(&req, snap.anchor(), now(), binding, &rs);
            certify(&mut env, exit.as_deref());
            if let Some(size) = batch_size {
                let usable = usable_notes(world.notes()?, &snap, &world.spending_key()?);
                return reserves(history, &out, &world.spending_key()?, usable, size, &snap, &env, &rs, &req, None);
            }
            let pb = stage("selecting notes, building witnesses, proving, signing");
            let n = if exit.is_some() {
                let usable = usable_notes(world.notes()?, &snap, &world.spending_key()?);
                prove_exact(&world.spending_key()?, &exit_notes(usable, req.zatoshi)?, &snap, &mut env)?
            } else {
                prove(&world.spending_key()?, &world.notes()?, &snap, &mut env)?
            };
            done(pb, format!("{} used; balance not revealed", plural(n, "note")));
            record(history, &out, &env, &rs, &req, &snap.network, None)?;
        }

        Cmd::Demo(Demo::Fixtures { world, out, borrower }) => fixtures(&world, &out, borrower.as_deref())?,

        Cmd::Demo(Demo::Pool { world, borrower, count, out }) => {
            let world: DemoWorld = serde_json::from_slice(&std::fs::read(&world)?)?;
            let snap = world.snapshot()?;
            let (sk, notes) = (world.spending_key()?, world.notes()?);
            let binding = solana_key(&borrower)?;
            let req = ProofRequest {
                v: 1,
                id: None,
                claim: "HoldsAtLeast".into(),
                zatoshi: 500 * 100_000_000,
                audience: "pof-credit:usdc-pool-1".into(),
                expiry_days: 7,
                respond_by: None,
                bind: Some("solana".into()),
                kind: None,
                epoch: None,
                dormant_since: None,
            };
            let pb = stage(&format!("proving {count} single-use demo proofs"));
            let mut pool = Vec::with_capacity(count);
            for _ in 0..count {
                let rs = secret();
                let mut env = envelope_for(&req, snap.anchor(), 1_790_121_600, binding, &rs);
                env.expires_at = 1_798_761_600; // 2027-01-01: through judging
                prove(&sk, &notes, &snap, &mut env)?;
                pool.push(serde_json::json!({
                    "subject": hex::encode(pof_core::subject_hash(&env)),
                    "proof": to_base64url(&encode(&env)),
                    "revocationSecret": hex::encode(rs),
                }));
            }
            std::fs::write(&out, serde_json::to_vec(&serde_json::json!({ "borrower": borrower, "proofs": pool }))?)?;
            done(pb, format!("{} written to {}", plural(count, "proof"), out.display()));
        }

        Cmd::Prove { request, snapshot, seed_file, account, network, bind_solana, since, batch_size, exit, intent, out, yes } => {
            let req = parse_request(&request)?;
            // The request's own terms are the defaults: its block for "unmoved since", a batch for reserves.
            let since = since.or(req.dormant_since);
            let batch_size = batch_size.or((req.kind.as_deref() == Some("reserves")).then_some(5));
            let exit = exit_intent(&req, exit, intent)?;
            let binding = review(&req, bind_solana.as_deref(), yes)?;
            let history = History::load(&history_path())?;
            let pb = stage("loading the snapshot");
            let chain = pof_anchor::Snapshot::read(&mut std::fs::File::open(&snapshot)?)?;
            let network = network.unwrap_or_else(|| chain.network.clone());
            anyhow::ensure!(chain.network == network, "the snapshot is for {}, not {network}", chain.network);
            done(pb, format!("{} Ironwood actions to block {} on {network}", chain.actions.len(), chain.height));
            if network == "testnet" {
                eprintln!("  note: testnet — the proof is real, but TAZ has no value; verifiers show it as a testnet anchor");
            }
            let pb = stage("reading your seed and deriving the Ironwood key (it stays in this process)");
            let sk = wallet::spending_key(&wallet::seed_from_file(&seed_file)?, &network, account)?;
            done(pb, format!("account {account} on {network}"));
            let pb = stage("finding your notes (trial decryption with your viewing key, all cores)");
            let fvk = FullViewingKey::from(&sk);
            let found = wallet::find_notes(&chain, &fvk);
            let total = found.len();
            let notes = wallet::unspent(&chain, &fvk, found);
            done(pb, format!("{} found, {} unspent", plural(total, "note"), notes.len()));
            anyhow::ensure!(total > 0, "no Ironwood notes for this key in the snapshot: check the account index, and that your funds are in the Ironwood pool");
            // Fail before the tree work when the unspent notes cannot clear the threshold. With
            // --since, only notes already in the chain at that checkpoint count.
            let cut = match since {
                Some(h) => chain.at(h)?.actions.len(),
                None => chain.actions.len(),
            };
            select_notes(&notes, req.zatoshi, |n| (n.position as usize) < cut).map_err(|e| match since {
                Some(h) => anyhow::anyhow!("{e}. Only notes already in the chain at block {h} count toward \"unmoved since\"."),
                None => e.into(),
            })?;
            let pb = stage("rebuilding both roots: the note-commitment tree and the spent-nullifier tree");
            let snap = match since {
                Some(h) => wallet::snapshot_since(&chain, h)?,
                None => wallet::snapshot(&chain)?,
            };
            done(pb, anchor_line(&snap));
            let rs = secret();
            let mut env = envelope_for(&req, snap.anchor(), now(), binding, &rs);
            certify(&mut env, exit.as_deref());
            if let Some(size) = batch_size {
                let usable = usable_notes(notes, &snap, &sk);
                let note = format!("anchor: {network} block {}. Verifiers accept it once this anchor is in their table.", snap.height);
                return reserves(history, &out, &sk, usable, size, &snap, &env, &rs, &req, Some(note));
            }
            let pb = stage("selecting notes, building witnesses, proving, signing");
            let n = if exit.is_some() {
                let usable = usable_notes(notes, &snap, &sk);
                prove_exact(&sk, &exit_notes(usable, req.zatoshi)?, &snap, &mut env)?
            } else {
                prove(&sk, &notes, &snap, &mut env)?
            };
            done(pb, format!("{} used; balance not revealed", plural(n, "note")));
            let note = match since {
                Some(h) => format!("anchors: {network} blocks {h} and {}. Verifiers accept it once both are in their table.", snap.height),
                None => format!("anchor: {network} block {}. Verifiers accept it once this anchor is in their table.", snap.height),
            };
            record(history, &out, &env, &rs, &req, &network, Some(note))?;
        }

        Cmd::History { secrets } => {
            let h = History::load(&history_path())?;
            if h.entries.is_empty() {
                println!("No proofs yet.");
            }
            let t = now();
            for e in &h.entries {
                // as the verifier judges it: expired from the expiry second on
                let status = if e.revoked_at.is_some() {
                    "revoked"
                } else if t >= e.expires_at {
                    "expired"
                } else {
                    "live"
                };
                println!("{}  {:<8} {}  for {}  ({} · block {})", e.id, status, e.claim, e.audience, e.network, e.anchor_height);
                if secrets {
                    println!("    revocation secret {}", e.revocation_secret);
                }
            }
        }

        Cmd::Revoke { id, endpoint } => {
            let path = history_path();
            let mut h = History::load(&path)?;
            let e = h.find(&id).with_context(|| format!("looking in {}", path.display()))?;
            let body = serde_json::json!({ "secret": e.revocation_secret });
            // ureq 3 turns every non-2xx status into an error and follows redirects itself.
            match ureq::post(&endpoint).send_json(&body) {
                Ok(_) => {}
                Err(ureq::Error::StatusCode(code)) => bail!("the revocation list refused it: HTTP {code}"),
                Err(err) => return Err(err).context("posting the revocation"),
            }
            e.revoked_at = Some(now());
            let tag = e.revocation_tag.clone();
            h.save(&path)?;
            println!("Revoked. Tag {tag} is now on the list; verifiers that fetch it will refuse the proof.");
        }
    }
    Ok(())
}

/// Every committed test vector, from real proofs. `expected.json` records the verdict each
/// one must produce, so the native and WASM verifiers can be checked against it.
fn fixtures(world_path: &Path, out: &Path, borrower: Option<&str>) -> anyhow::Result<()> {
    let world: DemoWorld = serde_json::from_slice(&std::fs::read(world_path)?)?;
    let snap = world.snapshot()?;
    let sk = world.spending_key()?;
    let notes = world.notes()?;
    let dir = out.join("proofs");
    std::fs::create_dir_all(&dir)?;
    let audience = "pof-credit:usdc-pool-1";
    let req = |zec_units: u64, days: u32| ProofRequest {
        v: 1,
        id: None,
        claim: "HoldsAtLeast".into(),
        zatoshi: zec_units * 100_000_000,
        audience: audience.into(),
        expiry_days: days,
        respond_by: None,
        bind: None,
        kind: None,
        epoch: None,
        dormant_since: None,
    };
    // Long-lived on purpose: the committed "valid" vector must stay valid through judging.
    let issued = 1_790_121_600; // 2026-09-23 00:00 UTC
    let until_2027 = 1_798_761_600; // 2027-01-01 00:00 UTC
    let mut expected = serde_json::Map::new();
    let mut revoked = Vec::new();
    let mut make = |name: &str, r: ProofRequest, issued_at: u64, expires_at: u64, binding: [u8; 32], rs: [u8; 32], want: &str| -> anyhow::Result<Envelope> {
        let pb = stage(&format!("proving {name}"));
        let mut env = envelope_for(&r, snap.anchor(), issued_at, binding, &rs);
        env.expires_at = expires_at;
        prove(&sk, &notes, &snap, &mut env)?;
        write_proof(&dir.join(format!("{name}.pof")), &env)?;
        expected.insert(name.into(), serde_json::json!({ "verdict": want, "audience": audience }));
        done(pb, format!("{name}.pof → {want}"));
        Ok(env)
    };

    let valid = make("valid", req(500, 7), issued, until_2027, [0; 32], secret(), "Valid")?;
    make("expired", req(500, 7), 1_789_516_800, 1_790_035_200, [0; 32], secret(), "Expired")?; // 16 → 22 Sep 2026
    let rs = secret();
    make("revoked", req(500, 7), issued, until_2027, [0; 32], rs, "Revoked")?;
    revoked.push(hex::encode(rs));
    let mut other = req(500, 7);
    other.audience = "otc-desk:someone-else".into();
    make("wrong-audience", other, issued, until_2027, [0; 32], secret(), "WrongAudience")?;
    make("threshold-4000", req(4_000, 7), issued, until_2027, [0; 32], secret(), "Valid")?;
    if let Some(b) = borrower {
        make("onchain", req(500, 7), issued, until_2027, solana_key(b)?, secret(), "Valid")?;
    }

    // Tampered: one byte of Halo2 evidence flipped, then re-sealed like a forger would.
    let mut t = valid.clone();
    t.evidence.proof[777] ^= 1;
    write_proof(&dir.join("tampered.pof"), &t)?;
    expected.insert("tampered".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": audience }));
    // Forged claim: 500 → 5,000 ZEC, re-sealed.
    let mut f = valid.clone();
    f.claim = Claim::HoldsAtLeast { zatoshi: 5_000 * 100_000_000 };
    write_proof(&dir.join("forged-claim.pof"), &f)?;
    expected.insert("forged-claim".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": audience }));
    // Extended expiry on the expired proof, re-sealed.
    let mut x = valid.clone();
    x.expires_at += 365 * 86_400;
    write_proof(&dir.join("extended-expiry.pof"), &x)?;
    expected.insert("extended-expiry".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": audience }));
    // Anchor that no authenticated record has.
    let mut a = valid.clone();
    a.anchor.nc_root = pof_zk::base_to_bytes(&pallas::Base::from(7u64));
    write_proof(&dir.join("anchor-mismatch.pof"), &a)?;
    expected.insert("anchor-mismatch".into(), serde_json::json!({ "verdict": "AnchorNotFound", "audience": audience }));
    // Swapped audience field (someone re-addressing a proof they were handed).
    let mut s = valid.clone();
    s.audience = audience_hash("otc-desk:someone-else");
    write_proof(&dir.join("readdressed.pof"), &s)?;
    expected.insert("readdressed".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": "otc-desk:someone-else" }));

    // Unmoved since the demo checkpoint: the holder's notes that were already in the ledger then.
    // The demo spent set never changes, so the checkpoint's record has today's nullifier root.
    if let Some(cp) = world.checkpoints.first().copied() {
        let since = world.snapshot_since(cp.height)?;
        let a = since.anchor();
        let record = pof_anchor::AnchorRecord { network: "demo".into(), height: cp.height, block_hash: None, nc_root: hex::encode(a.nc_root), nf_root: hex::encode(a.nf_root) };
        pof_anchor::publish(&out.join("anchors.demo.json"), record)?;
        let pb = stage("proving dormant");
        let mut env = envelope_for(&req(500, 7), a, issued, [0; 32], &secret());
        env.expires_at = until_2027;
        prove(&sk, &notes, &since, &mut env)?;
        write_proof(&dir.join("dormant.pof"), &env)?;
        expected.insert("dormant".into(), serde_json::json!({ "verdict": "Valid", "audience": audience }));
        // The same proof, to a verifier that requires the notes unmoved since an earlier block.
        write_proof(&dir.join("dormant-too-young.pof"), &env)?;
        let policy = serde_json::json!({ "dormantSince": cp.height - 1_000 });
        expected.insert("dormant-too-young".into(), serde_json::json!({ "verdict": "NotDormantLongEnough", "audience": audience, "policy": policy }));
        done(pb, format!("dormant.pof → unmoved since block {}", cp.height));
    }
    // Reuse inside a scope: the valid proof, to a verifier whose registry already holds its tags
    // in its period; and to one that asked for another period.
    write_proof(&dir.join("already-used.pof"), &valid)?;
    let seen: Vec<String> = pof_zk::tags(&valid).iter().map(hex::encode).collect();
    expected.insert("already-used".into(), serde_json::json!({ "verdict": "AlreadyUsed", "audience": audience, "policy": { "epoch": valid.epoch }, "seen": seen }));
    write_proof(&dir.join("wrong-period.pof"), &valid)?;
    expected.insert("wrong-period".into(), serde_json::json!({ "verdict": "WrongScope", "audience": audience, "policy": { "epoch": valid.epoch + 1 } }));
    // A verifier that wants the spent set at most 1,000 blocks old, with the tip 2,000 past it.
    write_proof(&dir.join("anchor-too-old.pof"), &valid)?;
    let policy = serde_json::json!({ "tipHeight": snap.height + 2_000, "maxAnchorAge": 1_000 });
    expected.insert("anchor-too-old".into(), serde_json::json!({ "verdict": "AnchorTooOld", "audience": audience, "policy": policy }));

    // An exit certificate to a demo rail, and two deposits to match it against: one spending the
    // certified note, one spending a note the certificate does not name.
    let pb = stage("proving the exit certificate");
    let rail = "rail:demo";
    let intent = "demo-deposit-1";
    let mut exit_req = req(500, 7);
    exit_req.audience = rail.into();
    exit_req.kind = Some("exit".into());
    exit_req.epoch = Some(202_610);
    let mut cert = envelope_for(&exit_req, snap.anchor(), issued, pof_core::intent_binding(intent), &secret());
    cert.circuit = pof_core::CIRCUIT_REVEAL;
    cert.expires_at = until_2027;
    prove(&sk, &notes, &snap, &mut cert)?;
    write_proof(&dir.join("exit.pof"), &cert)?;
    expected.insert("exit".into(), serde_json::json!({ "verdict": "Valid", "audience": rail, "policy": { "epoch": 202_610 } }));
    let revealed = pof_zk::revealed_nullifiers(&cert).ok_or_else(|| anyhow::anyhow!("the certificate reveals nothing"))?;
    let fvk = FullViewingKey::from(&sk);
    let other = notes
        .iter()
        .map(|n| n.note.nullifier(&fvk).to_bytes())
        .find(|nf| !revealed.contains(nf))
        .ok_or_else(|| anyhow::anyhow!("every demo note is in the certificate"))?;
    let deposits = serde_json::json!({
        "about": "Deposits to match exit.pof against (pof-verify match --cert proofs/exit.pof --deposit <one of these>). Demo ledger: no real transactions.",
        "certificate": "exit.pof",
        "audience": rail,
        "intent": intent,
        "epoch": 202_610,
        "deposits": {
            "matched": { "txid": "demo-tx-1", "nullifiers": [hex::encode(revealed[0])] },
            "mismatch": { "txid": "demo-tx-2", "nullifiers": [hex::encode(revealed[0]), hex::encode(other)] },
        },
    });
    std::fs::write(out.join("exit-deposits.json"), serde_json::to_vec_pretty(&deposits)?)?;
    done(pb, "exit.pof → names 1 note; exit-deposits.json → one matching deposit, one not".into());

    // Reserves: the demo holder's five notes, two per proof, in one scope; and a forged batch in
    // which the second proof counts a note the first already counted.
    let mut batches = serde_json::Map::new();
    let pb = stage("proving the reserves batches");
    // Reserves are proven to the feed's verifier identifier, not the credit pool's.
    let reserves_audience = "reserves:wzec-demo";
    let mut reserves_req = req(4_000, 7);
    reserves_req.audience = reserves_audience.into();
    let mut template = envelope_for(&reserves_req, snap.anchor(), issued, [0; 32], &secret());
    template.expires_at = until_2027;
    let groups = pof_prove::batch_groups(notes.clone(), 2);
    let honest = pof_prove::prove_batch(&sk, &groups, &snap, &template)?;
    let total: u64 = honest.iter().map(|e| e.claim.zatoshi()).sum();
    std::fs::write(dir.join("reserves.pofb"), pof_core::encode_batch(&honest.iter().map(encode).collect::<Vec<_>>()))?;
    batches.insert("reserves".into(), serde_json::json!({ "kind": "Valid", "totalZatoshi": total, "audience": reserves_audience }));
    let twice = vec![groups[0].clone(), vec![groups[0][1].clone(), groups[1][0].clone()]];
    let forged = pof_prove::prove_batch(&sk, &twice, &snap, &template)?;
    std::fs::write(dir.join("reserves-double.pofb"), pof_core::encode_batch(&forged.iter().map(encode).collect::<Vec<_>>()))?;
    batches.insert("reserves-double".into(), serde_json::json!({ "kind": "Invalid", "member": 1, "audience": reserves_audience }));
    done(pb, format!("reserves.pofb → {} across {} proofs; reserves-double.pofb → refused", zec(total), honest.len()));

    std::fs::write(out.join("revocations.demo.json"), serde_json::to_vec_pretty(&serde_json::json!({ "secrets": revoked }))?)?;
    let meta = serde_json::json!({ "audience": audience, "evaluatedAt": issued + 86_400, "expected": expected, "batches": batches });
    std::fs::write(out.join("expected.json"), serde_json::to_vec_pretty(&meta)?)?;
    println!("wrote {} vectors to {}", meta["expected"].as_object().map_or(0, |m| m.len()), dir.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::request_param;

    #[test]
    fn request_param_reads_the_r_parameter() {
        assert_eq!(request_param("eyJ2"), "eyJ2");
        assert_eq!(request_param("  r=eyJ2 "), "eyJ2");
        assert_eq!(request_param("https://vouch.example/prove?r=eyJ2"), "eyJ2");
        assert_eq!(request_param("https://vouch.example/prove?r=eyJ2&referrer=x"), "eyJ2");
        assert_eq!(request_param("https://vouch.example/prove?referrer=x&r=eyJ2#top"), "eyJ2");
        // no r parameter: the whole input, which then fails to decode
        assert_eq!(request_param("https://vouch.example/prove?ref=x"), "https://vouch.example/prove?ref=x");
    }
}
