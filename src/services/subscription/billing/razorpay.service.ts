/**
 * Razorpay billing — create order + verify payment signature.
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { config } from '../../../config';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../../api/middleware/error.middleware';
import { PLAN_DEFINITIONS, PlanCode } from '../constants/plans';
import { subscriptionService } from '../subscription.service';
import { logger } from '../../../lib/logger';

export function isRazorpayConfigured(): boolean {
  return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
}

/** True when the configured key is a live (real money) key. */
export function isLiveRazorpayKey(): boolean {
  return String(config.razorpay.keyId || '').startsWith('rzp_live_');
}

/**
 * Simulated checkout — skips Razorpay's mobile/OTP/card flow entirely so
 * local/dev testing of the subscription flow doesn't need real payment
 * details. Hard-blocked in production and whenever a live key is configured,
 * regardless of any other setting — mirrors the Exchange app's
 * PAYMENT_DEMO_MODE guard (isPaymentDemoMode in exchange/server/razorpay.js).
 */
export function isMockBillingAllowed(): boolean {
  return config.env !== 'production' && !isLiveRazorpayKey();
}

function getClient(): Razorpay {
  if (!isRazorpayConfigured()) {
    throw new AppError(503, 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  return new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret,
  });
}

export class RazorpayBillingService {
  getPublicConfig() {
    return {
      configured: isRazorpayConfigured(),
      keyId: config.razorpay.keyId || null,
      currency: 'INR',
      mockAllowed: isMockBillingAllowed(),
    };
  }

  async createOrder(userId: string, planCode: PlanCode) {
    if (planCode === PlanCode.FREE) {
      throw new AppError(400, 'Free plan does not require payment');
    }
    const plan = PLAN_DEFINITIONS[planCode];
    if (!plan || plan.pricePaise <= 0) {
      throw new AppError(400, 'Invalid paid plan');
    }

    await subscriptionService.ensureDefaultSubscription(userId);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new AppError(500, 'Subscription not found');

    const client = getClient();
    const receipt = `pinit_${planCode}_${userId.slice(0, 8)}_${Date.now()}`.slice(0, 40);

    const order = await client.orders.create({
      amount: plan.pricePaise,
      currency: 'INR',
      receipt,
      notes: {
        userId,
        planCode,
        subscriptionId: sub.id,
      },
    });

    await prisma.billingHistory.create({
      data: {
        subscriptionId: sub.id,
        amountCents: plan.pricePaise, // paise stored in amountCents for INR
        currency: 'INR',
        provider: 'RAZORPAY',
        externalId: order.id,
        status: 'PENDING',
        rawPayload: {
          orderId: order.id,
          planCode,
          userId,
          amount: order.amount,
          currency: order.currency,
          receipt,
        },
      },
    });

    logger.info('[Razorpay] Order created', { orderId: order.id, planCode, userId });

    return {
      orderId: order.id,
      amount: Number(order.amount),
      currency: order.currency ?? 'INR',
      keyId: config.razorpay.keyId,
      planCode,
      planName: plan.name,
      priceInr: plan.priceInr,
    };
  }

  async verifyAndActivate(input: {
    userId: string;
    planCode: PlanCode;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) {
    if (!isRazorpayConfigured()) {
      throw new AppError(503, 'Razorpay is not configured');
    }

    const body = `${input.razorpayOrderId}|${input.razorpayPaymentId}`;
    const expected = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(body)
      .digest('hex');

    if (expected !== input.razorpaySignature) {
      throw new AppError(400, 'Invalid payment signature');
    }

    const plan = PLAN_DEFINITIONS[input.planCode];
    if (!plan || input.planCode === PlanCode.FREE) {
      throw new AppError(400, 'Invalid plan for payment');
    }

    await subscriptionService.ensureDefaultSubscription(input.userId);
    const sub = await prisma.subscription.findUnique({ where: { userId: input.userId } });
    if (!sub) throw new AppError(500, 'Subscription not found');

    const billing = await prisma.billingHistory.findFirst({
      where: {
        subscriptionId: sub.id,
        externalId: input.razorpayOrderId,
        provider: 'RAZORPAY',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (billing?.status === 'SUCCEEDED') {
      // Idempotent replay
      await subscriptionService.assignPlan(input.userId, input.planCode);
      return { alreadyProcessed: true };
    }

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + (plan.periodDays || 30));

    await prisma.$transaction(async (tx) => {
      if (billing) {
        await tx.billingHistory.update({
          where: { id: billing.id },
          data: {
            status: 'SUCCEEDED',
            rawPayload: {
              ...(typeof billing.rawPayload === 'object' && billing.rawPayload
                ? (billing.rawPayload as object)
                : {}),
              paymentId: input.razorpayPaymentId,
              signature: input.razorpaySignature,
              verifiedAt: new Date().toISOString(),
            },
          },
        });
      } else {
        await tx.billingHistory.create({
          data: {
            subscriptionId: sub.id,
            amountCents: plan.pricePaise,
            currency: 'INR',
            provider: 'RAZORPAY',
            externalId: input.razorpayOrderId,
            status: 'SUCCEEDED',
            rawPayload: {
              paymentId: input.razorpayPaymentId,
              orderId: input.razorpayOrderId,
              planCode: input.planCode,
            },
          },
        });
      }

      const planRow = await tx.plan.findUnique({ where: { code: input.planCode } });
      if (!planRow) throw new AppError(500, 'Plan catalog missing');

      await tx.subscription.update({
        where: { userId: input.userId },
        data: {
          planId: planRow.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          externalSubscriptionId: input.razorpayPaymentId,
        },
      });
    });

    logger.info('[Razorpay] Payment verified — plan activated', {
      userId: input.userId,
      planCode: input.planCode,
      paymentId: input.razorpayPaymentId,
    });

    return { alreadyProcessed: false, planCode: input.planCode, currentPeriodEnd: periodEnd.toISOString() };
  }
}

export const razorpayBillingService = new RazorpayBillingService();
