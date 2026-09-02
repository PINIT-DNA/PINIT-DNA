import React, { useState, useEffect } from 'react';
import {
  Award, ArrowLeft, Check, Download, Heart, ImageOff, Minus,
  ShieldCheck, ShoppingCart, Star,
} from 'lucide-react';
import { formatMoney } from '../lib/money.js';
import { availableTiers } from '../lib/licensing.js';
import { buyerKey } from '../lib/buyer.js';
import { isVideoListing } from '../lib/media.js';
import HubTrustBadge from '../components/HubTrustBadge.jsx';
import ProvenanceDrawer from '../components/ProvenanceDrawer.jsx';
import { apiFetch, verifiedLabel, verticalLabel } from '../lib/api.js';
import { recordListingView } from '../lib/recently-viewed.js';
import { canPurchase, resolveExchangeAccount } from '../lib/roles.js';
import { samePinitIdentity } from '../lib/pinit-identity.js';

export default function ListingDetail({ listingId, onBack, onOpenCheckout, onManageListing, onOpenBuyModule, shopModule = 'buy', user, onCartChanged, onEnableBuyer }) {
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState('');
  const [tab, setTab] = useState('overview');
  const [reviews, setReviews] = useState([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [toast, setToast] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (listingId) {
      fetchListingDetail();
      fetchReviews();
      setMediaError('');
      setTab('overview');
      // Device-local history for the Collections "Recently viewed" tab. The
      // server-side view counter is an aggregate and cannot answer "what did
      // I look at", so this is kept per-device and labelled as such.
      recordListingView(listingId);
    }
  }, [listingId]);

  const fetchListingDetail = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch(`/api/listings/${listingId}`);
    if (ok) {
      setListing(data);
      // Preselect a tier this listing is genuinely sold under — Commercial
      // when the creator priced it, otherwise the cheapest one that exists.
      const offered = availableTiers(data);
      const preferred = offered.find((t) => t.id === 'commercial') || offered[0];
      setSelectedTier(preferred ? preferred.id : '');
    }
    setLoading(false);
  };

  const fetchReviews = async () => {
    try {
      const res = await fetch(`/api/commerce/reviews/${encodeURIComponent(listingId)}`);
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews || []);
        setAvgRating(data.average || 0);
        setReviewCount(data.count || 0);
      }
    } catch {
      /* ignore */
    }
  };

  const ensureBuyerKey = () => {
    let key = buyerKey(user);
    if (!key) {
      key = `GUEST-${Date.now()}`;
      localStorage.setItem('pinit_guest_buyer', key);
    }
    return key;
  };

  const addToCart = async () => {
    if (user && !canPurchase(user)) {
      setToast('Become a Buyer on this same identity to purchase.');
      return;
    }
    const { ok, error } = await apiFetch('/api/commerce/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_key: ensureBuyerKey(),
        listing_id: listing.listing_id,
        license_tier: selectedTier,
      }),
    });
    setToast(ok ? 'Added to cart' : (error || 'Could not add to cart'));
    if (ok) onCartChanged?.();
  };

  const addWishlist = async () => {
    // Uses apiFetch (like addToCart) so a server-side failure surfaces its real
    // message instead of a blanket "Could not save".
    const { ok, error } = await apiFetch('/api/commerce/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_key: ensureBuyerKey(), listing_id: listing.listing_id }),
    });
    setToast(ok ? 'Saved to wishlist' : (error || 'Could not save'));
  };

  const submitReview = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/commerce/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listing_id: listing.listing_id,
        buyer_name: user?.display_name || user?.name || 'Buyer',
        buyer_pinit_id: user?.pinit_id,
        rating: reviewRating,
        comment: reviewText,
      }),
    });
    if (res.ok) {
      setReviewText('');
      fetchReviews();
      setToast('Review published');
    }
  };

  if (loading) {
    return (
      <div className="ex-page">
        <div className="detail-layout" aria-busy="true" aria-label="Loading asset">
          <div>
            <div className="ex-skel" style={{ height: 420, borderRadius: 'var(--radius-md)' }} />
            <div className="ex-skel ex-skel--line" style={{ width: '46%', height: 22, marginTop: 20 }} />
            <div className="ex-skel ex-skel--line" style={{ width: '72%' }} />
          </div>
          <div>
            <div className="ex-skel" style={{ height: 300, borderRadius: 'var(--radius-md)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="ex-page">
        <div className="ex-card ex-empty">
          <div className="ex-empty__icon"><ImageOff size={24} /></div>
          <div className="ex-empty__title">Asset not found</div>
          <p className="ex-empty__body">This listing may have been delisted, or sold under an exclusive licence.</p>
          <button type="button" className="ex-btn ex-btn--primary" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Exchange
          </button>
        </div>
      </div>
    );
  }

  // Only tiers the creator actually priced are offered. The page previously
  // fell back to invented figures (49 / 149 / 899 / 2499), which advertised a
  // price the creator never set and let a buyer open checkout on a tier that
  // was never on sale.
  const tiers = availableTiers(listing);
  const activeTier = tiers.find((t) => t.id === selectedTier)
    || tiers.find((t) => t.id === 'commercial')
    || tiers[0]
    || null;

  const account = resolveExchangeAccount(user);
  const ownsListing = samePinitIdentity(account.pinitId, listing.pinit_id);
  const needsBuyer = Boolean(user && account.needsBuyerEnable);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'licence', label: 'Licence' },
    { id: 'reviews', label: reviewCount ? `Reviews (${reviewCount})` : 'Reviews' },
  ];

  const tagList = String(listing.tags || '').split(',').map((raw) => raw.trim()).filter(Boolean);

  return (
    <div className="ex-page">
      <button className="ex-btn ex-btn--ghost ex-btn--sm" onClick={onBack} style={{ marginBottom: 18, paddingLeft: 0 }}>
        <ArrowLeft size={16} /> Back to Exchange
      </button>
      {toast && <div className="ex-alert ex-alert--ok" style={{ marginBottom: 14 }}><span>{toast}</span></div>}

      <div className="detail-layout">
        <div>
          <div className="asset-stage">
            <div className="asset-stage__frame" onContextMenu={(e) => e.preventDefault()}>
              {isVideoListing(listing) ? (
                <video
                  key={listing.preview_url || listing.asset_id}
                  src={listing.preview_url}
                  controls
                  controlsList="nodownload noremoteplayback"
                  disablePictureInPicture
                  playsInline
                  preload="metadata"
                  onError={() => setMediaError('Preview unavailable')}
                  className="asset-stage__media"
                />
              ) : (
                <img
                  src={listing.preview_url}
                  alt={listing.title}
                  className="asset-stage__media pinit-protected-media"
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  onError={() => setMediaError('Preview unavailable')}
                />
              )}
              {/* A missing preview is cosmetic — licensing, cart and wishlist all
                  still work, so show a calm placeholder rather than an error banner. */}
              {mediaError && (
                <div className="asset-stage__fallback">
                  <ImageOff size={34} strokeWidth={1.5} />
                  <span>{mediaError}</span>
                </div>
              )}
              <div className="asset-stage__badges">
                <span className="badge-verified"><Award size={14} /> VERIFIED</span>
                <span className={`badge-${String(listing.badge_tier || 'bronze').toLowerCase()}`}>
                  {verifiedLabel(listing.badge_tier)}
                </span>
              </div>
            </div>
            <p className="asset-stage__note">
              Preview only — buyers can view this asset. Download and share unlock after a licence is purchased.
            </p>
          </div>

          <header className="asset-head">
            <h1 className="ex-h1 asset-head__title">{listing.title}</h1>
            {listing.tagline && <p className="asset-head__tagline">{listing.tagline}</p>}
            <p className="asset-head__offer">
              Marketplace listing for a Hub-protected asset
              {listing.asset_id ? ` · ${listing.asset_id}` : ''}
            </p>
            <div className="asset-head__meta">
              <span className="asset-head__rating">
                <Star size={15} /> {avgRating || '—'}
                <em>{reviewCount === 1 ? '1 review' : `${reviewCount} reviews`}</em>
              </span>
              {listing.vertical && <span className="asset-head__chip">{verticalLabel(listing.vertical)}</span>}
            </div>
          </header>

          <div className="asset-tabs" role="tablist" aria-label="Asset details">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`asset-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`asset-panel-${t.id}`}
                className={`asset-tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <section className="ex-card ex-card--pad" role="tabpanel" id="asset-panel-overview" aria-labelledby="asset-tab-overview">
              <p className="asset-prose">
                {listing.description || 'The creator has not added a description for this asset yet.'}
              </p>
              {tagList.length > 0 && (
                <div className="asset-tags">
                  {tagList.map((tagValue) => (
                    <span key={tagValue} className="ex-chip">{tagValue}</span>
                  ))}
                </div>
              )}
              <HubTrustBadge onOpenProvenance={() => setDrawerOpen(true)} style={{ marginTop: 20 }} />
            </section>
          )}

          {tab === 'licence' && (
            <section className="ex-card ex-card--pad" role="tabpanel" id="asset-panel-licence" aria-labelledby="asset-tab-licence">
              {!activeTier ? (
                <p className="asset-prose">
                  The creator has not published pricing for this asset, so no licence is on sale yet.
                </p>
              ) : (
                <>
                  <div className="licence-head">
                    <h3 className="ex-h2 licence-head__name">{activeTier.name} licence</h3>
                    <span className="licence-head__price">{formatMoney(activeTier.price)}</span>
                  </div>
                  <p className="asset-prose">{activeTier.summary}</p>

                  <div className="licence-rights">
                    <div>
                      <p className="ex-label">What this covers</p>
                      <ul className="licence-list licence-list--yes">
                        {activeTier.rights.allowed.map((line) => (
                          <li key={line}><Check size={15} /> {line}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="ex-label">Not included</p>
                      <ul className="licence-list licence-list--no">
                        {activeTier.rights.excluded.map((line) => (
                          <li key={line}><Minus size={15} /> {line}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <p className="licence-entitlement">
                    <Download size={15} /> {activeTier.entitlement} of the protected original after purchase.
                  </p>
                </>
              )}
            </section>
          )}

          {tab === 'reviews' && (
            <section className="ex-card ex-card--pad" role="tabpanel" id="asset-panel-reviews" aria-labelledby="asset-tab-reviews">
              <div className="review-list">
                {reviews.length === 0 && (
                  <p className="asset-prose asset-prose--dim">
                    No reviews yet — the first buyer to license this can leave one.
                  </p>
                )}
                {reviews.map((r) => (
                  <article key={r.id} className="review">
                    <div className="review__head">
                      <span className="review__stars" aria-label={`${r.rating} out of 5`}>
                        {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                      </span>
                      {/* Reviewer shown by public Pinit ID where available — a
                          display name is not an identifier we need to expose. */}
                      <span className="review__who">{r.buyer_pinit_id || r.buyer_name}</span>
                    </div>
                    <p className="review__body">{r.comment}</p>
                  </article>
                ))}
              </div>
              <form onSubmit={submitReview} className="review-form">
                <label className="form-label">Your rating
                  <select className="form-select" value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))}>
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}
                  </select>
                </label>
                <textarea className="form-textarea" rows={2} placeholder="Share how this licence worked for you…" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
                <button type="submit" className="ex-btn ex-btn--secondary" style={{ alignSelf: 'flex-start' }}>Post review</button>
              </form>
            </section>
          )}
        </div>

        <aside className="asset-rail">
          {/* Creator identity. The public Exchange ID is shown; the raw
              Asset UUID that used to sit here is an internal database
              identifier and is no longer surfaced to buyers. */}
          <div className="ex-card ex-card--pad creator-chip">
            <div className="creator-chip__avatar" aria-hidden="true">
              {String(listing.creator_name || 'C').trim().charAt(0).toUpperCase()}
            </div>
            <div className="creator-chip__id">
              <span className="creator-chip__name">
                {listing.creator_name || 'Creator'}
                <ShieldCheck size={13} />
              </span>
              <span className="creator-chip__pid">{listing.pinit_id}</span>
            </div>
          </div>

          <div className="ex-card ex-card--pad buy-panel">
            {ownsListing && shopModule === 'sell' ? (
              <>
                <h3 className="ex-h2 buy-panel__title">Your listing</h3>
                <p className="buy-panel__note">
                  Manage this listing from Sell. To license someone else&apos;s work, open Buy and choose a listing that is not yours.
                </p>
                <ul className="buy-panel__tiers">
                  {tiers.length === 0 && <li className="buy-panel__none">No pricing published</li>}
                  {tiers.map((t) => (
                    <li key={t.id}>
                      <span>{t.name}</span>
                      <strong>{formatMoney(t.price)}</strong>
                    </li>
                  ))}
                </ul>
                <button type="button" className="ex-btn ex-btn--primary ex-btn--block" onClick={onManageListing}>
                  Your Listings
                </button>
                <button type="button" className="ex-btn ex-btn--secondary ex-btn--block" onClick={onOpenBuyModule}>
                  Buy other work
                </button>
              </>
            ) : ownsListing ? (
              <>
                <h3 className="ex-h2 buy-panel__title">This is your listing</h3>
                <p className="buy-panel__note">
                  You cannot buy your own work. Open Discover and pick another creator&apos;s listing to see Buy now, Add to cart and Wishlist.
                </p>
                <button type="button" className="ex-btn ex-btn--primary ex-btn--block" onClick={onOpenBuyModule}>
                  Discover listings to buy
                </button>
                <button type="button" className="ex-btn ex-btn--secondary ex-btn--block" onClick={onManageListing}>
                  Manage in Sell
                </button>
              </>
            ) : needsBuyer ? (
              <>
                <h3 className="ex-h2 buy-panel__title">Want to license this work?</h3>
                <p className="buy-panel__note">
                  Activate Buyer on this same Pinit identity. Selling stays as it is — no second login.
                </p>
                <button type="button" className="ex-btn ex-btn--primary ex-btn--block" onClick={onEnableBuyer}>
                  Become a Buyer
                </button>
              </>
            ) : tiers.length === 0 ? (
              <>
                <h3 className="ex-h2 buy-panel__title">Not yet on sale</h3>
                <p className="buy-panel__note">
                  The creator has not published pricing for this asset. You can still save it and
                  come back once a licence is available.
                </p>
                <button type="button" className="ex-btn ex-btn--secondary ex-btn--block" onClick={addWishlist}>
                  <Heart size={16} /> Add to wishlist
                </button>
              </>
            ) : (
              <>
                <h3 className="ex-h2 buy-panel__title">Choose a licence</h3>
                <div className="tier-rail" role="radiogroup" aria-label="Licence tier">
                  {tiers.map((t) => {
                    const on = activeTier?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`tier-opt ${on ? 'is-on' : ''}`}
                        onClick={() => setSelectedTier(t.id)}
                      >
                        <span className="tier-opt__top">
                          <strong>{t.name}</strong>
                          <span className="tier-opt__price">{formatMoney(t.price)}</span>
                        </span>
                        <span className="tier-opt__desc">{t.summary}</span>
                        <span className="tier-opt__ent">{t.entitlement}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="buy-panel__actions">
                  <button
                    type="button"
                    className="ex-btn ex-btn--primary ex-btn--block"
                    onClick={() => onOpenCheckout({ ...listing, preferredTier: activeTier.id })}
                  >
                    Buy now — {formatMoney(activeTier.price)}
                  </button>
                  <button type="button" className="ex-btn ex-btn--secondary ex-btn--block" onClick={addToCart}>
                    <ShoppingCart size={16} /> Add to cart
                  </button>
                  <button type="button" className="ex-btn ex-btn--secondary ex-btn--block" onClick={addWishlist}>
                    <Heart size={16} /> Add to wishlist
                  </button>
                </div>
                <p className="buy-panel__fine">
                  Protected delivery. Licence terms are recorded against your order.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>

      <ProvenanceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} listing={listing} />
    </div>
  );
}
