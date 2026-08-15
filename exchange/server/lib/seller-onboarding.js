/**
 * Seller onboarding + payment-method verification (Razorpay token refs only).
 * Existing sellers are grandfathered to SELLER_ACTIVE — never downgraded.
 */

export const ONBOARDING = {
  SELLER_ACTIVE: 'SELLER_ACTIVE',
  PAYMENT_METHOD_REQUIRED: 'PAYMENT_METHOD_REQUIRED',
  PAYMENT_METHOD_PENDING: 'PAYMENT_METHOD_PENDING',
  PAYMENT_METHOD_FAILED: 'PAYMENT_METHOD_FAILED',
  PAYMENT_METHOD_VERIFIED: 'PAYMENT_METHOD_VERIFIED',
  HUB_AUTHENTICATED: 'HUB_AUTHENTICATED',
  SELLER_RESTRICTED: 'SELLER_RESTRICTED',
};

const ACTIVE_STATUSES = new Set([
  ONBOARDING.SELLER_ACTIVE,
  ONBOARDING.PAYMENT_METHOD_VERIFIED,
]);

export function normalizeOnboardingStatus(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return ONBOARDING.SELLER_ACTIVE;
  if (Object.values(ONBOARDING).includes(s)) return s;
  return ONBOARDING.SELLER_ACTIVE;
}

/** Grandfathered sellers and verified sellers may list/sell. */
export function isSellerOnboardingComplete(user) {
  if (!user) return false;
  return ACTIVE_STATUSES.has(normalizeOnboardingStatus(user.seller_onboarding_status));
}

export function sellerOnboardingBlocked(user) {
  if (!user) {
    return {
      error: 'AUTH_REQUIRED',
      message: 'Sign in as a Creator to use seller tools.',
    };
  }
  if (isSellerOnboardingComplete(user)) return null;
  const status = normalizeOnboardingStatus(user.seller_onboarding_status);
  return {
    error: 'PAYMENT_VERIFICATION_REQUIRED',
    message: 'Pay the $25 seller subscription to activate your seller account.',
    seller_onboarding_status: status,
    next_step: {
      action: 'verify_payment_method',
      path: '/exchange/seller/onboarding/payment',
    },
  };
}

export function onboardingFieldsForUser(user) {
  const status = normalizeOnboardingStatus(user?.seller_onboarding_status);
  return {
    seller_onboarding_status: status,
    seller_onboarding_complete: ACTIVE_STATUSES.has(status),
    seller_payment_verified: ACTIVE_STATUSES.has(status),
  };
}

/** Status for brand-new creator accounts (buyer → seller or Hub SSO creator intent). */
export function initialCreatorOnboardingStatus(existingUser) {
  if (existingUser && isSellerOnboardingComplete(existingUser)) {
    return normalizeOnboardingStatus(existingUser.seller_onboarding_status);
  }
  return ONBOARDING.PAYMENT_METHOD_REQUIRED;
}
