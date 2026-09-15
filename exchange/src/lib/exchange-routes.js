/**
 * Exchange uses in-app page keys. These paths make footer links real,
 * refreshable URLs without introducing a second router.
 */

const LIVE_HUB_APP_URL = 'https://www.pinithub.com';
const LIVE_HUB_FALLBACK = 'https://pinit-dna.vercel.app';

/** Never treat these as Hub — they are Exchange / dead aliases. */
function isInvalidHubUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u) return true;
  return (
    u.includes('dna-pinit-web.vercel.app')
    || u.includes('pinitexchange.com')
    || u.includes('pinit-dna-exchange')
    || u.includes('pinit-dna-nu.vercel.app')
    || u.includes('pinit-dna-3fmw')
    || u.includes('localhost:5174')
    || u.includes('localhost:5173')
    || u.includes('localhost:3000')
  );
}

/**
 * Resolve the live Hub app URL for SSO.
 * Local: localhost:3002 (must match Hub Vite port). Production: pinithub.com.
 */
export function resolveHubAppUrl() {
  const raw = String(import.meta.env.VITE_HUB_APP_URL || '').trim().replace(/\/$/, '');
  if (raw && !isInvalidHubUrl(raw)) return raw;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    if (
      host.includes('pinitexchange.com')
      || host.includes('pinit-dna-exchange')
      || host.includes('pinit-dna-nu')
      || host.endsWith('.vercel.app')
    ) {
      return LIVE_HUB_APP_URL;
    }
    // Local dev — Hub must run on 3002 (see client/vite.config.ts strictPort).
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3002';
    }
  }

  return 'http://localhost:3002';
}

/** Absolute Hub login URL for Exchange SSO. */
export function hubLoginUrl(returnUrl, { mode = 'login' } = {}) {
  const hub = resolveHubAppUrl() || LIVE_HUB_FALLBACK;
  const base = isInvalidHubUrl(hub) ? LIVE_HUB_APP_URL : hub;
  const url = new URL(`${base}/login`);
  if (returnUrl) url.searchParams.set('exchange_return', returnUrl);
  if (mode) url.searchParams.set('hub_mode', mode);
  return url.toString();
}

/** Absolute Hub register URL for Exchange SSO. */
export function hubRegisterUrl(returnUrl, accountHint = null) {
  const hub = resolveHubAppUrl() || LIVE_HUB_FALLBACK;
  const base = isInvalidHubUrl(hub) ? LIVE_HUB_APP_URL : hub;
  const url = new URL(`${base}/register/account-type`);
  if (returnUrl) url.searchParams.set('exchange_return', returnUrl);
  if (accountHint) url.searchParams.set('hint', accountHint);
  return url.toString();
}

export const HUB_APP_URL = resolveHubAppUrl();

