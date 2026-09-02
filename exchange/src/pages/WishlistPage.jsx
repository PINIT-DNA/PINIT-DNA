import { formatFrom } from '../lib/money.js';
import React, { useEffect, useState } from 'react';
import { Heart, Trash2, ShoppingCart } from 'lucide-react';
import { buyerKey } from '../lib/buyer.js';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/EmptyState.jsx';
import BecomeBuyerPanel from '../components/BecomeBuyerPanel.jsx';
import { resolveExchangeAccount } from '../lib/roles.js';

export default function WishlistPage({ user, onOpenAuth, onSelectListing, onAddToCart, onBrowse, onEnableBuyer }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const key = buyerKey(user);
  const needsBuyer = Boolean(user && resolveExchangeAccount(user).needsBuyerEnable);

  const load = async () => {
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { ok, data } = await apiFetch(`/api/commerce/wishlist?buyer_key=${encodeURIComponent(key)}`);
    if (ok) setItems(data.items || []);
    else setItems([]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user && !localStorage.getItem('pinit_guest_buyer')) {
      localStorage.setItem('pinit_guest_buyer', `GUEST-${Date.now()}`);
    }
    load();
  }, [user?.pinit_id, user?.email]);

  const remove = async (listingId) => {
    await apiFetch(`/api/commerce/wishlist/${encodeURIComponent(listingId)}?buyer_key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    load();
  };

  if (needsBuyer) {
    return <BecomeBuyerPanel onEnable={onEnableBuyer} />;
  }

  if (!key) {
    return (
      <div className="ex-page ex-page--narrow">
        <div className="ex-card ex-empty">
          <div className="ex-empty__icon"><Heart size={24} /></div>
          <div className="ex-empty__title">Sign in to save assets</div>
          <p className="ex-empty__body">Your wishlist follows your PINIT identity, so it is there on any device you sign in from.</p>
          <button
            type="button"
            className="ex-btn ex-btn--primary"
            onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'buyer' })}
          >
            Sign in with Hub biometric
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ex-page ex-page--narrow">
      <div className="ex-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 className="ex-h1">Wishlist</h1>
          <p className="ex-sub">Saved for later — availability is checked live.</p>
        </div>
      </div>

      {loading ? (
        <div className="listing-grid" aria-busy="true" aria-label="Loading saved assets">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="ex-card" style={{ overflow: 'hidden' }} aria-hidden="true">
              <div className="ex-skel ex-skel--media" style={{ borderRadius: 0 }} />
              <div style={{ padding: 14 }}>
                <div className="ex-skel ex-skel--line" style={{ width: '72%' }} />
                <div className="ex-skel ex-skel--line" style={{ width: '38%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart size={28} color="var(--primary)" />}
          title="No saved assets yet"
          description="Build your shortlist of creative assets and return when you are ready to license them."
          primaryLabel="Browse Exchange"
          onPrimary={() => onBrowse?.('marketplace')}
          secondaryLabel="Explore Collections"
          onSecondary={() => onBrowse?.('collections')}
        />
      ) : (
        <div className="listing-grid">
          {items.map((item) => {
            // Availability comes from the listing's own status — never invented.
            const status = String(item.listing?.status || '').toLowerCase();
            const sold = status === 'sold_exclusive';
            return (
              <div key={item.listing_id} className="ex-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div
                  onClick={() => onSelectListing?.(item.listing_id)}
                  style={{ cursor: 'pointer', position: 'relative', aspectRatio: '4 / 3', background: '#0a0e16' }}
                >
                  {item.listing?.preview_url ? (
                    <img
                      src={item.listing.preview_url}
                      alt={item.listing?.title || 'Asset preview'}
                      className="pinit-protected-media"
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : null}

                  <span
                    className="ex-verified"
                    style={
                      sold
                        ? { position: 'absolute', top: 10, left: 10, background: 'rgba(24,10,12,.8)', borderColor: 'rgba(244,63,94,.36)', color: '#fda4af' }
                        : { position: 'absolute', top: 10, left: 10 }
                    }
                  >
                    {sold ? 'Sold exclusive' : 'Available'}
                  </span>
                </div>

                <div style={{ padding: '13px 14px 14px', display: 'flex', flexDirection: 'column', gap: 11, flexGrow: 1 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#fff', lineHeight: 1.35 }}>
                      {item.listing?.title}
                    </h3>
                    {item.listing?.creator_name ? (
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: 3 }}>
                        {item.listing.creator_name}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 'auto' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--emerald)', fontFamily: 'var(--font-heading)' }}>
                      {formatFrom(item.listing?.price_personal)}
                    </span>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <button
                        type="button"
                        className="ex-btn ex-btn--secondary ex-btn--sm"
                        title="Remove from wishlist"
                        aria-label={`Remove ${item.listing?.title || 'asset'} from wishlist`}
                        onClick={() => remove(item.listing_id)}
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        type="button"
                        className="ex-btn ex-btn--primary ex-btn--sm"
                        onClick={() => onAddToCart?.(item.listing)}
                      >
                        <ShoppingCart size={14} /> Add to cart
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
