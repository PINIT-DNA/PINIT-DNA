import { isSellerAccountPage } from '../components/SellerAccountNav.jsx';

export const BUY_PAGES = new Set([
  'home',
  'marketplace',
  'collections',
  'collectors',
  'passports',
  'cart',
  'wishlist',
  'my_licenses',
  'buyer_orders',
  'buyer_payments',
  'buyer_notifications',
]);

export function moduleFromPage(page) {
  if (isSellerAccountPage(page) || page === 'seller_onboarding_payment' || page === 'seller_asset_activity') {
    return 'sell';
  }
  if (BUY_PAGES.has(page)) return 'buy';
  return null;
}
