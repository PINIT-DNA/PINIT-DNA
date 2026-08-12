import React, { useState, useEffect } from 'react';
import { Award, ArrowLeft, Heart, ShoppingCart, Star } from 'lucide-react';
import { buyerKey } from '../lib/buyer.js';
import { isVideoListing } from '../lib/media.js';
import HubTrustBadge from '../components/HubTrustBadge.jsx';
import ProvenanceDrawer from '../components/ProvenanceDrawer.jsx';
import { apiFetch, verifiedLabel } from '../lib/api.js';
import { canList, canPurchase, isSeller } from '../lib/roles.js';

export default function ListingDetail({ listingId, onBack, onOpenCheckout, onManageListing, user, onCartChanged }) {
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState('commercial');
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
    }
  }, [listingId]);

  const fetchListingDetail = async () => {
    setLoading(true);
    const { ok, data } = await apiFetch(`/api/listings/${listingId}`);
    if (ok) setListing(data);
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
      setToast('Creator accounts cannot purchase marketplace assets.');
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
    const res = await fetch('/api/commerce/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_key: ensureBuyerKey(), listing_id: listing.listing_id }),
    });
    setToast(res.ok ? 'Saved to wishlist' : 'Could not save');
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
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading Provenance Record...
      </div>
    );
  }

  if (!listing) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <h3 style={{ color: '#fff' }}>Listing Not Found</h3>
        <button className="btn-secondary" onClick={onBack} style={{ marginTop: '16px' }}>
          <ArrowLeft size={16} /> Back to Exchange
        </button>
      </div>
    );
  }

  const tiers = [
    { id: 'personal', name: 'Personal', price: listing.price_personal || 49, desc: 'Single user, non-commercial portfolio & education' },
    { id: 'commercial', name: 'Commercial', price: listing.price_commercial || 149, desc: 'Client deliverables, campaigns & digital ads' },
    { id: 'exclusive', name: 'Exclusive', price: listing.price_exclusive || 899, desc: 'Exclusive rights — asset is delisted from Exchange' },
    { id: 'enterprise', name: 'Enterprise', price: listing.price_enterprise || 2499, desc: 'Multi-seat org license with protected delivery' },
  ];

  const currentPrice = listing[`price_${selectedTier}`] || listing.price_personal;

  return (
    <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '32px 24px' }}>
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: '24px' }}>
        <ArrowLeft size={16} /> Back to Exchange
      </button>
      {toast && <div style={{ color: 'var(--emerald)', marginBottom: 12 }}>{toast}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px' }}>
        <div>
          <div className="glass-panel" style={{ overflow: 'hidden', marginBottom: '24px', padding: 0 }}>
            <div style={{ position: 'relative', width: '100%', height: '420px', background: '#000' }}>
              {isVideoListing(listing) ? (
                <video
                  key={listing.preview_url || listing.asset_id}
                  src={listing.preview_url}
                  controls
                  controlsList="nodownload"
                  playsInline
                  preload="metadata"
                  onError={() => setMediaError('Preview unavailable — start Pinit HUB API (port 4000) so Exchange can stream the vault file.')}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    position: 'relative',
                    zIndex: 2,
                  }}
                />
              ) : (
                <img
                  src={listing.preview_url}
                  alt={listing.title}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onError={() => setMediaError('Preview image failed to load.')}
                />
              )}
              {mediaError && (
                <div style={{
                  position: 'absolute', left: 12, right: 12, bottom: 48, zIndex: 4,
                  background: 'rgba(0,0,0,0.75)', color: '#fbbf24', padding: '10px 12px',
                  borderRadius: 8, fontSize: '0.82rem',
                }}>
                  {mediaError}
                </div>
              )}
              <div className="watermark-overlay" style={{ zIndex: 1, pointerEvents: 'none' }}>
                <div className="watermark-text">Pinit PROVENANCE SEAL</div>
              </div>
              <div className="card-badge-container" style={{ zIndex: 3, pointerEvents: 'none' }}>
                <span className="badge-verified"><Award size={14} /> VERIFIED</span>
                <span className={`badge-${String(listing.badge_tier || 'bronze').toLowerCase()}`} style={{ marginLeft: 8 }}>
                  {verifiedLabel(listing.badge_tier)}
                </span>
              </div>
            </div>
            <div style={{ padding: '24px' }}>
              <h1 style={{ fontSize: '1.8rem', color: '#fff', marginBottom: '8px' }}>{listing.title}</h1>
              {listing.tagline && <p style={{ color: 'var(--text-muted)', marginBottom: 10 }}>{listing.tagline}</p>}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, color: 'var(--badge-gold)' }}>
                <Star size={16} /> {avgRating || '—'} ({reviewCount} reviews)
              </div>
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{listing.description}</p>
            </div>
          </div>

          <HubTrustBadge onOpenProvenance={() => setDrawerOpen(true)} style={{ marginBottom: 24 }} />

          <div className="glass-panel" style={{ padding: 24 }}>
            <h3 style={{ color: '#fff', marginBottom: 14 }}>Reviews</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              {reviews.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No reviews yet.</p>}
              {reviews.map((r) => (
                <div key={r.id} style={{ background: 'rgba(0,0,0,0.25)', padding: 12, borderRadius: 8 }}>
                  <div style={{ color: 'var(--badge-gold)', fontSize: '0.85rem' }}>
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} · {r.buyer_name}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 4 }}>{r.comment}</p>
                </div>
              ))}
            </div>
            <form onSubmit={submitReview} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="form-label">Your rating
                <select className="form-select" value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))}>
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}
                </select>
              </label>
              <textarea className="form-textarea" rows={2} placeholder="Share how this license worked for you…" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
              <button type="submit" className="btn-secondary" style={{ alignSelf: 'flex-start' }}>Post review</button>
            </form>
          </div>
        </div>

        <div>
          <div className="glass-panel" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>
              Verified Creator Passport
            </div>
            <div style={{ fontSize: '0.9rem', color: '#fff' }}>{listing.creator_name || 'Creator'}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Pinit ID: {listing.pinit_id}</div>
          </div>

          <div className="glass-panel" style={{ padding: 24 }}>
            {isSeller(user) ? (
              <>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: 12 }}>Asset information</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: 16 }}>
                  Creator accounts cannot purchase marketplace assets.
                </p>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 16 }}>
                  From ${listing.price_personal || 49} · Personal · Commercial · Exclusive
                </div>
                {canList(user) && user?.pinit_id === listing.pinit_id && (
                  <button type="button" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onManageListing}>
                    Manage listing
                  </button>
                )}
                <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={addWishlist}>
                  <Heart size={16} /> Save for reference
                </button>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: 16 }}>Select License Tier</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  {tiers.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTier(t.id)}
                      style={{
                        border: selectedTier === t.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: selectedTier === t.id ? 'rgba(59, 130, 246, 0.12)' : 'rgba(0,0,0,0.2)',
                        padding: '14px 18px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ color: '#fff' }}>{t.name}</strong>
                        <span style={{ color: 'var(--emerald)', fontWeight: 800 }}>${t.price}</span>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{t.desc}</p>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => onOpenCheckout({ ...listing, preferredTier: selectedTier })}
                  >
                    License now — {selectedTier} (${currentPrice})
                  </button>
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={addToCart}>
                    <ShoppingCart size={16} /> Add to cart
                  </button>
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={addWishlist}>
                    <Heart size={16} /> Add to wishlist
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ProvenanceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} listing={listing} />
    </div>
  );
}
