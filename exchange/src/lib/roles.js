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
  if (a.canList && a.canPurchase) return 'Buyer & Creator';
  if (a.accountType === 'CREATOR' || a.sellerIntent) return 'Creator';
  if (a.accountType === 'BUYER' || a.canPurchase) return 'Buyer';
  return 'Guest';
}

export function rolePositioning(user) {
  const a = resolveExchangeAccount(user);
  if (a.canList && a.canPurchase) {
    return 'Buy licenses and sell Hub-protected work from the same Pinit identity.';
  }
  if (a.needsBuyerEnable) {
    return 'Selling is on. Create a Buyer account on this same identity to purchase other creators’ work.';
  }
  if (a.role === 'BUYER') return 'Discover, license and manage creative assets.';
  return 'Where protected creative assets are discovered, licensed and sold.';
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
  if (SELLER_ONLY_PAGES.has(page)) return resolveExchangeAccount(user).canList;
  if (BUYER_ONLY_PAGES.has(page)) {
    return !user || resolveExchangeAccount(user).canPurchase;
  }
  return true;
}
