import React from 'react';

const LINKS = [
  ['seller_portfolio', 'Portfolio'],
  ['seller_listings', 'Your listings'],
  ['seller_assets', 'Your assets'],
  ['seller_sales', 'Sales'],
  ['seller_earnings', 'Earnings'],
  ['seller_reviews', 'Reviews'],
  ['seller_analytics', 'Analytics'],
  ['seller_opportunities', 'Opportunities'],
];

const SELLER_PAGES = new Set([
  'creator_studio',
  'creator_desk',
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

export default function SellerAccountNav({ activePage, onNavigate, onOpenListFromHub }) {
  const current = activePage === 'creator_desk' || activePage === 'creator_studio'
    ? 'seller_listings'
    : activePage;

  return (
    <div className="site-subnav">
      <div className="site-subnav__inner">
        <nav className="site-subnav__links" aria-label="Seller account">
          {LINKS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={current === id ? 'is-active' : ''}
              onClick={() => onNavigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button type="button" className="btn-primary site-subnav__cta" onClick={onOpenListFromHub}>
          List an asset
        </button>
      </div>
    </div>
  );
}
