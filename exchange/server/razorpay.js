import crypto from 'crypto';
import Razorpay from 'razorpay';

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
    currency: 'INR',
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

export async function createRazorpayOrder({ amountPaise, receipt, notes = {} }) {
  if (isPaymentMockMode()) {
    const mockId = `order_mock_${Date.now()}`;
    return {
      orderId: mockId,
      amount: amountPaise,
      currency: 'INR',
      keyId: null,
      mock: true,
    };
  }

  const client = getClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: String(receipt || `ex_${Date.now()}`).slice(0, 40),
    notes,
  });

  return {
    orderId: order.id,
    amount: Number(order.amount),
    currency: order.currency || 'INR',
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
