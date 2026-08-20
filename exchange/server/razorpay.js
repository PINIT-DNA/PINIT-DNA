import crypto from 'crypto';
import Razorpay from 'razorpay';
import { activeCurrency } from './lib/money.js';

export function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** Mock payments when keys missing, or PAYMENT_MOCK=1 (local auto-success). */
export function isPaymentMockMode() {
  if (String(process.env.PAYMENT_MOCK || '').trim() === '1') return true;
  if (String(process.env.PAYMENT_MOCK || '').toLowerCase() === 'true') return true;
  return !isRazorpayConfigured();
}

export function getBillingPublicConfig() {
  return {
    configured: isRazorpayConfigured(),
    mock: isPaymentMockMode(),
    keyId: isRazorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null,
    currency: activeCurrency(),
    // Surfaced so the storefront can warn that checkout will not capture a
    // real card while a test key is in use.
    testMode: String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_'),
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

export async function createRazorpayOrder({ amountPaise, receipt, notes = {}, currency }) {
  const payCurrency = String(currency || activeCurrency()).toUpperCase();
  if (isPaymentMockMode()) {
    const mockId = `order_mock_${Date.now()}`;
    return {
      orderId: mockId,
      amount: amountPaise,
      currency: payCurrency,
      keyId: null,
      mock: true,
    };
  }

  const client = getClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: payCurrency,
    receipt: String(receipt || `ex_${Date.now()}`).slice(0, 40),
    notes,
  });

  return {
    orderId: order.id,
    amount: Number(order.amount),
    currency: order.currency || payCurrency,
    keyId: process.env.RAZORPAY_KEY_ID,
    mock: false,
  };
}

export function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  if (isPaymentMockMode()) {
    return String(orderId || '').startsWith('order_mock_') || String(paymentId || '').startsWith('pay_mock_');
  }
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
}

/** Seller subscription: $25.00 (minor units / cents). Test-mode mock still uses this amount. */
export const SELLER_SUBSCRIPTION_AMOUNT_CENTS = 2500;
export const SELLER_SUBSCRIPTION_CURRENCY = 'USD';
/** @deprecated use SELLER_SUBSCRIPTION_AMOUNT_CENTS */
export const SELLER_VERIFICATION_AMOUNT_PAISE = SELLER_SUBSCRIPTION_AMOUNT_CENTS;

export async function createRazorpayCustomer({ name, email, contact, notes = {} }) {
  if (isPaymentMockMode()) {
    return { id: `cust_mock_${Date.now()}`, mock: true };
  }
  const client = getClient();
  const customer = await client.customers.create({
    name: String(name || 'Pinit Seller').slice(0, 120),
    email: String(email || '').slice(0, 120) || undefined,
    contact: contact ? String(contact).slice(0, 15) : undefined,
    notes,
  });
  return { id: customer.id, mock: false };
}

export async function fetchRazorpayPayment(paymentId) {
  if (isPaymentMockMode()) {
    return {
      id: paymentId,
      method: 'card',
      card: { last4: '4242', network: 'Visa' },
      token_id: `token_mock_${Date.now()}`,
      mock: true,
    };
  }
  const client = getClient();
  return client.payments.fetch(paymentId);
}

export async function refundRazorpayPayment(paymentId, amountPaise) {
  if (isPaymentMockMode()) {
    return { id: `rfnd_mock_${Date.now()}`, mock: true };
  }
  const client = getClient();
  return client.payments.refund(paymentId, { amount: amountPaise });
}

export function verifyRazorpayWebhookSignature(rawBody, signature) {
  if (isPaymentMockMode()) return true;
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}
