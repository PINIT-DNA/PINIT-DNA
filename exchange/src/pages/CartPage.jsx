import React, { useEffect, useState } from 'react';
import { ShoppingCart, Trash2, Tag } from 'lucide-react';
import { payAndSeal } from '../lib/razorpay-checkout.js';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/EmptyState.jsx';
import { buyerKey } from '../lib/buyer.js';

export default function CartPage({ user, onOpenAuth, onSelectListing, onCheckoutDone, onBrowse }) {
  const [items, setItems] = useState([]);
  const [subtotal, setSubtotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [couponInfo, setCouponInfo] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const key = buyerKey(user);

  const load = async () => {
    if (!key) {
      setLoading(false);
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    const { ok, data, error: err } = await apiFetch(
      `/api/commerce/cart?buyer_key=${encodeURIComponent(key)}`,
    );
    if (!ok) {
      setError(err || 'Could not load cart');
      setItems([]);
      setSubtotal(0);
    } else {
      setItems(data.items || []);
      setSubtotal(data.subtotal || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user && !localStorage.getItem('pinit_guest_buyer')) {
      localStorage.setItem('pinit_guest_buyer', `GUEST-${Date.now()}`);
    }
    load();
  }, [user?.pinit_id, user?.email]);

  const remove = async (id) => {
    await apiFetch(`/api/commerce/cart/${id}?buyer_key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    load();
  };

  const applyCoupon = async () => {
    setCouponInfo(null);
    if (!coupon.trim()) return;
    const { ok, data, error: err } = await apiFetch('/api/commerce/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: coupon.trim() }),
    });
    if (!ok) {
      setError(err || 'Invalid coupon');
      return;
    }
    setCouponInfo(data);
    setError('');
  };

  const discount = couponInfo ? (subtotal * Number(couponInfo.percent_off)) / 100 : 0;
  const total = Math.max(0, subtotal - discount);

  const checkout = async () => {
    if (!user) {
      onOpenAuth?.({ mode: 'signup', intent: 'buyer' });
      return;
    }
    setCheckingOut(true);
    setError('');
    setMessage('');
    try {
      const data = await payAndSeal({
        mode: 'cart',
        createBody: {
          buyer_key: key,
          buyer_name: user.display_name || user.name || 'Buyer',
          buyer_email: user.email || `${user.pinit_id}@buyer.local`,
          buyer_org: user.org_name || '',
          buyer_pinit_id: user.pinit_id,
          coupon_code: couponInfo?.code || '',
        },
        description: `Pinit Exchange cart (${items.length} licenses)`,
        userName: user.display_name || user.name,
        userEmail: user.email,
      });
      setMessage(`Sealed ${data.sealed} license(s). Open My Licenses to download.`);
      setItems([]);
      setSubtotal(0);
      onCheckoutDone?.(data);
    } catch (e) {
      setError(e.message || 'Checkout failed');
    } finally {
      setCheckingOut(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading cart…
      </div>
    );
  }

  if (!items.length) {
    return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
        <EmptyState
          icon={<ShoppingCart size={28} color="var(--primary)" />}
          title="Your cart is empty"
          description="Build a shortlist of creative licenses and check out when you are ready."
          primaryLabel="Browse Exchange"
          onPrimary={() => onBrowse?.() || onSelectListing?.(null)}
          secondaryLabel="Explore Collections"
          onSecondary={() => onBrowse?.('collections')}
        />
        {error && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 16, fontSize: '0.85rem' }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ color: '#fff', fontSize: '2rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShoppingCart size={28} /> Cart
      </h1>
      {error && <div style={{ color: '#f87171', marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: 'var(--emerald)', marginBottom: 12 }}>{message}</div>}

      <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        {items.map((item) => (
          <div key={item.id} className="glass-panel" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
            <img
              src={item.listing?.preview_url || 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=200&q=60'}
              alt=""
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, cursor: 'pointer' }}
              onClick={() => onSelectListing?.(item.listing_id)}
            />
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontWeight: 600, cursor: 'pointer' }} onClick={() => onSelectListing?.(item.listing_id)}>
                {item.listing?.title || item.listing_id}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                License: {item.license_tier}
              </div>
            </div>
            <div style={{ color: 'var(--emerald)', fontWeight: 700 }}>${Number(item.line_price || 0).toFixed(0)}</div>
            <button type="button" className="btn-secondary" style={{ padding: 8 }} onClick={() => remove(item.id)} title="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="form-input"
            placeholder="Coupon code"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-secondary" onClick={applyCoupon}>
            <Tag size={14} /> Apply
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: 6 }}>
          <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--emerald)', marginBottom: 6 }}>
            <span>Discount</span><span>-${discount.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, fontSize: '1.1rem', marginBottom: 16 }}>
          <span>Total</span><span>${total.toFixed(2)}</span>
        </div>
        <button type="button" className="btn-primary" style={{ width: '100%' }} disabled={checkingOut} onClick={checkout}>
          {checkingOut ? 'Processing…' : 'Checkout & seal licenses'}
        </button>
      </div>
    </div>
  );
}
