/**
 * Inbound gateway webhooks.
 *
 * Chargebacks and disputes are events we are *told* about — they originate at
 * the card network, not here. Until this existed, Exchange had a refund path
 * it could initiate but no way to learn that a buyer had disputed a charge, so
 * a chargeback would silently leave the licence active while the money was
 * pulled back.
 *
 * Two rules govern everything below:
 *
 *  - Nothing is trusted without a signature. The route verifies the HMAC over
 *    the exact received bytes before reading a single field.
 *  - Delivery is at-least-once. Gateways retry, so every write is idempotent:
 *    provider_dispute_id is unique, and a repeat delivery updates rather than
 *    inserts. A webhook that runs twice must not refund twice.
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { verifyRazorpayWebhookSignature } from '../razorpay.js';
import db from '../database.js';
import { getSql, runSql } from '../lib/db.js';
import { emitForSeal } from '../lib/asset-activity.js';

const router = express.Router();

/** Razorpay sends paise; our ledger is in major units. */
function fromPaise(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

/**
 * Map a gateway dispute status onto ours.
 *
 * `won` means the merchant kept the money; `lost` means it was pulled back.
 * Only `lost` should revoke a licence — revoking on `open` would punish a
 * buyer for a dispute that may still be decided in their favour, and revoking
 * on `won` would punish them for one they already lost.
 */
function mapDisputeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['won', 'closed'].includes(s)) return 'won';
  if (['lost'].includes(s)) return 'lost';
  if (['under_review', 'action_required'].includes(s)) return 'under_review';
  return 'open';
}

router.post('/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.rawBody;

  if (!verifyRazorpayWebhookSignature(raw, signature)) {
    // Deliberately terse: a signature failure should not describe what was
    // wrong with the attempt.
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = String(req.body?.event || '').trim();
  const payload = req.body?.payload || {};

  // Acknowledge fast. A gateway that does not get a prompt 200 retries, and a
  // slow handler turns one dispute into several delivery attempts. The work
  // below is idempotent, so replying first is safe.
  res.json({ ok: true, event });

  try {
    if (!event.startsWith('payment.dispute')) return;

    const d = payload?.dispute?.entity || {};
    const providerDisputeId = String(d.id || '').trim();
    const paymentId = String(d.payment_id || '').trim();
    if (!providerDisputeId || !paymentId) return;

    // Resolve the dispute to the order it belongs to, so it inherits the
    // canonical asset id rather than inventing one.
    const order = await getSql(
      'SELECT * FROM orders_sealed WHERE razorpay_payment_id = ?',
      [paymentId],
    );

    const status = mapDisputeStatus(d.status);
    const existing = providerDisputeId
      ? await getSql('SELECT * FROM disputes WHERE provider_dispute_id = ?', [providerDisputeId])
      : null;

    if (existing) {
      await runSql(
        `UPDATE disputes
            SET status = ?, phase = ?, reason = ?, updated_at = CURRENT_TIMESTAMP, raw_event = ?
          WHERE provider_dispute_id = ?`,
        [status, String(d.phase || ''), String(d.reason_code || d.reason_description || ''),
          JSON.stringify(req.body).slice(0, 8000), providerDisputeId],
      );
    } else {
      await runSql(
        `INSERT INTO disputes (
           id, provider, provider_dispute_id, provider_payment_id, order_id, seal_id,
           asset_id, seller_pinit_id, buyer_pinit_id, amount, currency, reason,
           status, phase, respond_by, raw_event
         ) VALUES (?, 'razorpay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `DSP-${randomUUID().slice(0, 8).toUpperCase()}`,
          providerDisputeId,
          paymentId,
          order?.order_id || null,
          order?.seal_id || null,
          order?.asset_id || null,
          order?.seller_pinit_id || null,
          order?.buyer_pinit_id || null,
          fromPaise(d.amount),
          String(d.currency || order?.currency || ''),
          String(d.reason_code || d.reason_description || ''),
          status,
          String(d.phase || ''),
          d.respond_by ? new Date(Number(d.respond_by) * 1000).toISOString() : null,
          JSON.stringify(req.body).slice(0, 8000),
        ],
      );
    }

    if (!order) return;

    // A lost dispute is money reversed. The licence stops being valid, and the
    // delivery token is revoked so the file cannot be pulled afterwards.
    if (status === 'lost') {
      await runSql(
        `UPDATE orders_sealed
            SET status = 'refunded', license_status = 'revoked', delivery_status = 'revoked'
          WHERE seal_id = ?`,
        [order.seal_id],
      );
      // Reverse the creator's accrual for this sale. Without this the payout
      // ledger would still owe money that was clawed back.
      await runSql(
        `UPDATE seller_earnings SET status = 'reversed' WHERE seal_id = ?`,
        [order.seal_id],
      );
      emitForSeal(db, order.seal_id, {
        eventType: 'DISPUTED',
        title: 'Chargeback lost — licence revoked',
        detail: `Dispute ${providerDisputeId}`,
        payload: { disputeId: providerDisputeId, status },
      });
    } else {
      emitForSeal(db, order.seal_id, {
        eventType: 'DISPUTED',
        title: `Dispute ${status}`,
        detail: `Dispute ${providerDisputeId}`,
        payload: { disputeId: providerDisputeId, status },
      });
    }
  } catch (err) {
    // The response has already been sent; log and move on rather than throwing
    // into an ended request.
    console.error('[webhook] razorpay dispute handling failed:', err.message);
  }
});

export default router;