export const ROUTES = {
  home: { path: '/exchange/buyer', title: 'Pinit Exchange | Discover', description: 'Discover and license Hub-protected creative assets on Pinit Exchange.' },
  marketplace: { path: '/exchange/discover', title: 'Pinit Exchange | Marketplace', description: 'Discover verified creative assets ready to license on Pinit Exchange.' },
  collections: { path: '/exchange/collections', title: 'Pinit Exchange | Collections', description: 'Browse curated collections of Hub-protected creative assets.' },
  collectors: { path: '/exchange/collectors', title: 'Pinit Exchange | Collectors', description: 'See collectors licensing and saving Hub-protected work on Pinit Exchange.' },
  requirements: { path: '/exchange/requirements', title: 'Pinit Exchange | Requirements', description: 'Post a brief. Creators submit Hub-protected work. License on Exchange.' },
  passports: { path: '/exchange/creators', title: 'Pinit Exchange | Creators', description: 'Meet verified creators on Pinit Exchange.' },
  creator_program: { path: '/creator-program', title: 'Pinit Exchange | Creator Program', description: 'How creators join Pinit Exchange, protect work in Hub, list and earn.' },
  trust: { path: '/trust', title: 'Pinit Exchange | Trust Center', description: 'Trust is built into every asset — protection, provenance and verification.' },
  licensing_guide: { path: '/licensing-guide', title: 'Pinit Exchange | Licensing Guide', description: 'Plain-language guide to personal, commercial and exclusive licenses.' },
  provenance: { path: '/provenance', title: 'Pinit Exchange | Provenance', description: 'How Asset DNA, Hub protection and Exchange licenses form an audit trail.' },
  security: { path: '/security', title: 'Pinit Exchange | Security', description: 'How Pinit Exchange and Pinit HUB approach security, access and privacy.' },
  sell: { path: '/sell', title: 'Pinit Exchange | Sell on Pinit', description: 'Turn creative work into revenue. Protect in Hub, list and license on Exchange.' },
  enterprise: { path: '/enterprise', title: 'Pinit Exchange | Enterprise', description: 'Creative asset commerce for teams, agencies and studios.' },
  creator_support: { path: '/creator-support', title: 'Pinit Exchange | Creator Support', description: 'Help with accounts, listings, licensing, payments and Hub protection.' },
  terms: { path: '/terms', title: 'Pinit Exchange | Terms', description: 'Terms of use for the Pinit Exchange marketplace.' },
  privacy: { path: '/privacy', title: 'Pinit Exchange | Privacy', description: 'How Pinit Exchange handles account and marketplace information.' },
  license_agreement: { path: '/license-agreement', title: 'Pinit Exchange | License Agreement', description: 'What a Pinit Exchange license grants — and what it does not transfer.' },
  refund_policy: { path: '/refund-policy', title: 'Pinit Exchange | Refund Policy', description: 'When refunds may apply and how to request support.' },
  knowledge: { path: '/knowledge', title: 'Pinit Exchange | Knowledge Guide', description: 'Help and knowledge guide for Pinit Exchange.' },
  listing_detail: { path: '/exchange/discover', title: 'Pinit Exchange | Asset', description: 'Verified listing on Pinit Exchange.' },
  cart: { path: '/exchange/buyer/cart', title: 'Pinit Exchange | Cart', description: 'Your Pinit Exchange cart.' },
  wishlist: { path: '/exchange/buyer/wishlist', title: 'Pinit Exchange | Wishlist', description: 'Saved assets on Pinit Exchange.' },
  my_licenses: { path: '/exchange/buyer/purchases', title: 'Pinit Exchange | My Purchases', description: 'Licenses you have purchased on Pinit Exchange.' },
  buyer_payments: { path: '/exchange/buyer/payment-methods', title: 'Pinit Exchange | Payment methods', description: 'Saved payment methods for Pinit Exchange.' },
  creator_desk: { path: '/exchange/seller/listings', title: 'Pinit Exchange | Your listings', description: 'Manage your listings on Pinit Exchange.' },
  creator_studio: { path: '/exchange/seller', title: 'Pinit Exchange | Seller overview', description: 'Your selling workspace on Pinit Exchange.' },
  seller_overview: { path: '/exchange/seller', title: 'Pinit Exchange | Overview', description: 'Seller overview on Pinit Exchange.' },
  seller_assets: { path: '/exchange/seller/assets', title: 'Pinit Exchange | My Assets', description: 'Your protected assets on Pinit Exchange.' },
  seller_portfolio: { path: '/exchange/seller/portfolio', title: 'Pinit Exchange | Portfolio', description: 'Your published creative portfolio on Pinit Exchange.' },
  seller_listings: { path: '/exchange/seller/listings', title: 'Pinit Exchange | Listings', description: 'Manage published listings on Pinit Exchange.' },
  seller_asset_activity: { path: '/exchange/seller/asset-activity', title: 'Pinit Exchange | Asset activity', description: 'Full commercial activity for one protected asset.' },
  seller_sales: { path: '/exchange/seller/sales', title: 'Pinit Exchange | Sales', description: 'Sealed sales on Pinit Exchange.' },
  seller_orders: { path: '/exchange/seller/orders', title: 'Pinit Exchange | Orders', description: 'Seller orders on Pinit Exchange.' },
  seller_earnings: { path: '/exchange/seller/earnings', title: 'Pinit Exchange | Earnings', description: 'Creator earnings and payouts.' },
  seller_reviews: { path: '/exchange/seller/reviews', title: 'Pinit Exchange | Reviews', description: 'Reviews of your listings.' },
  seller_analytics: { path: '/exchange/seller/analytics', title: 'Pinit Exchange | Analytics', description: 'Creator performance analytics.' },
  seller_promotions: { path: '/exchange/seller/promotions', title: 'Pinit Exchange | Promotions', description: 'Coupons and promotions.' },
  seller_alerts: { path: '/exchange/seller/alerts', title: 'Pinit Exchange | Hub Alerts', description: 'Protection alerts from Pinit HUB.' },
  seller_opportunities: { path: '/exchange/seller/opportunities', title: 'Pinit Exchange | Opportunities', description: 'Buyer briefs you can submit Hub-protected work to.' },
  seller_onboarding_payment: {
    path: '/exchange/seller/onboarding/payment',
    title: 'Pinit Exchange | Seller verification',
    description: 'Verify a payment method to activate your free seller account.',
  },
  buyer_notifications: { path: '/exchange/buyer/notifications', title: 'Pinit Exchange | Notifications', description: 'Buyer account notifications on Pinit Exchange.' },
  settings: { path: '/exchange/account', title: 'Pinit Exchange | Settings', description: 'Account settings on Pinit Exchange.' },
  public_portfolio: { path: '/p', title: 'Pinit Exchange | Portfolio', description: 'Public creator portfolio on Pinit Exchange.' },
  not_found: { path: '/404', title: 'Pinit Exchange | Page not found', description: 'This Exchange page could not be found.' },
};

