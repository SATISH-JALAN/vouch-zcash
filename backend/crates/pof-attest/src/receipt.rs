//! Vouch Receipts: "order N was paid by the holder of these notes", checked for one party, with
//! the wallet kept private.
//!
//! A receipt is an exit certificate bound to the order (the order's intent is the certificate's
//! binding) and the payment it was matched against. The holder makes the certificate before paying,
//! so it signs for this order with the notes' spend authority; the payment then reveals those
//! notes' nullifiers as it spends them. Nothing is proven anew and no circuit changes.
//!
//!   POST /v1/receipts/verify   {receipt}  → 200 {verdict, checks, chain} | 422 (same, refused)
//!
//! Stateless. On mainnet and testnet the payment's nullifiers are re-read from lightwalletd by txid,
//! so the receipt's own copy is never trusted; on the demo ledger, which has no transactions, the
//! receipt's copy is used and the answer says so. The same rules run in the browser
//! (frontend/src/lib/vouch-receipt.ts) and are pinned by fixtures/receipts.

use std::{collections::BTreeSet, sync::Arc};

use axum::{extract::State, http::StatusCode, response::IntoResponse, response::Response, Json};
use pof_verify::{Policy, Verdict};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{err, now, App};

#[derive(Deserialize)]
pub struct Order {
    merchant: String,
    id: String,
    intent: String,
}

#[derive(Deserialize)]
pub struct Rail {
    audience: String,
    epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    network: String,
    txid: Option<String>,
    paid_at: Option<u64>,
    nullifiers: Vec<String>,
}

#[derive(Deserialize)]
pub struct Receipt {
    #[serde(rename = "type")]
    kind: String,
    version: u8,
    order: Order,
    rail: Rail,
    certificate: String,
    payment: Payment,
}

#[derive(Deserialize)]
pub struct Body {
    receipt: Receipt,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind")]
pub enum ReceiptVerdict {
    Valid { spent: usize },
    Malformed { reason: String },
    CertificateRefused { certificate: Verdict },
    NotACertificate,
    WrongOrder,
    NoShieldedSpend,
    NotPaidByCertifiedNotes { #[serde(rename = "notCertified")] not_certified: Vec<String> },
}

/// The order and payment rules, after the certificate itself is Valid. Pure, so it is tested here.
pub fn judge(revealed: &[String], binding: &[u8; 32], intent: &str, spent: &[String]) -> ReceiptVerdict {
    if revealed.is_empty() {
        return ReceiptVerdict::NotACertificate;
    }
    if *binding != pof_core::intent_binding(intent) {
        return ReceiptVerdict::WrongOrder;
    }
    if spent.is_empty() {
        return ReceiptVerdict::NoShieldedSpend;
    }
    let not_certified: Vec<String> = spent.iter().filter(|n| !revealed.contains(n)).cloned().collect();
    if !not_certified.is_empty() {
        return ReceiptVerdict::NotPaidByCertifiedNotes { not_certified };
    }
    ReceiptVerdict::Valid { spent: spent.iter().collect::<BTreeSet<_>>().len() }
}

fn refused(v: ReceiptVerdict, extra: serde_json::Value) -> Response {
    (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "verdict": v, "detail": extra }))).into_response()
}

