/**
 * Hub-owned Razorpay gateway for Exchange.
 * One Razorpay account (Hub keys). Exchange does not hold a second integration.
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../api/middleware/error.middleware';

function keyId(): string {
  return String(config.razorpay.keyId || '').trim();
}

function keySecret(): string {
  return String(config.razorpay.keySecret || '').trim();
}

export function hubRazorpayConfigured(): boolean {
  return Boolean(keyId() && keySecret());
}

function getClient(): Razorpay {
  if (!hubRazorpayConfigured()) {
    throw new AppError(503, 'Payment provider is not configured on Pinit HUB.');
  }
  return new Razorpay({ key_id: keyId(), key_secret: keySecret() });
}

function stringNotes(notes: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes || {})) {
    if (v == null) continue;
    out[k] = String(v).slice(0, 255);
  }
  return out;
}

export async function createHubGatewayOrder(input: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, unknown>;
}) {
  const amount = Math.round(Number(input.amountPaise));
  if (!Number.isFinite(amount) || amount < 100) {
    throw new AppError(400, 'Invalid payment amount');
  }
  const currency = String(input.currency || 'INR').toUpperCase();
  const client = getClient();
  try {
    const order = await client.orders.create({
      amount,
      currency,
      receipt: String(input.receipt || `hub_${Date.now()}`).slice(0, 40),
      notes: stringNotes(input.notes),
    });
    logger.info('[hub-gateway] Razorpay order created', { orderId: order.id, currency, amount });
    return {
      orderId: order.id,
      amount: Number(order.amount),
      currency: order.currency || currency,
      keyId: keyId(),
      mock: false,
    };
  } catch (err: any) {
    const status = Number(err?.statusCode || err?.status || 0);
    const description = String(err?.error?.description || err?.message || '');
    logger.error('[hub-gateway] Razorpay order failed', {
      status,
      description,
    });
    if (status === 401 || /authentication failed|invalid key/i.test(description)) {
      throw new AppError(401, 'PAYMENT_GATEWAY_AUTH_FAILED');
    }
    throw new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE');
  }
}

export function verifyHubGatewaySignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!keySecret()) return false;
  const body = `${input.orderId}|${input.paymentId}`;
  const expected = crypto.createHmac('sha256', keySecret()).update(body).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(input.signature || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function fetchHubGatewayPayment(paymentId: string) {
  const client = getClient();
  try {
    const payment = await client.payments.fetch(paymentId);
    return payment;
  } catch (err: any) {
    logger.error('[hub-gateway] Razorpay payment fetch failed', {
      paymentId,
      description: err?.error?.description || err?.message,
    });
    throw new AppError(502, 'PAYMENT_GATEWAY_UNAVAILABLE');
  }
}
