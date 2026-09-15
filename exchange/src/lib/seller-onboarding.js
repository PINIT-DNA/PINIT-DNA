/** Seller payment onboarding helpers (frontend). */

export function sellerNeedsPaymentVerification(user, status) {
  if (!user) return false;
  const rawRole = String(user.exchange_role || user.role || '').toLowerCase();
  const isCreator = rawRole === 'creator' || rawRole === 'seller' || rawRole === 'admin';
  if (!isCreator) return false;
  if (status?.requires_payment_method != null) return Boolean(status.requires_payment_method);
  if (user.seller_onboarding_complete != null) return !user.seller_onboarding_complete;
  const s = String(user.seller_onboarding_status || 'SELLER_ACTIVE').toUpperCase();
  return s !== 'SELLER_ACTIVE' && s !== 'PAYMENT_METHOD_VERIFIED';
}

export function sellerOnboardingComplete(user) {
  if (!user) return false;
  if (user.seller_onboarding_complete != null) return Boolean(user.seller_onboarding_complete);
  const s = String(user.seller_onboarding_status || 'SELLER_ACTIVE').toUpperCase();
  return s === 'SELLER_ACTIVE' || s === 'PAYMENT_METHOD_VERIFIED';
}
