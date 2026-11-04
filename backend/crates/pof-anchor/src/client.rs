//! A minimal lightwalletd client: the tip, one tree state, and a stream of compact blocks
//! filtered to the Ironwood pool.

use futures_util::StreamExt;
use tonic::transport::{Channel, ClientTlsConfig};
use zcash_client_backend::proto::service::{compact_tx_streamer_client::CompactTxStreamerClient, BlockId, BlockRange, ChainSpec, PoolType, TxFilter};

use crate::{Action, Checkpoint, Snapshot, CHECKPOINT_EVERY};

pub struct Lightwalletd {
    inner: CompactTxStreamerClient<Channel>,
}

impl Lightwalletd {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        // More than one rustls provider is linked in the workspace; pick one explicitly.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut ep = Channel::from_shared(url.to_string())?;
        if url.starts_with("https") {
            ep = ep.tls_config(ClientTlsConfig::new().with_webpki_roots())?;
        }
        let channel = ep.connect().await?;
        let inner = CompactTxStreamerClient::new(channel).max_decoding_message_size(64 << 20);
        Ok(Lightwalletd { inner })
    }

    /// Refuses a server on another chain, so a testnet scan can never be labelled mainnet.
    pub async fn ensure_chain(&mut self, network: crate::Network) -> anyhow::Result<()> {
        let info = self.inner.get_lightd_info(zcash_client_backend::proto::service::Empty {}).await?.into_inner();
        anyhow::ensure!(
            info.chain_name == network.chain_name(),
            "this lightwalletd serves chain {:?}, not {} ({:?})",
            info.chain_name,
            network.name(),
            network.chain_name()
        );
        Ok(())
    }

    pub async fn tip(&mut self) -> anyhow::Result<u32> {
        Ok(self.inner.get_latest_block(ChainSpec {}).await?.into_inner().height as u32)
    }

    /// The Ironwood note-commitment root, the tree size and the block hash (hex, display order)
    /// lightwalletd reports at `height`.
    pub async fn ironwood_root(&mut self, height: u32) -> anyhow::Result<([u8; 32], u64, String)> {
        let ts = self.inner.get_tree_state(BlockId { height: height as u64, hash: vec![] }).await?.into_inner();
        let tree = ts.ironwood_tree()?;
        Ok((tree.root().to_bytes(), tree.size() as u64, ts.hash))
    }

    /// The Ironwood nullifiers a mined transaction reveals, and its height: what an exit
    /// certificate's deposit is matched against. `txid` is hex in the usual display order.
    /// lightwalletd gives the height; the block's compact form lists the transaction's actions.
    pub async fn transaction_nullifiers(&mut self, txid: &str) -> anyhow::Result<(u32, Vec<[u8; 32]>)> {
        let display: [u8; 32] = hex::decode(txid.trim()).ok().and_then(|b| b.try_into().ok()).ok_or_else(|| anyhow::anyhow!("a txid is 32 bytes of hex"))?;
        let mut protocol = display;
        protocol.reverse();
        let raw = match self.inner.get_transaction(TxFilter { block: None, index: 0, hash: protocol.to_vec() }).await {
            Ok(r) => r.into_inner(),
            Err(_) => self.inner.get_transaction(TxFilter { block: None, index: 0, hash: display.to_vec() }).await?.into_inner(),
        };
        // 0 is the mempool and u64::MAX "not in the main chain": either way, not mined yet.
        anyhow::ensure!(raw.height > 0 && raw.height < u32::MAX as u64, "transaction {txid} is not mined yet");
        let height = raw.height as u32;
        let range = BlockRange {
            start: Some(BlockId { height: height as u64, hash: vec![] }),
            end: Some(BlockId { height: height as u64, hash: vec![] }),
            pool_types: vec![PoolType::Ironwood as i32],
        };
        let mut stream = self.inner.get_block_range(range).await?.into_inner();
        while let Some(block) = stream.next().await {
            for tx in block?.vtx {
                if tx.txid == protocol || tx.txid == display {
                    let nfs = tx.ironwood_actions.iter().map(|a| a.nullifier.as_slice().try_into()).collect::<Result<Vec<[u8; 32]>, _>>()?;
                    return Ok((height, nfs));
                }
            }
        }
        // A transaction with no Ironwood actions is filtered out of the compact block.
        Ok((height, vec![]))
    }

    /// Every Ironwood compact action in `from..=to`, in chain order, with a checkpoint at every
    /// 1,000th block and at `to`.
    pub async fn scan(&mut self, network: &str, from: u32, to: u32, mut progress: impl FnMut(u32, usize)) -> anyhow::Result<Snapshot> {
        let range = BlockRange {
            start: Some(BlockId { height: from as u64, hash: vec![] }),
            end: Some(BlockId { height: to as u64, hash: vec![] }),
            pool_types: vec![PoolType::Ironwood as i32],
        };
        let mut stream = self.inner.get_block_range(range).await?.into_inner();
        let mut actions = Vec::new();
        let mut checkpoints = Vec::new();
        let mut last_hash = [0u8; 32];
        let mut last_height = from.saturating_sub(1);
        while let Some(block) = stream.next().await {
            let block = block?;
            anyhow::ensure!(block.height as u32 == last_height + 1, "gap in the block stream at {}", block.height);
            last_height = block.height as u32;
            last_hash = block.hash.as_slice().try_into().map_err(|_| anyhow::anyhow!("block {last_height} came without its 32-byte hash"))?;
            for tx in block.vtx {
                for a in tx.ironwood_actions {
                    actions.push(Action {
                        nullifier: a.nullifier.as_slice().try_into()?,
                        cmx: a.cmx.as_slice().try_into()?,
                        epk: a.ephemeral_key.as_slice().try_into()?,
                        ciphertext: a.ciphertext.as_slice().try_into()?,
                    });
                }
            }
            if last_height.is_multiple_of(CHECKPOINT_EVERY) || last_height == to {
                checkpoints.push(Checkpoint { height: last_height, actions: actions.len() as u64, block_hash: last_hash });
                progress(last_height, actions.len());
            }
        }
        anyhow::ensure!(last_height == to, "the stream ended at {last_height}, expected {to}");
        Ok(Snapshot { network: network.into(), height: to, block_hash: last_hash, actions, checkpoints })
    }
}
