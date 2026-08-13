import React, { useEffect, useState } from 'react';
import { Heart, Trash2 } from 'lucide-react';
import { buyerKey } from '../lib/buyer.js';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/EmptyState.jsx';

export default function WishlistPage({ user, onOpenAuth, onSelectListing, onAddToCart, onBrowse }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const key = buyerKey(user);

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

  if (!key) {
    return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 24, textAlign: 'center' }}>
        <h2 style={{ color: '#fff' }}>Wishlist</h2>
        <button className="btn-primary" onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'buyer' })}>
          Sign in with Hub biometric
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ color: '#fff', fontSize: '2rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Heart size={26} /> Wishlist
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Saved listings — return when you are ready to license.</p>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
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
          {items.map((item) => (
            <div key={item.listing_id} className="glass-panel" style={{ overflow: 'hidden' }}>
              <div onClick={() => onSelectListing?.(item.listing_id)} style={{ cursor: 'pointer' }}>
                <img
                  src={item.listing?.preview_url || (item.listing?.asset_id ? `/api/hub/preview/${item.listing.asset_id}` : '')}
                  alt={item.listing?.title}
                  style={{ width: '100%', height: 160, objectFit: 'cover' }}
                />
              </div>
              <div style={{ padding: 16 }}>
                <h3 style={{ color: '#fff', marginBottom: 8 }}>{item.listing?.title}</h3>
                <div style={{ color: 'var(--emerald)', fontWeight: 700, marginBottom: 10 }}>
                  From ${item.listing?.price_personal}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-primary" style={{ flex: 1, fontSize: '0.8rem' }} onClick={() => onAddToCart?.(item.listing)}>
                    Add to cart
                  </button>
                  <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={() => remove(item.listing_id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