const ALIASES = {
  '/': 'marketplace',
  '/marketplace': 'marketplace',
  '/collections': 'collections',
  '/collectors': 'collectors',
  '/creators': 'passports',
  '/requirements': 'requirements',
  '/cart': 'cart',
  '/wishlist': 'wishlist',
  '/licenses': 'my_licenses',
  '/settings': 'settings',
  '/studio': 'creator_studio',
  '/my-listings': 'seller_listings',
  '/exchange': 'marketplace',
  '/exchange/buyer': 'home',
  '/exchange/seller': 'seller_overview',
  '/exchange/seller/opportunities': 'seller_opportunities',
  '/exchange/seller/onboarding/payment': 'seller_onboarding_payment',
  '/exchange/checkout/return': 'my_licenses',
  '/exchange/buyer/payment-methods': 'buyer_payments',
  '/exchange/collections': 'collections',
  '/exchange/collectors': 'collectors',
  '/exchange/requirements': 'requirements',
  '/exchange/creators': 'passports',
  '/exchange/creator-program': 'creator_program',
  '/exchange/trust': 'trust',
  '/exchange/licensing-guide': 'licensing_guide',
  '/exchange/provenance': 'provenance',
  '/exchange/security': 'security',
  '/exchange/sell': 'sell',
  '/exchange/enterprise': 'enterprise',
  '/exchange/creator-support': 'creator_support',
  '/exchange/terms': 'terms',
  '/exchange/privacy': 'privacy',
  '/exchange/license-agreement': 'license_agreement',
  '/exchange/refund-policy': 'refund_policy',
};

export function normalizePathname(pathname) {
  let p = String(pathname || '/').split('?')[0];
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (!p) p = '/';
  if (p.startsWith('/exchange/') || p === '/exchange') return p;
  return p;
}

export function parsePublicPortfolioPath(pathname) {
  const m = normalizePathname(pathname).match(/^\/p\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/i);
  if (!m) return null;
  return {
    slug: decodeURIComponent(m[1]).toLowerCase(),
    section: (m[2] || '').toLowerCase(),
    piece: m[3] ? decodeURIComponent(m[3]) : '',
  };
}

export function portfolioSlugFromPath(pathname) {
  return parsePublicPortfolioPath(pathname)?.slug || '';
}

export function pageFromPath(pathname) {
  const p = normalizePathname(pathname);
  if (parsePublicPortfolioPath(p)) return 'public_portfolio';
  if (ALIASES[p]) return ALIASES[p];
  const hit = Object.entries(ROUTES).find(([, meta]) => meta.path === p);
  return hit ? hit[0] : 'not_found';
}

export function pathForPage(page, extra = {}) {
  if (page === 'public_portfolio') {
    const slug = extra.slug || extra.portfolioSlug || '';
    if (!slug) return '/p';
    let path = `/p/${encodeURIComponent(slug)}`;
    if (extra.section) path += `/${encodeURIComponent(extra.section)}`;
    if (extra.piece) path += `/${encodeURIComponent(extra.piece)}`;
    return path;
  }
  return ROUTES[page]?.path || '/';
}

export function applyPageMeta(page) {
  const meta = ROUTES[page] || ROUTES.home;
  if (typeof document === 'undefined') return;
  document.title = meta.title;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', meta.description);
}
