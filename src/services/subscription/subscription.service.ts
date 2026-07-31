/**
 * Subscription lifecycle — ensure FREE row, assign plan (manual / future billing).
 */

import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { PLAN_DEFINITIONS, PlanCode } from './constants/plans';
import {
  assertValidAccountPlanCombination,
} from '../account/account-subscription-rules';
import { AccountType } from '../account/constants/account-type';

export class SubscriptionService {
  /** Idempotent: every user gets an ACTIVE FREE subscription if missing. */
  async ensureDefaultSubscription(userId: string): Promise<void> {
    const existing = await prisma.subscription.findUnique({ where: { userId } });
    if (existing) return;

    const freePlan = await this.resolvePlanId(PlanCode.FREE);
    await prisma.subscription.create({
      data: {
        userId,
        planId: freePlan,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
      },
    });
  }

  async assignPlan(userId: string, planCode: PlanCode): Promise<void> {
    const def = PLAN_DEFINITIONS[planCode];
    if (!def) throw new AppError(400, `Unknown plan: ${planCode}`);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true },
    });
    const accountType = user?.accountType === AccountType.BUSINESS ? AccountType.BUSINESS : AccountType.INDIVIDUAL;
    assertValidAccountPlanCombination(accountType, planCode);

    const planId = await this.resolvePlanId(planCode);
    await this.ensureDefaultSubscription(userId);

    await prisma.subscription.update({
      where: { userId },
      data: {
        planId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        cancelAtPeriodEnd: false,
      },
    });
  }

  async listPlans() {
    // Always merge catalog pricing from constants (single source of truth)
    return Object.values(PLAN_DEFINITIONS)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        storageLimitBytes: p.storageLimitBytes,
        assetLimit: p.assetLimit,
        teamMemberLimit: p.teamMemberLimit,
        workspaceLimit: p.workspaceLimit,
        features: p.features,
        priceInr: p.priceInr,
        pricePaise: p.pricePaise,
        intervalLabel: p.intervalLabel,
        periodDays: p.periodDays,
      }));
  }

  private async resolvePlanId(planCode: PlanCode): Promise<string> {
    const def = PLAN_DEFINITIONS[planCode];
    let plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) {
      plan = await prisma.plan.create({
        data: {
          id: def.seedId,
          code: def.code,
          name: def.name,
          description: def.description,
          storageLimitBytes: def.storageLimitBytes != null ? BigInt(def.storageLimitBytes) : null,
          features: def.features,
          sortOrder: def.sortOrder,
          isActive: true,
        },
      });
    }
    return plan.id;
  }
}

export const subscriptionService = new SubscriptionService();
