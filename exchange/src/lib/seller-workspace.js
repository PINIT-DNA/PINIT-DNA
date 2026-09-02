/** Seller Exchange IA: one primary area, contextual sub-nav only. */

export const SELL_PRIMARY = [
  ['seller_overview', 'Overview'],
  ['seller_assets', 'Assets'],
  ['seller_listings', 'Listings'],
  ['seller_opportunities', 'Opportunities'],
  ['seller_sales', 'Sales'],
  ['seller_earnings', 'Earnings'],
];

export const SALES_SECTIONS = [
  ['overview', 'Overview'],
  ['orders', 'Orders'],
  ['payments', 'Payments'],
  ['buyers', 'Buyers'],
  ['licenses', 'Licenses'],
  ['reviews', 'Reviews'],
  ['wishlists', 'Wishlists'],
  ['shares', 'Share Links'],
  ['tracking', 'Tracking'],
  ['invoices', 'Invoices'],
  ['transfers', 'Transfers'],
];

export const EARNINGS_SECTIONS = [
  ['overview', 'Overview'],
  ['revenue', 'Revenue'],
  ['pending', 'Pending'],
  ['available', 'Available'],
  ['payouts', 'Payouts'],
  ['fees', 'Fees'],
  ['statements', 'Statements'],
];

export const ASSET_SECTIONS = [
  ['all', 'All'],
  ['protected', 'Protected'],
  ['sale', 'Available for sale'],
  ['license', 'Available for license'],
  ['listed', 'Active'],
  ['unlisted', 'Inactive'],
  ['portfolios', 'Portfolios'],
  ['activity', 'Activity'],
];

export const LISTING_SECTIONS = [
  ['all', 'All'],
  ['listed', 'Published'],
  ['unlisted', 'Drafts / unlisted'],
  ['views', 'Views'],
  ['interest', 'Interest'],
  ['activity', 'Activity'],
];

export const OPPORTUNITY_SECTIONS = [
  ['discover', 'Discover'],
  ['requests', 'Buyer requests'],
  ['proposals', 'Proposals'],
  ['submitted', 'Submitted'],
];

const SALES_PAGES = new Set([
  'seller_sales',
  'seller_orders',
  'seller_reviews',
]);

export function sellPrimaryPage(page) {
  if (SALES_PAGES.has(page) || page === 'seller_asset_activity') return page === 'seller_asset_activity' ? 'seller_listings' : 'seller_sales';
  if (page === 'seller_portfolio') return 'seller_assets';
  if (page === 'seller_analytics' || page === 'seller_promotions' || page === 'seller_alerts') return 'seller_sales';
  if (SELL_PRIMARY.some(([id]) => id === page)) return page;
  if (page === 'creator_desk') return 'seller_listings';
  if (page === 'creator_studio') return 'seller_overview';
  return null;
}

export function isSalesWorkspacePage(page) {
  return SALES_PAGES.has(page);
}

export function initialSalesSection(page) {
  if (page === 'seller_orders') return 'orders';
  if (page === 'seller_reviews') return 'reviews';
  if (page === 'seller_analytics') return 'tracking';
  return 'overview';
}

export function listingTitleMap(listings) {
  const map = new Map();
  for (const row of listings || []) {
    if (row.listing_id) map.set(row.listing_id, row.title || row.listing_id);
  }
  return map;
}

export function groupBuyers(sales) {
  const map = new Map();
  for (const row of sales || []) {
    const id = row.buyer_pinit_id || 'unknown';
    const cur = map.get(id) || {
      buyer_pinit_id: id,
      purchases: 0,
      total: 0,
      currency: row.currency,
      last: row.sealed_at,
      licenses: 0,
      rows: [],
    };
    cur.purchases += 1;
    cur.total += Number(row.price_paid || 0);
    cur.licenses += 1;
    if (row.sealed_at && (!cur.last || row.sealed_at > cur.last)) cur.last = row.sealed_at;
    cur.rows.push(row);
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function paymentLabel(row) {
  const pay = String(row.payment_status || row.status || '').toLowerCase();
  if (pay.includes('fail')) return 'failed';
  if (pay.includes('refund')) return 'refunded';
  if (pay.includes('pend')) return 'pending';
  if (pay.includes('process')) return 'processing';
  return 'completed';
}
