const SELLER_PAGES = new Set([
  'creator_studio',
  'creator_desk',
  'seller_overview',
  'seller_listings',
  'seller_portfolio',
  'seller_assets',
  'seller_sales',
  'seller_orders',
  'seller_earnings',
  'seller_reviews',
  'seller_analytics',
  'seller_promotions',
  'seller_alerts',
  'seller_opportunities',
]);

export function isSellerAccountPage(page) {
  return SELLER_PAGES.has(page);
}

export default function SellerAccountNav() {
  return null;
}
