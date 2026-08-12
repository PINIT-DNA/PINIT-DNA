/**
 * Exchange uses in-app page keys. These paths make footer links real,
 * refreshable URLs without introducing a second router.
 */

export const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export const ROUTES = {
  home: { path: '/', title: 'Pinit Exchange — Creative License Marketplace', description: 'Verified creative marketplace. Discover, license and sell assets protected by Pinit HUB.' },
  marketplace: { path: '/marketplace', title: 'Pinit Exchange | Marketplace', description: 'Discover verified creative assets ready to license on Pinit Exchange.' },
  collections: { path: '/collections', title: 'Pinit Exchange | Collections', description: 'Browse curated collections of Hub-protected creative assets.' },
  requirements: { path: '/requirements', title: 'Pinit Exchange | Requirements', description: 'Post a brief. Creators submit Hub-protected work. License on Exchange.' },
  passports: { path: '/creators', title: 'Pinit Exchange | Creators', description: 'Meet verified creators on Pinit Exchange.' },
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
  listing_detail: { path: '/marketplace', title: 'Pinit Exchange | Asset', description: 'Verified listing on Pinit Exchange.' },
  cart: { path: '/cart', title: 'Pinit Exchange | Cart', description: 'Your Pinit Exchange cart.' },
  wishlist: { path: '/wishlist', title: 'Pinit Exchange | Wishlist', description: 'Saved assets on Pinit Exchange.' },
  my_licenses: { path: '/licenses', title: 'Pinit Exchange | My licenses', description: 'Licenses you have purchased on Pinit Exchange.' },
  creator_desk: { path: '/my-listings', title: 'Pinit Exchange | My Listings', description: 'Seller overview on Pinit Exchange.' },
  settings: { path: '/settings', title: 'Pinit Exchange | Settings', description: 'Account settings on Pinit Exchange.' },
  not_found: { path: '/404', title: 'Pinit Exchange | Page not found', description: 'This Exchange page could not be found.' },
};

const ALIASES = {
  '/exchange': 'marketplace',
  '/exchange/collections': 'collections',
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

export function pageFromPath(pathname) {
  const p = normalizePathname(pathname);
  if (ALIASES[p]) return ALIASES[p];
  const hit = Object.entries(ROUTES).find(([, meta]) => meta.path === p);
  return hit ? hit[0] : 'not_found';
}

export function pathForPage(page) {
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
