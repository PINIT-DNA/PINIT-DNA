import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { HUB_APP_URL } from '../lib/exchange-routes.js';

const COLUMNS = [
  {
    id: 'product',
    title: 'Product',
    links: [
      { label: 'Discover', page: 'marketplace' },
      { label: 'Collections', page: 'collections' },
      { label: 'Creators', page: 'passports' },
    ],
  },
  {
    id: 'trust',
    title: 'Trust',
    links: [
      { label: 'Trust Center', page: 'trust' },
      { label: 'Security', page: 'security' },
      { label: 'Provenance', page: 'provenance' },
    ],
  },
  {
    id: 'business',
    title: 'Business',
    links: [
      { label: 'Sell on Exchange', page: 'sell' },
      { label: 'Creator Program', page: 'creator_program' },
      { label: 'Enterprise', page: 'enterprise' },
      { label: 'Creator Support', page: 'creator_support' },
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

export default function SiteFooter({ onNavigate }) {
  const [open, setOpen] = useState(null);
  const go = (page) => onNavigate?.(page);

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
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} Pinit Exchange</span>
        <span className="site-footer__pill">Pinit HUB protects · Exchange monetizes</span>
        <span className="site-footer__tagline">From Creation to Commerce. From Files to Value.</span>
      </div>
    </footer>
  );
}
