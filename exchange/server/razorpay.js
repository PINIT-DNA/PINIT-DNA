import crypto from 'crypto';
import Razorpay from 'razorpay';
import { activeCurrency } from './lib/money.js';

export function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** True when the configured key is a live (real money) key. */
export function isLiveKey() {
  return String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_');
}

function flagOn(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Demo mode: payments are marked successful without contacting a gateway.
 *
 * Off unless explicitly switched on, and it cannot be switched on against a
 * live key — a demo flag left set on a production deploy would hand out paid
 * accounts and licences for nothing, so the live key wins the argument every
 * time and the attempt is logged rather than honoured.
 *
 * PAYMENT_DEMO_MODE is the flag to use. PAYMENT_MOCK is the older spelling and
 * still works so existing environments keep behaving as they do today.
 */
let demoRefusalLogged = false;
export function isPaymentDemoMode() {
  const requested = flagOn('PAYMENT_DEMO_MODE') || flagOn('PAYMENT_MOCK');
  if (requested && isLiveKey()) {
    if (!demoRefusalLogged) {
      demoRefusalLogged = true;
      console.error(
        '[payments] REFUSED: demo mode requested while a live Razorpay key is configured. '
        + 'Real checkout will be used. Unset PAYMENT_DEMO_MODE / PAYMENT_MOCK on this environment.',
      );
    }
    return false;
  }
  return requested;
}

/**
 * Keys present but rejected by Razorpay (wrong secret / revoked test key).
 * Local/dev then falls back to mock so seller activation is still testable.
 * Never armed against a live key.
 */
let razorpayAuthBroken = false;
let razorpayAuthBrokenLogged = false;

function isRazorpayAuthFailure(err) {
  const status = Number(err?.statusCode || err?.status || 0);
  const desc = String(err?.error?.description || err?.message || '').toLowerCase();
  return status === 401 || desc.includes('authentication failed') || desc.includes('invalid key');
}

export function razorpayErrorMessage(err) {
  return (
    err?.error?.description ||
    err?.error?.reason ||
    err?.message ||
    (typeof err === 'string' ? err : '') ||
    'Payment provider error'
  );
}

/**
 * User-facing copy for gateway failures. Razorpay's 401 text is
 * "Authentication failed", which the storefront was showing as a logged-in
 * session error. Map that to the real cause: key id/secret on the API host.
 */
export function publicPaymentError(err) {
  if (isRazorpayAuthFailure(err) || /authentication failed|invalid key/i.test(razorpayErrorMessage(err))) {
    return (
      'Payment gateway rejected the Razorpay keys on the Exchange API. '
      + 'Set matching RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from the same Razorpay dashboard. '
      + 'This is not your Pinit login.'
    );
  }
  return razorpayErrorMessage(err) || 'Could not start payment';
}

/** After signature check: captured ₹2,500 INR on the expected order. */
export function sellerSubscriptionPaymentAcceptable(payment, expectedOrderId) {
  if (!payment) return { ok: false, reason: 'Payment not found at the gateway' };
  if (payment.mock || String(payment.id || '').startsWith('pay_mock_')) return { ok: true };
  if (expectedOrderId && payment.order_id && String(payment.order_id) !== String(expectedOrderId)) {
    return { ok: false, reason: 'Payment does not match this order' };
  }
  const status = String(payment.status || '').toLowerCase();
  if (status && !['captured', 'authorized'].includes(status)) {
    return { ok: false, reason: `Payment was not completed (status: ${status})` };
  }
  const amount = Number(payment.amount);
  if (Number.isFinite(amount) && amount > 0 && amount !== SELLER_SUBSCRIPTION_AMOUNT_PAISE) {
    return { ok: false, reason: 'Payment amount does not match the seller subscription' };
  }
  const currency = String(payment.currency || '').toUpperCase();
  if (currency && currency !== SELLER_SUBSCRIPTION_CURRENCY) {
    return { ok: false, reason: 'Payment currency does not match the seller subscription' };
  }
  return { ok: true };
}

function allowDevMockFallback() {
  return !isLiveKey() && process.env.NODE_ENV !== 'production';
}

function markRazorpayAuthBroken(err) {
  if (!allowDevMockFallback() || !isRazorpayAuthFailure(err)) return false;
  razorpayAuthBroken = true;
  if (!razorpayAuthBrokenLogged) {
    razorpayAuthBrokenLogged = true;
    console.warn(
      '[payments] Razorpay authentication failed with the configured test keys. '
      + 'Falling back to local mock checkout. Fix RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to use real sandbox checkout.',
    );
  }
  return true;
}

/**
 * Payments are simulated.
 *
 * This previously ended with `return !isRazorpayConfigured()`, so a deployment
 * that simply lacked its keys — a typo, a missing variable after a migration —
 * silently began accepting every payment as successful and activating accounts
 * for free. Missing configuration is now an error surfaced at the call site,
 * not an invitation to give the product away. Absent keys still simulate when
 * NODE_ENV is not production, which is the local-development case that
 * behaviour was written for.
 */
export function isPaymentMockMode() {
  if (isPaymentDemoMode()) return true;
  if (isLiveKey()) return false;
  if (razorpayAuthBroken && allowDevMockFallback()) return true;
  if (process.env.NODE_ENV === 'production') return false;
  return !isRazorpayConfigured();
}

export function getBillingPublicConfig() {
  return {
    configured: isRazorpayConfigured(),
    mock: isPaymentMockMode(),
    keyId: isRazorpayConfigured() && !isPaymentMockMode() ? process.env.RAZORPAY_KEY_ID : null,
    currency: activeCurrency(),
    // Surfaced so the storefront can warn that checkout will not capture a
    // real card while a test key is in use.
    testMode: String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_'),
    // Explicit demo mode, so the UI can label the payment plainly rather than
    // letting a simulated success look like a real one.
    demo: isPaymentDemoMode() || (razorpayAuthBroken && allowDevMockFallback()),
    live: isLiveKey(),
    provider: isPaymentMockMode() ? 'mock' : 'razorpay',
  };
}

function getClient() {
  if (!isRazorpayConfigured()) {
    throw new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function mockOrder({ amountPaise, currency }) {
  return {
    orderId: `order_mock_${Date.now()}`,
    amount: amountPaise,
    currency,
    keyId: null,
    mock: true,
  };
}

export async function createRazorpayOrder({ amountPaise, receipt, notes = {}, currency }) {
  const payCurrency = String(currency || activeCurrency()).toUpperCase();
  if (isPaymentMockMode()) {
    return mockOrder({ amountPaise, currency: payCurrency });
  }

  try {
    const client = getClient();
    const order = await client.orders.create({
      amount: amountPaise,
      currency: payCurrency,
      receipt: String(receipt || `ex_${Date.now()}`).slice(0, 40),
      payment_capture: 1,
      notes,
    });

    return {
      orderId: order.id,
      amount: Number(order.amount),
      currency: order.currency || payCurrency,
      keyId: process.env.RAZORPAY_KEY_ID,
      mock: false,
    };
  } catch (err) {
    if (markRazorpayAuthBroken(err)) {
      return mockOrder({ amountPaise, currency: payCurrency });
    }
    const wrapped = new Error(publicPaymentError(err));
    wrapped.status = err?.statusCode || 502;
    throw wrapped;
  }
}

export function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const mockOrderId = String(orderId || '').startsWith('order_mock_');
  const mockPaymentId = String(paymentId || '').startsWith('pay_mock_');
  if (mockOrderId || mockPaymentId) {
    // Never honour mock receipts against a live key.
    if (isLiveKey()) return false;
    return true;
  }
  if (isPaymentMockMode()) {
    return false;
  }
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
}

/**
 * Seller subscription: ₹2,500.00, expressed in paise as Razorpay requires.
 *
 * This was 2500 minor units of USD — $25 — which could not actually be paid.
 * Razorpay only offers UPI on INR orders, so a USD order dropped UPI from the
 * sheet entirely, and a USD charge on an Indian account is an international
 * transaction, which this account has disabled. That left card-only checkout
 * where every available card was refused: domestic cards cannot settle USD,
 * and international cards are blocked. The activation step was unpayable.
 *
 * Charging in INR restores UPI and domestic cards, and matches the currency
 * buyer orders are already charged in.
 */
export const SELLER_SUBSCRIPTION_AMOUNT_PAISE = 250000;
export const SELLER_SUBSCRIPTION_CURRENCY = 'INR';
/** @deprecated retained so existing imports keep resolving. */
export const SELLER_SUBSCRIPTION_AMOUNT_CENTS = SELLER_SUBSCRIPTION_AMOUNT_PAISE;
/** @deprecated use SELLER_SUBSCRIPTION_AMOUNT_PAISE */
export const SELLER_VERIFICATION_AMOUNT_PAISE = SELLER_SUBSCRIPTION_AMOUNT_PAISE;

export async function createRazorpayCustomer({ name, email, contact, notes = {} }) {
  if (isPaymentMockMode()) {
    return { id: `cust_mock_${Date.now()}`, mock: true };
  }
  try {
    const client = getClient();
    const customer = await client.customers.create({
      name: String(name || 'Pinit Seller').slice(0, 120),
      email: String(email || '').slice(0, 120) || undefined,
      contact: contact ? String(contact).slice(0, 15) : undefined,
      notes,
    });
    return { id: customer.id, mock: false };
  } catch (err) {
    if (markRazorpayAuthBroken(err)) {
      return { id: `cust_mock_${Date.now()}`, mock: true };
    }
    const wrapped = new Error(publicPaymentError(err));
    wrapped.status = err?.statusCode || 502;
    throw wrapped;
  }
}

export async function fetchRazorpayPayment(paymentId) {
  if (isPaymentMockMode() || String(paymentId || '').startsWith('pay_mock_')) {
    return {
      id: paymentId,
      method: 'card',
      card: { last4: '4242', network: 'Visa' },
      token_id: `token_mock_${Date.now()}`,
      mock: true,
    };
  }
  try {
    const client = getClient();
    return await client.payments.fetch(paymentId);
  } catch (err) {
    if (markRazorpayAuthBroken(err)) {
      return {
        id: paymentId,
        method: 'card',
        card: { last4: '4242', network: 'Visa' },
        token_id: `token_mock_${Date.now()}`,
        mock: true,
      };
    }
    const wrapped = new Error(publicPaymentError(err));
    wrapped.status = err?.statusCode || 502;
    throw wrapped;
  }
}

export async function refundRazorpayPayment(paymentId, amountPaise) {
  if (isPaymentMockMode()) {
    return { id: `rfnd_mock_${Date.now()}`, mock: true };
  }
  const client = getClient();
  return client.payments.refund(paymentId, { amount: amountPaise });
}

/**
 * Verify a Razorpay webhook signature.
 *
 * Mock mode no longer short-circuits this whenever a secret is configured.
 * `isPaymentMockMode()` is true if PAYMENT_MOCK is set OR if keys are simply
 * missing, so the old unconditional `return true` meant a single stray env var
 * in production turned every webhook into an unauthenticated write endpoint —
 * anyone could POST a "payment refunded" or "dispute lost" event.
 *
 * The bypass now applies only when there is genuinely no secret to check
 * against, which is the local-development case it was written for.
 */
export function verifyRazorpayWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return isPaymentMockMode();
  if (!signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Constant-time compare; length guard first because timingSafeEqual throws
  // on mismatched buffer lengths.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
