import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { HUB_APP_URL } from '../lib/exchange-routes.js';

const COLUMNS = [
  {
    id: 'product',
    title: 'Product',
    links: [
      { label: 'Marketplace', page: 'marketplace', hint: 'Discover verified assets' },
      { label: 'Collections', page: 'collections', hint: 'Shop by theme' },
      { label: 'Requirements', page: 'requirements', hint: 'Post a creative brief' },
      { label: 'Creator Program', page: 'creator_program', hint: 'Join and list work' },
    ],
  },
  {
    id: 'trust',
    title: 'Trust',
    links: [
      { label: 'Trust Center', page: 'trust', hint: 'How protection works' },
      { label: 'Licensing Guide', page: 'licensing_guide', hint: 'Personal to exclusive' },
      { label: 'Provenance', page: 'provenance', hint: 'Asset DNA and evidence' },
      { label: 'Security', page: 'security', hint: 'Access and privacy' },
    ],
  },
  {
    id: 'business',
    title: 'Business',
    links: [
      { label: 'Sell on Pinit', page: 'sell', hint: 'Protect, list, earn' },
      { label: 'Enterprise', page: 'enterprise', hint: 'Teams and studios' },
      { label: 'Creator Support', page: 'creator_support', hint: 'Help and FAQs' },
    ],
  },
  {
    id: 'legal',
    title: 'Legal',
    links: [
      { label: 'Terms', page: 'terms' },
      { label: 'Privacy', page: 'privacy' },
      { label: 'License Agreement', page: 'license_agreement' },
      { label: 'Refund Policy', page: 'refund_policy' },
    ],
  },
];

export default function SiteFooter({ onNavigate, user = null }) {
  const [open, setOpen] = useState(null);
  const go = (page) => onNavigate?.(page);
  const role = String(user?.exchange_role || user?.role || '').toLowerCase();
  const seller = role === 'creator' || role === 'seller' || role === 'admin';
  const buyer = role === 'buyer' || role === 'admin';

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <strong>Pinit Exchange</strong>
          <p>
            A verified creative marketplace where assets can be discovered, licensed,
            sold and delivered. Pinit HUB provides protection, provenance and monitoring.
          </p>
          <p className="site-footer__eco">
            Pinit HUB protects. Pinit Exchange helps creative work move through the market.
          </p>
          <div className="site-footer__split" aria-label="Pinit ecosystem">
            <div>
              <span>Pinit HUB</span>
              <small>Protection · Intelligence · Collaboration</small>
            </div>
            <div>
              <span>Pinit Exchange</span>
              <small>Discovery · Licensing · Commerce</small>
            </div>
          </div>
          {user && (
            <div className="site-footer__account">
              {buyer && (
                <button type="button" onClick={() => go('my_licenses')}>My Library</button>
              )}
              {seller && (
                <>
                  <button type="button" onClick={() => go('creator_desk')}>My Listings</button>
                  <button type="button" onClick={() => go('creator_desk')}>Creator Dashboard</button>
                </>
              )}
            </div>
          )}
          <a
            className="site-footer__hub"
            href={HUB_APP_URL}
            target="_blank"
            rel="noreferrer"
          >
            Open Pinit HUB <ExternalLink size={12} aria-hidden />
          </a>
        </div>

        <div className="site-footer__cols">
          {COLUMNS.map((col) => (
            <div key={col.id} className={`site-footer__col ${open === col.id ? 'is-open' : ''}`}>
              <button
                type="button"
                className="site-footer__col-toggle"
                aria-expanded={open === col.id}
                onClick={() => setOpen((cur) => (cur === col.id ? null : col.id))}
              >
                {col.title}
              </button>
              <h4 className="site-footer__col-title">{col.title}</h4>
              <div className="site-footer__col-links">
                {col.links.map((link) => (
                  <button
                    key={link.page}
                    type="button"
                    onClick={() => go(link.page)}
                  >
                    {link.label}
                    {link.hint && <em>{link.hint}</em>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} Pinit Exchange</span>
        <span className="site-footer__pill">HUB protects · Exchange monetizes</span>
        <span className="site-footer__tagline">From Creation to Commerce. From Files to Value.</span>
      </div>
    </footer>
  );
}
