/**
 * Temporary plan definitions — single source of truth for limits & features.
 * DB Plan rows are seeded from these; do not hardcode elsewhere.
 */

import { FeatureKey } from './features';
import { planLimits } from './plan-limits';

export const PlanCode = {
  FREE: 'FREE',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;

export type PlanCode = (typeof PlanCode)[keyof typeof PlanCode];

const GB = 1024 * 1024 * 1024;

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  description: string;
  /** null = unlimited */
  storageLimitBytes: number | null;
  /** null = unlimited protected assets */
  assetLimit: number | null;
  /** null = unlimited team members (Business accounts) */
  teamMemberLimit: number | null;
  /** null = unlimited workspaces (Business accounts) */
  workspaceLimit: number | null;
  features: FeatureKey[];
  sortOrder: number;
  seedId: string;
  /** Display price (INR). 0 = free */
  priceInr: number;
  /** Razorpay amount in paise (INR * 100) */
  pricePaise: number;
  /** Billing interval label */
  intervalLabel: string;
  /** Days of access after successful payment (one-time checkout) */
  periodDays: number;
}

const PRO_FEATURES: FeatureKey[] = [
  FeatureKey.FEATURE_DNA,
  FeatureKey.FEATURE_VAULT,
  FeatureKey.FEATURE_CERTIFICATES,
  FeatureKey.FEATURE_DASHBOARD,
  FeatureKey.FEATURE_PROFILE,
  FeatureKey.FEATURE_INVESTIGATION,
  FeatureKey.FEATURE_TRACKING,
  FeatureKey.FEATURE_SMART_SHARE,
  FeatureKey.FEATURE_ADVANCED_REPORTS,
];

/** Free tier: full product access, usage-limited by asset count. */
const FREE_FEATURES: FeatureKey[] = [...PRO_FEATURES];

const ENTERPRISE_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
  FeatureKey.FEATURE_CHROME_EXTENSION,
  FeatureKey.FEATURE_MARKETPLACE,
  FeatureKey.FEATURE_ASSET_LICENSING,
  FeatureKey.FEATURE_SELLING_ASSETS,
  FeatureKey.FEATURE_ENTERPRISE_TEAMS,
  FeatureKey.FEATURE_API_ACCESS,
  FeatureKey.FEATURE_BULK_UPLOAD,
  FeatureKey.FEATURE_AI_MONITORING,
];

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  FREE: {
    code: PlanCode.FREE,
    name: 'Free',
    description: 'Full platform access — usage-limited protected assets',
    storageLimitBytes: 2 * GB,
    assetLimit: planLimits.freeAssetLimit,
    teamMemberLimit: planLimits.businessFreeTeamLimit,
    workspaceLimit: planLimits.businessFreeWorkspaceLimit,
    features: FREE_FEATURES,
    sortOrder: 0,
    seedId: 'plan_free',
    priceInr: 0,
    pricePaise: 0,
    intervalLabel: 'Forever',
    periodDays: 0,
  },
  PRO: {
    code: PlanCode.PRO,
    name: 'Pro',
    description: 'Unlimited protected assets + 100 GB storage',
    storageLimitBytes: 100 * GB,
    assetLimit: null,
    teamMemberLimit: null,
    workspaceLimit: null,
    features: PRO_FEATURES,
    sortOrder: 1,
    seedId: 'plan_pro',
    priceInr: 999,
    pricePaise: 99900,
    intervalLabel: 'per month',
    periodDays: 30,
  },
  ENTERPRISE: {
    code: PlanCode.ENTERPRISE,
    name: 'Enterprise',
    description: 'Unlimited storage, teams, and organization features',
    storageLimitBytes: null,
    assetLimit: null,
    teamMemberLimit: null,
    workspaceLimit: null,
    features: ENTERPRISE_FEATURES,
    sortOrder: 2,
    seedId: 'plan_enterprise',
    priceInr: 4999,
    pricePaise: 499900,
    intervalLabel: 'per month',
    periodDays: 30,
  },
};

/** Minimum plan that unlocks a given premium feature (for 403 requiredPlan). */
export function requiredPlanForFeature(feature: FeatureKey): PlanCode {
  if (PLAN_DEFINITIONS.PRO.features.includes(feature)) return PlanCode.PRO;
  if (PLAN_DEFINITIONS.ENTERPRISE.features.includes(feature)) return PlanCode.ENTERPRISE;
  return PlanCode.PRO;
}
