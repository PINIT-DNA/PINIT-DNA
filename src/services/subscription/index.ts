/**
 * PINITHub Subscription module — public exports.
 */

export { FeatureKey } from './constants/features';
export { PlanCode, PLAN_DEFINITIONS, requiredPlanForFeature } from './constants/plans';
export { planLimits } from './constants/plan-limits';
export { entitlementService, SubscriptionRequiredError, StorageLimitError, AssetQuotaExceededError } from './entitlements/entitlement.service';
export { subscriptionService } from './subscription.service';
export { storageUsageService } from './usage/storage-usage.service';
export { requireFeature } from './guards/require-feature.middleware';
export { razorpayBillingService, isRazorpayConfigured } from './billing/razorpay.service';
export { mockBillingService } from './billing/mock-billing.service';
export type { EntitlementResult, UserSubscriptionView, BillingProviderAdapter } from './types';
