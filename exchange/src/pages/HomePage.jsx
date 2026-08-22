import React, { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import ListingCard from '../components/ListingCard.jsx';
import HubTrustBadge from '../components/HubTrustBadge.jsx';
import { apiFetch, unwrapList } from '../lib/api.js';

const CATEGORIES = [
  { id: 'images', label: 'Photography' },
  { id: 'video', label: 'Video' },
  { id: 'concepts', label: 'Illustration' },
  { id: 'ui_ux', label: 'UI/UX' },
  { id: '3d', label: '3D' },
  { id: 'audio', label: 'Audio' },
  { id: 'graphics', label: 'Graphics' },
];

export default function HomePage({ onNavigate, onOpenAuth, user, onSelectListing }) {
  const [featured, setFeatured] = useState([]);
  const [query, setQuery] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    (async () => {
      // Featured strip needs 8; ask for exactly that rather than the catalogue.
      const { ok, data, headers } = await apiFetch('/api/listings?vertical=all&badge=all&sort=popular&limit=8');
      if (ok) setFeatured(unwrapList(data, headers).items);
    })();
  }, []);

  useEffect(() => {
    if (!user?.pinit_id) return;
    (async () => {
      const key = user.pinit_id;
      const wish = await apiFetch(`/api/commerce/wishlist?buyer_key=${encodeURIComponent(key)}`);
      if (wish.ok) setSavedCount((wish.data.items || []).length);
      // Real cart count. The tile that sat here previously showed the word
      // "Open" regardless of whether the cart had anything in it.
      const cart = await apiFetch(`/api/commerce/cart?buyer_key=${encodeURIComponent(key)}`);
      if (cart.ok) setCartCount(Number(cart.data?.count || 0));
      // Scoped to the signed-in session server-side; no identity in the query.
      const lic = await apiFetch('/api/orders/my-licenses');
      if (lic.ok) setPurchaseCount((lic.data.licenses || []).length);
    })();
  }, [user?.pinit_id, user?.email]);

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 24px 48px' }}>
      {/* Hero — marketplace first */}
      <section className="glass-panel home-hero">
        <div className="home-hero__eyebrow">
          <Sparkles size={14} /> Verified creative marketplace
        </div>
        <h1 className="home-hero__title">
          {user ? `Welcome back, ${(user.display_name || user.name || 'there').split(' ')[0]}` : 'Discover verified creative assets.'}
        </h1>
        <p className="home-hero__sub">
          What are you looking for?
        </p>
        <form
          className="home-search"
          onSubmit={(e) => {
            e.preventDefault();
            onNavigate('marketplace');
          }}
        >
          <input
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets, creators, collections…"
          />
          <button type="submit" className="btn-primary">Search</button>
        </form>
        <div className="home-hero__cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="home-chip"
              onClick={() => onNavigate('marketplace')}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="home-hero__cta">
          <button type="button" className="btn-primary" onClick={() => onNavigate('marketplace')}>
            Explore assets <ArrowRight size={16} />
          </button>
          {!user && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}
          >
            Sell on Exchange
          </button>
          )}
        </div>
      </section>

      {/* Trust strip — Hub invisible until needed */}
      <section className="home-trust-strip">
        <div>
          <strong style={{ color: '#fff' }}>Every asset is protected by Pinit HUB</strong>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 4 }}>
            Vault Protection · Digital DNA · Provenance · Monitoring
          </div>
        </div>
        <HubTrustBadge compact onOpenProvenance={() => onNavigate('trust')} />
      </section>

      {/*
        Only real counts get a figure.

        This block previously rendered six identical KPI cards, four of which
        put a word where the number goes — "Cart: Open", "Requirements: Briefs",
        "Payment methods: Secure", "Notifications: Inbox". A large bold value in
        a stat card reads as a measurement, so those four looked like metrics
        while measuring nothing. Purchases and saves are genuine counts and keep
        their figure; the rest are navigation, and now look like navigation.
      */}
      {user && (
        <section className="buyer-summary" aria-label="Your account">
          <div className="buyer-stats">
            <button type="button" className="ex-card buyer-stat" onClick={() => onNavigate('my_licenses')}>
              <span className="buyer-stat__label">Purchases</span>
              <strong className="buyer-stat__value">{purchaseCount}</strong>
              <em className="buyer-stat__hint">Licensed assets</em>
            </button>
            <button type="button" className="ex-card buyer-stat" onClick={() => onNavigate('wishlist')}>
              <span className="buyer-stat__label">Saved</span>
              <strong className="buyer-stat__value">{savedCount}</strong>
              <em className="buyer-stat__hint">On your wishlist</em>
            </button>
            <button type="button" className="ex-card buyer-stat" onClick={() => onNavigate('cart')}>
              <span className="buyer-stat__label">In cart</span>
              <strong className="buyer-stat__value">{cartCount ?? 0}</strong>
              <em className="buyer-stat__hint">Ready to checkout</em>
            </button>
          </div>

          <nav className="buyer-links" aria-label="Account shortcuts">
            {[
              ['requirements', 'Post a brief'],
              ['buyer_payments', 'Payment methods'],
              ['buyer_notifications', 'Notifications'],
              ['settings', 'Account settings'],
            ].map(([page, label]) => (
              <button key={page} type="button" className="buyer-link" onClick={() => onNavigate(page)}>
                {label} <ArrowRight size={14} />
              </button>
            ))}
          </nav>
        </section>
      )}

      <section style={{ marginBottom: 48 }}>
        <div className="section-head">
          <div>
            <h2>Recommended for you</h2>
            <p>Live listings from the marketplace — license with confidence.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => onNavigate('marketplace')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        {featured.length === 0 ? (
          <div className="glass-panel" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
            No live listings yet. Explore categories or become a creator.
          </div>
        ) : (
          <div className="listing-grid">
            {featured.map((item) => (
              <ListingCard
                key={item.listing_id}
                item={item}
                user={user}
                onSelect={(id) => (onSelectListing ? onSelectListing(id) : onNavigate('marketplace'))}
              />
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 48 }}>
        <div className="section-head">
          <div>
            <h2>Browse by category</h2>
            <p>Find the right vertical for your next license.</p>
          </div>
        </div>
        <div className="home-cat-grid">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" className="home-cat-tile" onClick={() => onNavigate('marketplace')}>
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <section className="glass-panel" style={{ padding: 32, marginBottom: 48 }}>
        <h2 style={{ color: '#fff', marginBottom: 8 }}>Why Pinit?</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20, maxWidth: 640 }}>
          Exchange is the storefront. Pinit HUB is the security infrastructure that protects
          the original, registers provenance, and keeps monitoring after the sale.
        </p>
        <div className="home-why-grid">
          <div>
            <ShieldCheck size={20} color="var(--emerald)" />
            <h3>Buy with trust</h3>
            <p>Every listing carries a Pinit Verified signal backed by HUB protection.</p>
          </div>
          <div>
            <ShieldCheck size={20} color="var(--primary)" />
            <h3>License clearly</h3>
            <p>Personal, Commercial, Exclusive, and Enterprise tiers with sealed records.</p>
          </div>
          <div>
            <ShieldCheck size={20} color="var(--badge-gold)" />
            <h3>Creators stay protected</h3>
            <p>Masters stay in Hub vault. Exchange monetizes licenses — not raw files.</p>
          </div>
        </div>
      </section>

      <section className="glass-panel" style={{ padding: 32 }}>
        <h2 style={{ color: '#fff', marginBottom: 16 }}>How protection works</h2>
        <ol className="home-flow">
          <li><strong>Creator</strong> protects the original in Pinit HUB</li>
          <li><strong>Exchange</strong> lists a license linked by asset ID</li>
          <li><strong>Buyer</strong> purchases and receives licensed delivery</li>
          <li><strong>HUB</strong> continues monitoring and verification</li>
        </ol>
        <button type="button" className="btn-secondary" style={{ marginTop: 16 }} onClick={() => onNavigate('trust')}>
          Open Trust Center
        </button>
      </section>
    </div>
  );
}