pub async fn verify(State(app): State<Arc<App>>, Json(b): Json<Body>) -> Response {
    let r = b.receipt;
    if r.kind != "vouch.receipt" || r.version != 1 {
        return refused(ReceiptVerdict::Malformed { reason: "not a vouch.receipt version 1".into() }, json!(null));
    }
    if r.order.id.trim().is_empty() || !r.order.intent.contains(&r.order.id) {
        return refused(ReceiptVerdict::Malformed { reason: "the order id does not appear in the intent the certificate is bound to".into() }, json!(null));
    }

    // The payment: from the chain when there is one, never from the receipt.
    let (spent, chain) = match (r.payment.network.as_str(), &r.payment.txid) {
        ("demo", _) => (r.payment.nullifiers.iter().map(|n| n.trim().to_lowercase()).collect::<Vec<_>>(), json!({ "source": "receipt", "note": "demo ledger: no transactions to read" })),
        (net @ ("mainnet" | "testnet"), Some(txid)) => match crate::rail::fetch_nullifiers(net, txid).await {
            Ok((height, nfs)) => {
                let recorded: BTreeSet<String> = r.payment.nullifiers.iter().map(|n| n.trim().to_lowercase()).collect();
                let agrees = recorded == nfs.iter().cloned().collect();
                let chain = json!({ "source": "lightwalletd", "network": net, "txid": txid, "height": height, "nullifiers": nfs, "receiptAgrees": agrees });
                (nfs, chain)
            }
            Err(e) => {
                tracing::info!("receipt payment lookup failed: {e:#}");
                return err(StatusCode::BAD_GATEWAY, format!("could not read transaction {txid} on {net}: it may not be mined yet"));
            }
        },
        ("mainnet" | "testnet", None) => return refused(ReceiptVerdict::Malformed { reason: "a mainnet or testnet receipt names its payment's txid".into() }, json!(null)),
        (other, _) => return refused(ReceiptVerdict::Malformed { reason: format!("unknown network {other}") }, json!(null)),
    };

    let policy = || Policy { epoch: Some(r.rail.epoch), ..Policy::default() };
    let audience = r.rail.audience.trim().to_lowercase();
    let mut res = match app.check_with(r.certificate.as_bytes(), &audience, policy(), &[]).await {
        Ok(v) => v,
        Err(busy) => return busy.into_response(),
    };
    // A receipt is about the past: a certificate that has expired since is checked as of the
    // payment, if the receipt says when that was and it falls inside the certificate's validity.
    let mut as_of_payment = false;
    if let (Verdict::Expired { .. }, Some(view), Some(at)) = (&res.verdict, &res.envelope, r.payment.paid_at) {
        if at >= view.envelope.issued_at && at < view.envelope.expires_at && at <= now() {
            res = match app.check_at(r.certificate.as_bytes(), &audience, policy(), at).await {
                Ok(v) => v,
                Err(busy) => return busy.into_response(),
            };
            as_of_payment = true;
        }
    }
    let (Verdict::Valid { .. }, Some(view)) = (&res.verdict, &res.envelope) else {
        return refused(ReceiptVerdict::CertificateRefused { certificate: res.verdict.clone() }, json!({ "chain": chain }));
    };
    let verdict = judge(&res.revealed, &view.envelope.binding, &r.order.intent, &spent);
    let body = json!({
        "verdict": verdict,
        "order": { "merchant": r.order.merchant, "id": r.order.id, "intent": r.order.intent },
        "certificate": { "claimZatoshi": view.envelope.claim.zatoshi(), "anchorHeight": view.envelope.anchor.height, "network": res.anchor.as_ref().map(|a| a.network.clone()), "asOfPayment": as_of_payment },
        "chain": chain,
        "verifier": pof_verify::VERIFIER_VERSION,
    });
    let status = if matches!(verdict, ReceiptVerdict::Valid { .. }) { StatusCode::OK } else { StatusCode::UNPROCESSABLE_ENTITY };
    (status, Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_order_and_payment_rules() {
        let revealed = vec!["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)];
        let binding = pof_core::intent_binding("bitrefill:invoice:42");
        let paid = vec!["aa".repeat(32), "bb".repeat(32)];
        assert_eq!(judge(&revealed, &binding, "bitrefill:invoice:42", &paid), ReceiptVerdict::Valid { spent: 2 });
        assert_eq!(judge(&revealed, &binding, "bitrefill:invoice:43", &paid), ReceiptVerdict::WrongOrder);
        assert_eq!(judge(&[], &binding, "bitrefill:invoice:42", &paid), ReceiptVerdict::NotACertificate);
        assert_eq!(judge(&revealed, &binding, "bitrefill:invoice:42", &[]), ReceiptVerdict::NoShieldedSpend);
        let extra = vec!["aa".repeat(32), "dd".repeat(32)];
        assert_eq!(judge(&revealed, &binding, "bitrefill:invoice:42", &extra), ReceiptVerdict::NotPaidByCertifiedNotes { not_certified: vec!["dd".repeat(32)] });
    }

    /// The browser computes the same binding (frontend/src/lib/pof/hash.ts): pinned on the real
    /// testnet certificate's intent, whose binding is in fixtures/proofs/testnet-exit.pof.
    #[test]
    fn intent_binding_matches_the_testnet_certificate() {
        assert_eq!(hex::encode(pof_core::intent_binding("c1ea4e7e5a1f0002")), "1a5f6295f7b6a25406471a7c2d739cd3e90abe8c3f193f8f624792cfa3279d6a");
    }
}
