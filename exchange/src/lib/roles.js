/** Frontend Exchange role helpers. Always go through resolveExchangeAccount. */

import { resolveExchangeAccount } from './exchange-account.js';

export { resolveExchangeAccount } from './exchange-account.js';

export function exchangeRole(user) {
  const a = resolveExchangeAccount(user);
  if (!a.role) return null;
  return a.role === 'SELLER' ? 'seller' : 'buyer';
}

export function isSeller(user) {
  const a = resolveExchangeAccount(user);
  return a.sellerIntent || a.role === 'SELLER';
}

export function isBuyer(user) {
  return resolveExchangeAccount(user).canPurchase;
}

export function canList(user) {
  return resolveExchangeAccount(user).canList;
}

export function canPurchase(user) {
  return resolveExchangeAccount(user).canPurchase;
}

export function roleLabel(user) {
  const a = resolveExchangeAccount(user);
  if (!user) return 'Guest';
  return a.displayName || a.pinitId || 'Account';
}

export function rolePositioning(user) {
  const a = resolveExchangeAccount(user);
  if (a.sellerIntent && a.canPurchase) {
    return 'Create, protect, list and sell — and buy other creators’ work on this same identity.';
  }
  if (a.sellerIntent) {
    return 'You are here to create, protect, list and sell. Become a Buyer when you want to license others’ work.';
  }
  return 'You are here to discover and buy creative work. Become a Seller when you are ready to list.';
}

export const HUB_POSITIONING = 'Your private workspace for the assets you own or manage.';
export const EXCHANGE_POSITIONING = 'Where protected creative assets are discovered, licensed and sold.';

export const SELLER_ONLY_PAGES = new Set([
  'creator_studio',
  'creator_desk',
  'seller_assets',
  'seller_portfolio',
  'seller_listings',
  'seller_asset_activity',
  'seller_sales',
  'seller_orders',
  'seller_earnings',
  'seller_reviews',
  'seller_analytics',
  'seller_promotions',
  'seller_alerts',
  'seller_opportunities',
]);

export const BUYER_ONLY_PAGES = new Set([
  'cart',
  'wishlist',
  'my_licenses',
  'buyer_orders',
  'buyer_home',
  'buyer_payments',
  'buyer_notifications',
]);

export const PUBLIC_PAGES = new Set([
  'home',
  'marketplace',
  'collections',
  'passports',
  'requirements',
  'listing_detail',
  'creator_program',
  'trust',
  'licensing_guide',
  'provenance',
  'security',
  'sell',
  'enterprise',
  'creator_support',
  'terms',
  'privacy',
  'license_agreement',
  'refund_policy',
  'knowledge',
  'settings',
  'public_portfolio',
  'not_found',
]);

export function homePageForUser(user) {
  const a = resolveExchangeAccount(user);
  if (a.sellerIntent && !a.canList) return 'seller_onboarding_payment';
  return 'home';
}

export function canAccessPage(user, page) {
  if (page === 'seller_onboarding_payment') {
    return Boolean(user) && resolveExchangeAccount(user).sellerIntent;
  }
  if (SELLER_ONLY_PAGES.has(page)) {
    if (!user) return false;
    const a = resolveExchangeAccount(user);
    if (a.canList) return true;
    if (a.sellerIntent) return false;
    return true;
  }
  if (BUYER_ONLY_PAGES.has(page)) {
    if (!user) return true;
    const a = resolveExchangeAccount(user);
    return a.canPurchase || a.needsBuyerEnable;
  }
  return true;
}
