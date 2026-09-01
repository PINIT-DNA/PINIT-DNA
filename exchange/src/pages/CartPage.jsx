import React, { useEffect, useState } from 'react';
import { ShoppingCart, Trash2, Tag, ShieldCheck, ImageOff } from 'lucide-react';
import { payAndSeal } from '../lib/razorpay-checkout.js';
import { apiFetch } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import EmptyState from '../components/EmptyState.jsx';
import { buyerKey } from '../lib/buyer.js';
import { canPurchase } from '../lib/roles.js';

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
    if (!canPurchase(user)) {
      setError('Sign in to check out.');
      return;
    }
    setCheckingOut(true);
    setError('');
    setMessage('');
    try {
      const buyerName = user.display_name || user.name || 'Pinit Buyer';
      const buyerEmail =
        user.email ||
        (user.pinit_id
          ? `${String(user.pinit_id).toLowerCase().replace(/[^a-z0-9]/g, '')}@buyer.local`
          : 'buyer@pinit.local');
      const data = await payAndSeal({
        mode: 'cart',
        createBody: {
          buyer_key: key,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          buyer_org: user.org_name || '',
          buyer_pinit_id: user.pinit_id,
          coupon_code: couponInfo?.code || '',
        },
        description: `Pinit Exchange cart (${items.length} licenses)`,
        userName: buyerName,
        userEmail: buyerEmail,
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
      <div className="ex-page ex-page--narrow">
        <div className="ex-head"><h1 className="ex-h1">Cart</h1></div>
        <div style={{ display: 'grid', gap: 12 }} aria-busy="true" aria-label="Loading cart">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="ex-card" style={{ padding: 14, display: 'flex', gap: 15 }} aria-hidden="true">
              <div className="ex-skel" style={{ width: 110, height: 80, flexShrink: 0 }} />
              <div style={{ flexGrow: 1 }}>
                <div className="ex-skel ex-skel--line" style={{ width: '46%', marginTop: 4 }} />
                <div className="ex-skel ex-skel--line" style={{ width: '28%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="ex-page ex-page--narrow">
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
    <div className="ex-page ex-page--narrow">
      <div className="ex-head">
        <h1 className="ex-h1">Cart</h1>
        <p className="ex-sub">{items.length} licence{items.length === 1 ? '' : 's'} ready to seal.</p>
      </div>

      {error && <div className="ex-alert ex-alert--error" style={{ marginBottom: 14 }}><span>{error}</span></div>}
      {message && <div className="ex-alert ex-alert--ok" style={{ marginBottom: 14 }}><span>{message}</span></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 330px', gap: 24, alignItems: 'start' }} className="cart-layout">

        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((item) => (
            <div key={item.id} className="ex-card" style={{ padding: 14, display: 'flex', gap: 15, alignItems: 'center' }}>
              <div
                onClick={() => onSelectListing?.(item.listing_id)}
                style={{
                  width: 104, height: 78, borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                  flexShrink: 0, background: '#0a0e16', display: 'grid', placeItems: 'center',
                }}
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
                ) : (
                  /* No stock-photo stand-in: an unrelated image would misrepresent
                     the asset being licensed. */
                  <ImageOff size={18} color="var(--text-dim)" />
                )}
              </div>

              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <div
                  style={{ color: '#fff', fontWeight: 600, fontSize: '14.5px', cursor: 'pointer' }}
                  onClick={() => onSelectListing?.(item.listing_id)}
                >
                  {item.listing?.title || item.listing_id}
                </div>
                {item.listing?.creator_name ? (
                  <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: 3 }}>{item.listing.creator_name}</div>
                ) : null}
                <span className="ex-chip" style={{ marginTop: 9, textTransform: 'capitalize' }}>
                  {item.license_tier} licence
                </span>
              </div>

              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                <div style={{ color: 'var(--emerald)', fontWeight: 700, fontSize: '17px', fontFamily: 'var(--font-heading)' }}>
                  {formatMoney(item.line_price || 0)}
                </div>
                <button
                  type="button"
                  className="ex-btn ex-btn--secondary ex-btn--sm"
                  onClick={() => remove(item.id)}
                  title="Remove"
                  aria-label={`Remove ${item.listing?.title || 'item'} from cart`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="ex-card ex-card--pad">
          <h2 className="ex-h2" style={{ fontSize: 16, marginBottom: 14 }}>Summary</h2>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              className="form-input"
              placeholder="Coupon code"
              value={coupon}
              onChange={(e) => setCoupon(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" className="ex-btn ex-btn--secondary ex-btn--sm" onClick={applyCoupon}>
              <Tag size={14} /> Apply
            </button>
          </div>

          <div className="ex-kv"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
          {discount > 0 && (
            <div className="ex-kv"><span>Discount</span><span style={{ color: 'var(--emerald)' }}>−{formatMoney(discount)}</span></div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            color: '#fff', fontWeight: 700, fontSize: '17px', fontFamily: 'var(--font-heading)',
            paddingTop: 14, marginTop: 4,
          }}>
            <span>Total</span><span style={{ color: 'var(--emerald)' }}>{formatMoney(total)}</span>
          </div>

          <button
            type="button"
            className="ex-btn ex-btn--primary ex-btn--block"
            style={{ marginTop: 16, padding: '13px 18px', fontSize: 14 }}
            disabled={checkingOut}
            onClick={checkout}
          >
            {checkingOut ? 'Auto-completing payment…' : `Checkout · ${formatMoney(total)}`}
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center',
            marginTop: 13, fontSize: 11, color: 'var(--text-dim)',
          }}>
            <ShieldCheck size={13} color="var(--emerald)" />
            Cards never stored · licence sealed on purchase
          </div>
        </div>
      </div>
    </div>
  );
}
