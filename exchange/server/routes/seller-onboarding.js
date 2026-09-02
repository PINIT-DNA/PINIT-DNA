import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireOnboardingPayer, requireVerifiedIdentity } from '../lib/rbac.js';
import { getSql, runSql } from '../lib/db.js';
import { enrichPublicUser, isSellerRole } from '../lib/roles.js';
import {
  ONBOARDING,
  isSellerOnboardingComplete,
  normalizeOnboardingStatus,
} from '../lib/seller-onboarding.js';
import {
  createRazorpayOrder,
  createRazorpayCustomer,
  fetchRazorpayPayment,
  getBillingPublicConfig,
  verifyRazorpaySignature,
  publicPaymentError,
  sellerSubscriptionPaymentAcceptable,
  orderStillPayable,
  SELLER_SUBSCRIPTION_AMOUNT_CENTS,
  SELLER_SUBSCRIPTION_CURRENCY,
} from '../razorpay.js';

const router = express.Router();
router.use(requireVerifiedIdentity);
router.use(requireOnboardingPayer);

async function ensureCreatorForPayment(user) {
  if (isSellerRole(user.role)) return user;
  const paid = await getSql(
    `SELECT id FROM seller_payment_methods
      WHERE pinit_id = ? AND status = 'verified' LIMIT 1`,
    [user.pinit_id],
  );
  const nextStatus = paid ? ONBOARDING.SELLER_ACTIVE : ONBOARDING.PAYMENT_METHOD_REQUIRED;
  await runSql(
    `UPDATE users SET
      role = 'creator',
      account_intent = 'creator',
      seller_plan = COALESCE(seller_plan, 'starter'),
      seller_onboarding_status = ?,
      buyer_enabled = 1
     WHERE pinit_id = ?`,
    [nextStatus, user.pinit_id],
  );
  return getSql('SELECT * FROM users WHERE pinit_id = ?', [user.pinit_id]);
}

function idempotencyKey(req) {
  return String(
    req.body?.idempotency_key ||
      req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      '',
  ).trim();
}

function defaultIdempotencyKey(pinitId) {
  return `seller_pm_${pinitId}_${new Date().toISOString().slice(0, 10)}`;
}

async function loadVerifiedPaymentMethod(pinitId) {
  return getSql(
    `SELECT id, provider, provider_method_id, status, method_type, last4, brand, verified_at
     FROM seller_payment_methods
     WHERE pinit_id = ? AND status = 'verified'
     ORDER BY verified_at DESC LIMIT 1`,
    [pinitId],
  );
}

async function buildStatusResponse(user) {
  const verified = await loadVerifiedPaymentMethod(user.pinit_id);
  const status = normalizeOnboardingStatus(user.seller_onboarding_status);
  const complete = isSellerOnboardingComplete(user);
  const publicUser = enrichPublicUser(user);
  return {
    user: publicUser,
    seller_onboarding_status: status,
    seller_onboarding_complete: complete,
    seller_payment_verified: complete,
    requires_payment_method: !complete,
    payment_method: verified
      ? {
          provider: verified.provider,
          status: verified.status,
          method_type: verified.method_type,
          last4: verified.last4,
          brand: verified.brand,
          verified_at: verified.verified_at,
        }
      : null,
    billing: getBillingPublicConfig(),
    message: complete
      ? 'Seller account verified.'
      : 'Pay the ₹2,500 seller subscription to activate your seller account.',
  };
}

