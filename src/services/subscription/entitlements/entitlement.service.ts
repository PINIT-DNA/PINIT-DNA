/**
 * Central Feature Entitlement Engine.
 * All subscription checks MUST go through this service.
 */

import { prisma } from '../../../lib/prisma';
import { AppError } from '../../../api/middleware/error.middleware';
import { config } from '../../../config';
import { FeatureKey } from '../constants/features';
import {
  PLAN_DEFINITIONS,
  PlanCode,
  requiredPlanForFeature,
} from '../constants/plans';
import type { EntitlementResult, UserSubscriptionView } from '../types';
import { subscriptionService } from '../subscription.service';
import { storageUsageService } from '../usage/storage-usage.service';
import { assetQuotaService } from '../usage/asset-quota.service';
import { AccountType } from '../../account/constants/account-type';

const ADMIN_BYPASS_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

export class EntitlementService {
  isEnforcementEnabled(): boolean {
    return config.subscription.enforcementEnabled;
  }

  async getEffectivePlanCode(userId: string): Promise<PlanCode> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user && ADMIN_BYPASS_ROLES.has(user.role)) {
      return PlanCode.ENTERPRISE;
    }

    await subscriptionService.ensureDefaultSubscription(userId);

    const sub = await prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });

    if (!sub || sub.status === 'CANCELED' || sub.status === 'EXPIRED') {
      return PlanCode.FREE;
    }

    const code = sub.plan.code as PlanCode;
    return PLAN_DEFINITIONS[code] ? code : PlanCode.FREE;
  }

  async getFeaturesForUser(userId: string): Promise<FeatureKey[]> {
    const planCode = await this.getEffectivePlanCode(userId);
    const base = [...PLAN_DEFINITIONS[planCode].features];

    const overrides = await prisma.featureEntitlement.findMany({
      where: { userId },
    });
    const set = new Set<FeatureKey>(base);
    for (const o of overrides) {
      const key = o.featureKey as FeatureKey;
      if (o.enabled) set.add(key);
      else set.delete(key);
    }
    return [...set];
  }

  async hasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
    if (!this.isEnforcementEnabled()) return true;
    const features = await this.getFeaturesForUser(userId);
    return features.includes(feature);
  }

  async checkFeature(userId: string, feature: FeatureKey): Promise<EntitlementResult> {
    const planCode = await this.getEffectivePlanCode(userId);
    const requiredPlan = requiredPlanForFeature(feature);
    const allowed = await this.hasFeature(userId, feature);
    return {
      allowed,
      feature,
      planCode,
      requiredPlan,
      reason: allowed ? undefined : 'Subscription Required',
    };
  }

  async assertFeature(userId: string, feature: FeatureKey): Promise<void> {
    const result = await this.checkFeature(userId, feature);
    if (result.allowed) return;
    throw new SubscriptionRequiredError(result.requiredPlan, feature);
  }

  async getStorageLimitBytes(userId: string): Promise<number | null> {
    const planCode = await this.getEffectivePlanCode(userId);
    return PLAN_DEFINITIONS[planCode].storageLimitBytes;
  }

  async assertCanUpload(userId: string, incomingBytes: number): Promise<void> {
    if (!this.isEnforcementEnabled()) return;

    await this.assertCanProtectAsset(userId);

    const limit = await this.getStorageLimitBytes(userId);
    if (limit == null) return; // unlimited

    const used = await storageUsageService.getUsedBytes(userId);
    if (used + incomingBytes > limit) {
      const planCode = await this.getEffectivePlanCode(userId);
      const next = planCode === PlanCode.FREE ? PlanCode.PRO : PlanCode.ENTERPRISE;
      throw new StorageLimitError(used, limit, next);
    }
  }

  async getAssetLimit(userId: string): Promise<number | null> {
    const planCode = await this.getEffectivePlanCode(userId);
    return PLAN_DEFINITIONS[planCode].assetLimit ?? null;
  }

  async assertCanProtectAsset(userId: string): Promise<void> {
    if (!this.isEnforcementEnabled()) return;

    const limit = await this.getAssetLimit(userId);
    if (limit == null) return;

    const count = await assetQuotaService.getProtectedAssetCount(userId);
    if (count >= limit) {
      const planCode = await this.getEffectivePlanCode(userId);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { accountType: true },
      });
      const accountType = (user?.accountType ?? AccountType.INDIVIDUAL) as typeof AccountType.INDIVIDUAL | typeof AccountType.BUSINESS;
      const next = accountType === AccountType.BUSINESS ? PlanCode.ENTERPRISE : PlanCode.PRO;
      throw new AssetQuotaExceededError(count, limit, planCode, next);
    }
  }

  async getAccountType(userId: string): Promise<'INDIVIDUAL' | 'BUSINESS'> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true },
    });
    const t = user?.accountType ?? 'INDIVIDUAL';
    return t === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
  }

  /** Alias used by organization services. */
  async getEntitlements(userId: string): Promise<UserSubscriptionView> {
    return this.getSubscriptionView(userId);
  }

  async getSubscriptionView(userId: string): Promise<UserSubscriptionView> {
    const planCode = await this.getEffectivePlanCode(userId);
    const def = PLAN_DEFINITIONS[planCode];
    const features = await this.getFeaturesForUser(userId);
    const storageUsedBytes = await storageUsageService.getUsedBytes(userId);
    const protectedAssetCount = await assetQuotaService.getProtectedAssetCount(userId);
    const accountType = await this.getAccountType(userId);
    const assetLimit = def.assetLimit ?? null;
    const assetsRemaining = assetLimit != null ? Math.max(0, assetLimit - protectedAssetCount) : null;

    const teamMemberLimit = accountType === AccountType.BUSINESS
      ? (def.teamMemberLimit ?? null)
      : null;
    const workspaceLimit = accountType === AccountType.BUSINESS
      ? (def.workspaceLimit ?? null)
      : null;
    // Real team count from organization_members
    let teamMemberCount = 0;
    if (accountType === AccountType.BUSINESS) {
      const org = await prisma.organization.findUnique({
        where: { ownerUserId: userId },
        select: { id: true },
      });
      if (org) {
        teamMemberCount = await prisma.organizationMember.count({
          where: { organizationId: org.id },
        });
      } else {
        teamMemberCount = 1;
      }
    }

    const sub = await prisma.subscription.findUnique({
      where: { userId },
      select: { status: true },
    });

    return {
      planCode,
      planName: def.name,
      status: sub?.status ?? 'ACTIVE',
      features,
      storageUsedBytes,
      storageLimitBytes: def.storageLimitBytes,
      enforcementEnabled: this.isEnforcementEnabled(),
      accountType,
      protectedAssetCount,
      assetLimit,
      assetsRemaining,
      teamMemberLimit,
      teamMemberCount,
      workspaceLimit,
    };
  }
}

export class SubscriptionRequiredError extends AppError {
  constructor(
    public readonly requiredPlan: PlanCode,
    public readonly feature: FeatureKey,
  ) {
    super(403, 'Subscription Required');
    this.name = 'SubscriptionRequiredError';
  }
}

export class StorageLimitError extends AppError {
  constructor(
    public readonly usedBytes: number,
    public readonly limitBytes: number,
    public readonly requiredPlan: PlanCode,
  ) {
    super(403, 'Vault storage limit reached for your plan');
    this.name = 'StorageLimitError';
  }
}

export class AssetQuotaExceededError extends AppError {
  constructor(
    public readonly usedAssets: number,
    public readonly assetLimit: number,
    public readonly planCode: PlanCode,
    public readonly requiredPlan: PlanCode,
  ) {
    super(403, 'Protected asset limit reached. Upgrade for unlimited assets.');
    this.name = 'AssetQuotaExceededError';
  }
}

export const entitlementService = new EntitlementService();
