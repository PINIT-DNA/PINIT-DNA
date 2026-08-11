import React from 'react';

export default function SiteFooter({ onNavigate, onOpenAuth }) {
  const go = (page) => onNavigate?.(page);

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <strong>Pinit Exchange</strong>
          <p>
            Verified creative marketplace. Assets are protected by Pinit HUB —
            vault, provenance, and monitoring stay behind the scenes until you need them.
          </p>
        </div>

        <div className="site-footer__cols">
          <div>
            <h4>Product</h4>
            <button type="button" onClick={() => go('marketplace')}>Marketplace</button>
            <button type="button" onClick={() => go('collections')}>Collections</button>
            <button type="button" onClick={() => go('requirements')}>Requirements</button>
            <button type="button" onClick={() => go('passports')}>Creator Program</button>
          </div>
          <div>
            <h4>Trust</h4>
            <button type="button" onClick={() => go('trust')}>Trust Center</button>
            <button type="button" onClick={() => go('knowledge')}>Licensing guide</button>
            <button type="button" onClick={() => go('trust')}>Provenance</button>
            <button type="button" onClick={() => go('trust')}>Security</button>
          </div>
          <div>
            <h4>Business</h4>
            <button type="button" onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}>Sell on Pinit</button>
            <button type="button" onClick={() => go('enterprise')}>Enterprise</button>
            <button type="button" onClick={() => go('knowledge')}>Creator support</button>
          </div>
          <div>
            <h4>Legal</h4>
            <span className="site-footer__muted">Terms</span>
            <span className="site-footer__muted">Privacy</span>
            <span className="site-footer__muted">License Agreement</span>
            <span className="site-footer__muted">Refund Policy</span>
          </div>
        </div>
      </div>
      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} Pinit Exchange</span>
        <span className="site-footer__pill">HUB protects · Exchange monetizes</span>
      </div>
    </footer>
  );
}
