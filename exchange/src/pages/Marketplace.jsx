import React, { useState, useEffect } from 'react';
import {
  Search, Filter, ShieldCheck, Pencil, X, Check, Heart, ArrowRight,
} from 'lucide-react';
import ListingCard from '../components/ListingCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import DiscoverHeroArt from '../components/DiscoverHeroArt.jsx';
import { apiFetch, unwrapList } from '../lib/api.js';
import { buyerKey } from '../lib/buyer.js';
import { canList, canPurchase } from '../lib/roles.js';
import { isImageListing, isVideoListing } from '../lib/media.js';
import { samePinitIdentity } from '../lib/pinit-identity.js';
import { resolveHubAppUrl } from '../lib/exchange-routes.js';

const VERTICALS = [
  { id: 'all', name: 'All Verticals' },
  { id: 'mine', name: 'My Listings' },
  { id: 'images', name: 'Photography' },
  { id: 'video', name: 'Video' },
  { id: 'ui_ux', name: 'UI/UX' },
  { id: '3d', name: '3D Models' },
  { id: 'audio', name: 'Audio' },
  { id: 'concepts', name: 'Concepts' },
];

export default function Marketplace({
  onSelectListing,
  onOpenListFromHub,
  onOpenCheckout,
  onBecomeCreator,
  user = null,
  focusListingId = null,
  resetFiltersToken = 0,
  onCartChanged,
}) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed request and an empty catalogue are different things. Conflating
  // them told customers the shop was empty when the backend was simply down.
  const [loadError, setLoadError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedVertical, setSelectedVertical] = useState('all');
  const [selectedBadge, setSelectedBadge] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    if (resetFiltersToken) {
      setSelectedVertical(user?.pinit_id ? 'mine' : 'all');
      setSelectedBadge('all');
      setSearchQuery('');
      setSortOption('newest');
    }
  }, [resetFiltersToken, user?.pinit_id]);

  useEffect(() => {
    fetchListings();
  }, [selectedVertical, selectedBadge, sortOption, resetFiltersToken, user?.pinit_id]);

  useEffect(() => {
    if (!focusListingId || !listings.length) return;
    const el = document.getElementById(`listing-${focusListingId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('listing-card--flash');
      setTimeout(() => el.classList.remove('listing-card--flash'), 2400);
    }
  }, [focusListingId, listings]);

  const PAGE_SIZE = 24;

  const buildUrl = (offset) => {
    const verticalParam = selectedVertical === 'mine' ? 'all' : selectedVertical;
    let url = `/api/listings?vertical=${verticalParam}&badge=${selectedBadge}&sort=${sortOption}`
      + `&limit=${PAGE_SIZE}&offset=${offset}`;
    if (selectedVertical === 'mine' && user?.pinit_id) {
      url += `&seller=${encodeURIComponent(user.pinit_id)}`;
    }
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    return url;
  };

  const fetchListings = async () => {
    setLoading(true);
    setLoadError('');
    const { ok, data, error, headers } = await apiFetch(buildUrl(0));
    if (!ok) {
      // Surface the failure instead of rendering an empty marketplace.
      setLoadError(error || 'Could not load the marketplace.');
      setListings([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const page = unwrapList(data, headers);
    setListings(page.items);
    setTotal(page.total);
    setHasMore(page.hasMore);
    setLoading(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { ok, data, error, headers } = await apiFetch(buildUrl(listings.length));
    if (ok) {
      const page = unwrapList(data, headers);
      setListings((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      setHasMore(page.hasMore);
    } else {
      setLoadError(error || 'Could not load more listings.');
    }
    setLoadingMore(false);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchListings();
  };

  const openEdit = (e, item) => {
    e.stopPropagation();
    setEditError('');
    setEditing(item);
    setEditForm({
      title: item.title || '',
      tagline: item.tagline || '',
      description: item.description || '',
      tags: item.tags || '',
      vertical: item.vertical || 'images',
      price_personal: item.price_personal ?? 49,
      price_commercial: item.price_commercial ?? 149,
      price_exclusive: item.price_exclusive ?? 899,
      price_enterprise: item.price_enterprise ?? 2499,
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!user?.pinit_id || !editing) return;
    setSaving(true);
    setEditError('');
    try {
      const res = await fetch(`/api/listings/${encodeURIComponent(editing.listing_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinit_id: user.pinit_id, ...editForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setEditing(null);
      await fetchListings();
    } catch (err) {
      setEditError(err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const isOwner = (item) => samePinitIdentity(user?.pinit_id, item.pinit_id);

  const visibleListings = listings.filter((item) => {
    if (selectedVertical === 'images') return isImageListing(item);
    if (selectedVertical === 'video') return isVideoListing(item);
    return true;
  });

  return (
    <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '32px 24px' }}>
      <div className="glass-panel market-hero">
        <div className="market-hero__copy">
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)',
            padding: '6px 14px', borderRadius: 'var(--radius-full)', fontSize: '0.8rem',
            color: 'var(--primary)', fontWeight: 600, marginBottom: '20px',
          }}>
            <ShieldCheck size={16} />
            <span>Pinit HUB DNA &amp; Vault Protection Powered</span>
          </div>
          <h1 style={{ fontSize: '2.8rem', lineHeight: '1.15', marginBottom: '16px', color: '#fff' }}>
            The verified marketplace for creative licenses
          </h1>
          <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginBottom: '28px', lineHeight: '1.6' }}>
            {canList(user)
              ? 'Create, protect, list and earn from creative assets.'
              : 'Discover, license and manage creative assets.'}
          </p>
          {/* A signed-in buyer gets no hero CTA at all — they are already in the
              marketplace, and the listings below are the call to action. Skip the
              row entirely rather than rendering an empty flex container, which
              would leave stray gap spacing under the subtitle. */}
          <div style={{ display: 'flex', gap: '16px' }} hidden={Boolean(user) && !canList(user)}>
            {canList(user) ? (
              <button className="btn-primary" onClick={onOpenListFromHub} style={{ padding: '12px 24px', fontSize: '1rem' }}>
                List from Pinit Hub <ArrowRight size={18} />
              </button>
            ) : !user ? (
              // Guests only. A signed-in buyer is already inside the marketplace,
              // so sending them out to Hub is not a useful primary action.
              <a
                href={resolveHubAppUrl()}
                className="btn-primary"
                style={{ padding: '12px 24px', fontSize: '1rem', textDecoration: 'none' }}
                target="_blank"
                rel="noreferrer"
              >
                Browse Pinit Hub
              </a>
            ) : null}
            {/* No "Become a Creator" here. canPurchase() is false for guests, so
                this only ever showed to a signed-in buyer — pushing them to switch
                account type on the page they came to shop on. Buyers who do want
                to sell still have "Sell on Exchange" in the account menu. */}
            {!user && (
              <button type="button" className="btn-secondary" style={{ padding: '12px 24px', fontSize: '1rem' }} onClick={onOpenListFromHub}>
                Sell on Exchange
              </button>
            )}
          </div>
        </div>
        <DiscoverHeroArt />
      </div>

      <div id="browse-section" style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px',
          marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          {VERTICALS.filter((v) => v.id !== 'mine' || canList(user)).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedVertical(v.id)}
              style={{
                padding: '8px 18px', borderRadius: 'var(--radius-full)', fontSize: '0.88rem', fontWeight: 600,
                border: selectedVertical === v.id ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                background: selectedVertical === v.id ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
                color: selectedVertical === v.id ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {v.name}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '10px', flex: 1, minWidth: '300px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search title, tagline, tags, Asset ID, or listing ID…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '40px' }}
              />
            </div>
            <button type="submit" className="btn-secondary">Search</button>
          </form>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Filter size={16} color="var(--text-muted)" />
              <select className="form-select" value={selectedBadge} onChange={(e) => setSelectedBadge(e.target.value)} style={{ width: 'auto', minWidth: '180px' }}>
                <option value="all">All Authenticity Badges</option>
                <option value="Gold">Gold Badge</option>
                <option value="Silver">Silver Badge</option>
                <option value="Bronze">Bronze Badge</option>
              </select>
            </div>
            <select className="form-select" value={sortOption} onChange={(e) => setSortOption(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
              <option value="newest">Newest Listings</option>
              <option value="popular">Most Viewed</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="listing-grid" aria-busy="true" aria-label="Loading listings">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="listing-card listing-card--skeleton" aria-hidden="true">
              <div className="sk sk-media" />
              <div className="sk sk-line sk-line--title" />
              <div className="sk sk-line sk-line--meta" />
              <div className="sk sk-line sk-line--price" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<ShieldCheck size={36} color="var(--danger, #c0392b)" />}
          title="Couldn't load the marketplace"
          description={`${loadError} This is a connection problem, not an empty catalogue.`}
          primaryLabel="Try again"
          onPrimary={fetchListings}
        />
      ) : visibleListings.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={36} color="var(--primary)" />}
          title="No listings in this view"
          description={
            selectedVertical === 'mine'
              ? 'Your protected assets can become licenses on Pinit Exchange.'
              : 'Try another category, clear filters, or list a protected asset.'
          }
          primaryLabel={selectedVertical === 'mine' && canList(user) ? 'List an asset' : 'Show all categories'}
          onPrimary={() => {
            if (selectedVertical === 'mine' && canList(user)) onOpenListFromHub?.();
            else setSelectedVertical('all');
          }}
          secondaryLabel="Open Pinit HUB"
          onSecondary={() => window.open((import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000'), '_blank')}
        />
      ) : (
        <div className="listing-grid">
          {visibleListings.map((item) => (
            <div key={item.listing_id} style={{ position: 'relative' }}>
              {isOwner(item) && canList(user) && (
                <button
                  type="button"
                  className="card-edit-btn"
                  style={{ zIndex: 5 }}
                  title="Edit listing"
                  onClick={(e) => openEdit(e, item)}
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
              <ListingCard
                item={item}
                user={user}
                onSelect={onSelectListing}
                onAddToCart={async (listing) => {
                  if (user && !canPurchase(user)) return;
                  const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer') || `GUEST-${Date.now()}`;
                  if (!localStorage.getItem('pinit_guest_buyer') && !user) {
                    localStorage.setItem('pinit_guest_buyer', key);
                  }
                  const { ok } = await apiFetch('/api/commerce/cart', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      buyer_key: key,
                      listing_id: listing.listing_id,
                      license_tier: 'commercial',
                    }),
                  });
                  if (ok) onCartChanged?.();
                }}
                onWishlist={async (listing) => {
                  const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer') || `GUEST-${Date.now()}`;
                  if (!localStorage.getItem('pinit_guest_buyer') && !user) {
                    localStorage.setItem('pinit_guest_buyer', key);
                  }
                  await apiFetch('/api/commerce/wishlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ buyer_key: key, listing_id: listing.listing_id }),
                  });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {!loading && !loadError && visibleListings.length > 0 && (
        <div className="marketplace-more">
          <p className="marketplace-more__count">
            Showing {visibleListings.length}{total ? ` of ${total}` : ''} listing{total === 1 ? '' : 's'}
          </p>
          {hasMore && (
            <button
              type="button"
              className="btn-secondary"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)} role="presentation">
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <div>
                <h3 style={{ color: '#fff', fontSize: '1.2rem' }}>Edit listing</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Update title, tagline, tags, and prices — stock-agency style.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label className="form-label">Title
                <input className="form-input" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} required />
              </label>
              <label className="form-label">Tagline
                <input className="form-input" value={editForm.tagline} onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value })} placeholder="One punchy line buyers see on the card" maxLength={120} />
              </label>
              <label className="form-label">Tags / keywords
                <input className="form-input" value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} placeholder="cinematic, drone, golden-hour, 8k" />
              </label>
              <label className="form-label">Description
                <textarea className="form-textarea" rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </label>
              <label className="form-label">Category
                <select className="form-select" value={editForm.vertical} onChange={(e) => setEditForm({ ...editForm, vertical: e.target.value })}>
                  {VERTICALS.filter((v) => v.id !== 'all' && v.id !== 'mine').map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {['price_personal', 'price_commercial', 'price_exclusive', 'price_enterprise'].map((key) => (
                  <label key={key} className="form-label" style={{ textTransform: 'capitalize' }}>
                    {key.replace('price_', '').replace('_', ' ')}
                    <input type="number" className="form-input" value={editForm[key]} onChange={(e) => setEditForm({ ...editForm, [key]: Number(e.target.value) })} />
                  </label>
                ))}
              </div>
              {editError && <div style={{ color: '#f87171', fontSize: '0.88rem' }}>{editError}</div>}
              <div className="modal-footer" style={{ marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : <><Check size={16} /> Save changes</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
