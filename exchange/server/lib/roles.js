/**
 * Exchange marketplace roles. Hub identity is independent.
 * DB stores seller as `creator` (legacy); public API exposes exchange_role.
 */

export const EXCHANGE_ROLES = {
  BUYER: 'buyer',
  SELLER: 'seller',
  ADMIN: 'admin',
};

export function normalizeRole(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r === 'admin') return EXCHANGE_ROLES.ADMIN;
  if (r === 'creator' || r === 'seller') return EXCHANGE_ROLES.SELLER;
  return EXCHANGE_ROLES.BUYER;
}

export function isAdminRole(role) {
  return normalizeRole(role) === EXCHANGE_ROLES.ADMIN;
}

export function isSellerRole(role) {
  const n = normalizeRole(role);
  return n === EXCHANGE_ROLES.SELLER || n === EXCHANGE_ROLES.ADMIN;
}

export function isBuyerRole(role) {
  const n = normalizeRole(role);
  return n === EXCHANGE_ROLES.BUYER || n === EXCHANGE_ROLES.ADMIN;
}

export function isBuyerCapabilityEnabled(row) {
  if (!row) return false;
  // Phase 1: one Pinit identity always buys. Selling is gated by the ₹2,500
  // subscription, not by a second account.
  return true;
}

export function canList(role) {
  return isSellerRole(role);
}

/** Role-only helper for tests. Creators need buyer_enabled on the user row. */
export function canPurchase(role) {
  const n = normalizeRole(role);
  return n === EXCHANGE_ROLES.BUYER || n === EXCHANGE_ROLES.ADMIN;
}

export function buyerNeedsEnable(_row) {
  return false;
}

export function enableBuyerDenied() {
  return {
    error: 'ENABLE_BUYER_REQUIRED',
    message: 'Enable Buyer on this same Pinit identity to check out. Selling is unchanged.',
    next_step: { action: 'enable_buyer', path: '/exchange/account' },
  };
}

export function buyerDeniedList() {
  return {
    error: 'BUYER_CANNOT_LIST',
    message: 'Pay the seller subscription to list assets on Pinit Exchange. Buying still works on this account.',
  };
}

export function sellerDeniedPurchase() {
  return {
    error: 'SELLER_CANNOT_PURCHASE',
    message: 'This account cannot complete this purchase.',
  };
}

export function sellerDeniedBuyerAction() {
  return {
    error: 'SELLER_CANNOT_BUY',
    message: 'Sign in to purchase or post a buyer brief. Selling on this account does not block buying.',
  };
}

export function buyerDeniedSellerAction() {
  return {
    error: 'BUYER_CANNOT_SELL',
    message: 'Buyer accounts cannot access seller tools. Choose Sell on Exchange to add selling to this same identity.',
  };
}

export function rolePositioning(role) {
  const n = normalizeRole(role);
  if (n === EXCHANGE_ROLES.SELLER) {
    return 'Buy licenses and sell Hub-protected work from the same Pinit identity.';
  }
  if (n === EXCHANGE_ROLES.ADMIN) {
    return 'Platform administration for Pinit Exchange.';
  }
  return 'Discover, license and manage creative assets. Add selling when you are ready.';
}

import { onboardingFieldsForUser } from './seller-onboarding.js';

export function enrichPublicUser(row) {
  if (!row) return null;
  const { password_hash: _pw, ...safe } = row;
  const exchange_role = normalizeRole(row.role);
  const sellerIntent = exchange_role === EXCHANGE_ROLES.SELLER || exchange_role === EXCHANGE_ROLES.ADMIN;
  const onboarding = onboardingFieldsForUser(row);
  const can_list = canList(row.role) && onboarding.seller_onboarding_complete;
  const can_purchase = isBuyerCapabilityEnabled(row);
  return {
    ...safe,
    exchange_role,
    account_type: sellerIntent && can_purchase ? 'CREATOR_AND_BUYER' : (sellerIntent ? 'CREATOR' : 'BUYER'),
    exchange_enabled: true,
    can_list,
    can_purchase,
    buyer_enabled: can_purchase ? 1 : 0,
    needs_buyer_enable: false,
    capabilities: {
      buy: can_purchase,
      sell: can_list,
      seller_intent: sellerIntent,
    },
    positioning: rolePositioning(row.role),
    ...onboarding,
  };
}
