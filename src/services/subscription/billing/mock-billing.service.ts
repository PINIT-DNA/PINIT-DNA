/**
 * Mock billing — simulates payment success until Razorpay/Stripe is wired.
 * Swap provider in billing router; frontend flow stays the same.
 */

import crypto from 'crypto';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../../api/middleware/error.middleware';
import { PLAN_DEFINITIONS, PlanCode } from '../constants/plans';
import { subscriptionService } from '../subscription.service';
import { logger } from '../../../lib/logger';

export interface MockCompleteInput {
  userId: string;
  planCode: PlanCode;
  paymentMethod?: string;
  coupon?: string;
}

export interface MockCompleteResult {
  transactionId: string;
  planCode: PlanCode;
  planName: string;
  amountInr: number;
  currentPeriodEnd: string;
}

export class MockBillingService {
  async completePayment(input: MockCompleteInput): Promise<MockCompleteResult> {
    const { userId, planCode } = input;
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

    const transactionId = `MOCK_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + (plan.periodDays || 30));

    await prisma.$transaction(async (tx) => {
      await tx.billingHistory.create({
        data: {
          subscriptionId: sub.id,
          amountCents: plan.pricePaise,
          currency: 'INR',
          provider: 'NONE',
          externalId: transactionId,
          status: 'SUCCEEDED',
          rawPayload: {
            mock: true,
            planCode,
            paymentMethod: input.paymentMethod ?? 'card',
            coupon: input.coupon ?? null,
            completedAt: new Date().toISOString(),
          },
        },
      });

      const planRow = await tx.plan.findUnique({ where: { code: planCode } });
      if (!planRow) throw new AppError(500, 'Plan catalog missing');

      await tx.subscription.update({
        where: { userId },
        data: {
          planId: planRow.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          externalSubscriptionId: transactionId,
        },
      });
    });

    logger.info('[MockBilling] Payment completed', { userId, planCode, transactionId });

    return {
      transactionId,
      planCode,
      planName: plan.name,
      amountInr: plan.priceInr,
      currentPeriodEnd: periodEnd.toISOString(),
    };
  }

  async listHistory(userId: string) {
    await subscriptionService.ensureDefaultSubscription(userId);
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) return [];

    const rows = await prisma.billingHistory.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows.map((r) => {
      const payload = (typeof r.rawPayload === 'object' && r.rawPayload
        ? r.rawPayload
        : {}) as Record<string, unknown>;
      const planCode = (payload.planCode as string) ?? '—';
      const plan = Object.values(PLAN_DEFINITIONS).find((p) => p.code === planCode);
      return {
        id: r.id,
        transactionId: r.externalId ?? r.id,
        status: r.status,
        amountInr: Math.round(r.amountCents / 100),
        currency: r.currency,
        provider: r.provider,
        planCode,
        planName: plan?.name ?? planCode,
        createdAt: r.createdAt.toISOString(),
        mock: payload.mock === true,
      };
    });
  }
}

export const mockBillingService = new MockBillingService();