/** GET /api/seller/onboarding/status */
router.get('/status', async (req, res) => {
  try {
    const user = await ensureCreatorForPayment(req.exchangeUser);
    res.json(await buildStatusResponse(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/seller/onboarding/payment-method — initialize Razorpay verification checkout */
router.post('/payment-method', async (req, res) => {
  try {
    const user = await ensureCreatorForPayment(req.exchangeUser);
    req.exchangeUser = user;
    if (isSellerOnboardingComplete(user)) {
      return res.json({
        already_verified: true,
        ...(await buildStatusResponse(user)),
      });
    }

    const key = idempotencyKey(req) || defaultIdempotencyKey(user.pinit_id);

    const existingIntent = await getSql(
      `SELECT * FROM seller_onboarding_intents WHERE idempotency_key = ? AND pinit_id = ? LIMIT 1`,
      [key, user.pinit_id],
    );
    if (existingIntent?.status === 'completed') {
      const fresh = await getSql('SELECT * FROM users WHERE pinit_id = ?', [user.pinit_id]);
      return res.json({ already_verified: true, ...(await buildStatusResponse(fresh)) });
    }

    const reusable = existingIntent?.razorpay_order_id
      && existingIntent.status === 'pending'
      && await orderStillPayable(existingIntent.razorpay_order_id);
    if (reusable) {
      const billing = getBillingPublicConfig();
      return res.json({
        idempotency_key: key,
        intent_id: existingIntent.id,
        orderId: existingIntent.razorpay_order_id,
        amount: SELLER_SUBSCRIPTION_AMOUNT_CENTS,
        currency: SELLER_SUBSCRIPTION_CURRENCY,
        keyId: billing.keyId,
        mock: billing.mock,
        description: 'Seller subscription — ₹2,500',
        subscription_amount_cents: SELLER_SUBSCRIPTION_AMOUNT_CENTS,
      });
    }

    let customerId = user.razorpay_customer_id;
    if (!customerId) {
      try {
        const customer = await createRazorpayCustomer({
          name: user.display_name || user.name,
          email: user.email,
          notes: { pinit_id: user.pinit_id, purpose: 'seller_subscription' },
        });
        customerId = customer.id;
        await runSql('UPDATE users SET razorpay_customer_id = ? WHERE pinit_id = ?', [
          customerId,
          user.pinit_id,
        ]);
      } catch (custErr) {
        console.warn('[seller/onboarding] Razorpay customer skipped:', publicPaymentError(custErr));
      }
    }

    const intentId = existingIntent?.id || uuidv4();
    const receipt = `spm_${user.pinit_id.slice(-8)}_${Date.now()}`.slice(0, 40);
    const order = await createRazorpayOrder({
      amountPaise: SELLER_SUBSCRIPTION_AMOUNT_CENTS,
      currency: SELLER_SUBSCRIPTION_CURRENCY,
      receipt,
      notes: {
        purpose: 'seller_subscription',
        pinit_id: user.pinit_id,
        amount_inr: '2500',
      },
    });

    if (existingIntent?.id) {
      await runSql(
        `UPDATE seller_onboarding_intents SET razorpay_order_id = ?, status = 'pending' WHERE id = ?`,
        [order.orderId, existingIntent.id],
      );
    } else {
      await runSql(
        `INSERT INTO seller_onboarding_intents (id, pinit_id, idempotency_key, razorpay_order_id, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [intentId, user.pinit_id, key, order.orderId],
      );
    }
    await runSql(
      `UPDATE users SET seller_onboarding_status = ? WHERE pinit_id = ?`,
      [ONBOARDING.PAYMENT_METHOD_PENDING, user.pinit_id],
    );

    res.json({
      idempotency_key: key,
      intent_id: intentId,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency || SELLER_SUBSCRIPTION_CURRENCY,
      keyId: order.keyId,
      mock: order.mock,
      customerId,
      description: 'Seller subscription — ₹2,500',
      subscription_amount_cents: SELLER_SUBSCRIPTION_AMOUNT_CENTS,
    });
  } catch (err) {
    console.error('[seller/onboarding/payment-method]', publicPaymentError(err), err);
    res.status(500).json({
      error: publicPaymentError(err) || 'Could not initialize payment method setup',
      message: publicPaymentError(err) || 'Could not initialize payment method setup',
    });
  }
});

/** POST /api/seller/onboarding/payment-method/verify */
router.post('/payment-method/verify', async (req, res) => {
  try {
    const user = req.exchangeUser;
    if (isSellerOnboardingComplete(user)) {
      return res.json({
        message: 'Seller account already verified',
        user: enrichPublicUser(user),
        ...(await buildStatusResponse(user)),
      });
    }

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = req.body || {};

    if (!orderId || !paymentId) {
      return res.status(400).json({ error: 'razorpay_order_id and razorpay_payment_id are required' });
    }

    const key = idempotencyKey(req) || defaultIdempotencyKey(user.pinit_id);
    let intent = await getSql(
      `SELECT * FROM seller_onboarding_intents WHERE razorpay_order_id = ? AND pinit_id = ? LIMIT 1`,
      [orderId, user.pinit_id],
    );
    if (!intent) {
      intent = await getSql(
        `SELECT * FROM seller_onboarding_intents WHERE idempotency_key = ? AND pinit_id = ? LIMIT 1`,
        [key, user.pinit_id],
      );
    }
    if (!intent?.razorpay_order_id) {
      return res.status(400).json({
        error: 'INVALID_PAYMENT_INTENT',
        message: 'This payment session expired or is invalid. Start payment again.',
      });
    }
    if (intent.razorpay_order_id !== orderId) {
      return res.status(409).json({ error: 'Order mismatch for this verification session' });
    }
    if (intent.status === 'completed') {
      const fresh = await getSql('SELECT * FROM users WHERE pinit_id = ?', [user.pinit_id]);
      return res.json({
        message: 'Seller account already verified',
        user: enrichPublicUser(fresh),
        ...(await buildStatusResponse(fresh)),
      });
    }

    if (!verifyRazorpaySignature({ orderId, paymentId, signature: signature || '' })) {
      await runSql(
        `UPDATE users SET seller_onboarding_status = ? WHERE pinit_id = ?`,
        [ONBOARDING.PAYMENT_METHOD_FAILED, user.pinit_id],
      );
      return res.status(402).json({
        error: 'PAYMENT_VERIFICATION_FAILED',
        message: 'Payment verification failed. Please try again.',
      });
    }

    const existingVerified = await loadVerifiedPaymentMethod(user.pinit_id);
    if (existingVerified) {
      const fresh = await getSql('SELECT * FROM users WHERE pinit_id = ?', [user.pinit_id]);
      return res.json({
        message: 'Seller account already verified',
        user: enrichPublicUser(fresh),
        ...(await buildStatusResponse(fresh)),
      });
    }

    const duplicatePay = await getSql(
      `SELECT id FROM seller_payment_methods WHERE provider_payment_id = ? AND status = 'verified' LIMIT 1`,
      [paymentId],
    );
    if (duplicatePay) {
      await runSql(
        `UPDATE users SET seller_onboarding_status = ? WHERE pinit_id = ?`,
        [ONBOARDING.SELLER_ACTIVE, user.pinit_id],
      );
      if (intent?.id) {
        await runSql(
          `UPDATE seller_onboarding_intents SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [intent.id],
        );
      }
      const fresh = await getSql('SELECT * FROM users WHERE pinit_id = ?', [user.pinit_id]);
      return res.json({
        message: 'Seller subscription already recorded for this payment.',
        user: enrichPublicUser(fresh),
        ...(await buildStatusResponse(fresh)),
      });
    }

    const payment = await fetchRazorpayPayment(paymentId);
    const accepted = sellerSubscriptionPaymentAcceptable(payment, orderId);
    if (!accepted.ok) {
      await runSql(
        `UPDATE users SET seller_onboarding_status = ? WHERE pinit_id = ?`,
        [ONBOARDING.PAYMENT_METHOD_FAILED, user.pinit_id],
      );
      return res.status(402).json({
        error: 'PAYMENT_VERIFICATION_FAILED',
        message: accepted.reason,
      });
    }
    const methodId = payment.token_id || payment.id;
    const methodType = payment.method || 'unknown';
    const last4 = payment.card?.last4 || payment.vpa?.slice(-4) || null;
    const brand = payment.card?.network || payment.bank || null;

    const pmId = uuidv4();
    await runSql(
      `INSERT INTO seller_payment_methods (
        id, pinit_id, provider, provider_customer_id, provider_method_id,
        provider_payment_id, status, method_type, last4, brand, idempotency_key, verified_at
      ) VALUES (?, ?, 'razorpay', ?, ?, ?, 'verified', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        pmId,
        user.pinit_id,
        user.razorpay_customer_id || null,
        methodId,
        paymentId,
        methodType,
        last4,
        brand,
        key,
      ],
    );

    await runSql(
      `UPDATE users SET seller_onboarding_status = ? WHERE pinit_id = ?`,
      [ONBOARDING.SELLER_ACTIVE, user.pinit_id],
    );
    if (intent?.id) {
      await runSql(
        `UPDATE seller_onboarding_intents SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [intent.id],
      );
    }

    const updated = await getSql('SELECT * FROM users WHERE pinit_id = ?', [user.pinit_id]);
    res.json({
      message: 'Seller subscription paid. Your seller account is active.',
      user: enrichPublicUser(updated),
      ...(await buildStatusResponse(updated)),
    });
  } catch (err) {
    if (req.exchangeUser?.pinit_id) {
      await runSql(
        `UPDATE users SET seller_onboarding_status = ? WHERE pinit_id = ?`,
        [ONBOARDING.PAYMENT_METHOD_FAILED, req.exchangeUser.pinit_id],
      ).catch(() => {});
    }
    res.status(500).json({
      error: 'PAYMENT_VERIFICATION_FAILED',
      message: err.message || 'Payment verification failed',
    });
  }
});

export default router;
