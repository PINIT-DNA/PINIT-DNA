import type { FeatureKey } from '../constants/features';
import type { PlanCode } from '../constants/plans';

export type { FeatureKey, PlanCode };

export interface EntitlementResult {
  allowed: boolean;
  feature: FeatureKey;
  planCode: PlanCode;
  requiredPlan: PlanCode;
  reason?: string;
}

export interface UserSubscriptionView {
  planCode: PlanCode;
  planName: string;
  status: string;
  features: FeatureKey[];
  storageUsedBytes: number;
  storageLimitBytes: number | null;
  enforcementEnabled: boolean;
  accountType: 'INDIVIDUAL' | 'BUSINESS';
  protectedAssetCount: number;
  assetLimit: number | null;
  assetsRemaining: number | null;
  /** Business accounts: max team members for current plan (null = unlimited). */
  teamMemberLimit: number | null;
  teamMemberCount: number;
  workspaceLimit: number | null;
}

/** Future payment gateway — implement later; do not wire checkout yet. */
export interface BillingProviderAdapter {
  readonly provider: 'STRIPE' | 'RAZORPAY' | 'PAYPAL';
  createCheckoutSession(input: {
    userId: string;
    planCode: PlanCode;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutUrl: string; externalId: string }>;
  handleWebhook(payload: unknown, signature?: string): Promise<void>;
}
