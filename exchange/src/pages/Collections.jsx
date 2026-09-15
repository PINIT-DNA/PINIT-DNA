import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Layers, Heart, Sparkles, Clock, AlertCircle } from 'lucide-react';
import { formatMoney } from '../lib/money.js';
import HubTrustBadge from '../components/HubTrustBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { apiFetch, verticalLabel, unwrapList } from '../lib/api.js';
import { buyerKey } from '../lib/buyer.js';
import { recentlyViewedIds, clearRecentlyViewed } from '../lib/recently-viewed.js';

const TABS = [
  { id: 'categories', label: 'Categories', icon: Layers },
  { id: 'curated', label: 'Curated', icon: Sparkles },
  { id: 'saved', label: 'Saved', icon: Heart },
  { id: 'recent', label: 'Recently viewed', icon: Clock },
];

export default function Collections({ onSelectListing, onNavigateMarketplace, onBrowseVertical, user }) {
  const [tab, setTab] = useState('categories');
  const [listings, setListings] = useState([]);
  const [curated, setCurated] = useState([]);
  const [saved, setSaved] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed request and an empty catalogue are different things. This page
  // used to set an empty list on any failure, so a stopped backend rendered
  // "No collections yet" — telling the customer the shop was empty when it
  // was simply unreachable.
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    const all = await apiFetch('/api/listings?vertical=all&badge=all&sort=newest&limit=60');
    if (!all.ok) {
      setLoadError(all.error || 'Could not reach the marketplace.');
      setListings([]);
      setLoading(false);
      return;
    }
    const items = unwrapList(all.data, all.headers).items;
    setListings(items);

    // Curated = Gold-badged work. A real signal already on the listing record,
    // not a hand-picked or invented set.
    setCurated(items.filter((l) => String(l.badge_tier || '').toLowerCase() === 'gold'));

    // Saved = the buyer's existing wishlist. No new storage, no new endpoint.
    const key = buyerKey(user);
    if (key) {
      const w = await apiFetch(`/api/commerce/wishlist?buyer_key=${encodeURIComponent(key)}`);
      const rows = Array.isArray(w.data?.items) ? w.data.items : [];
      setSaved(rows.map((r) => r.listing).filter(Boolean));
    } else {
      setSaved([]);
    }

    // Recently viewed = device-local ids, re-hydrated from the live catalogue
    // so a delisted or repriced asset is never rendered from a stale copy.
    const ids = recentlyViewedIds();
    const byId = new Map(items.map((l) => [l.listing_id, l]));
    setRecent(ids.map((id) => byId.get(id)).filter(Boolean));

    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of listings) {
      const key = item.vertical || 'concepts';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()].map(([id, items]) => {
      const prices = items
        .map((i) => Number(i.price_personal || i.price_commercial || 0))
        .filter((n) => Number.isFinite(n) && n > 0);
      return {
        id,
        title: verticalLabel(id),
        count: items.length,
        from: prices.length ? Math.min(...prices) : 0,
        img: items[0]?.preview_url,
      };
    });
  }, [listings]);

  const tabCount = (id) => {
    if (id === 'categories') return groups.length;
    if (id === 'curated') return curated.length;
    if (id === 'saved') return saved.length;
    return recent.length;
  };

  const AssetGrid = ({ items, emptyNode }) => {
    if (items.length === 0) return emptyNode;
    return (
      <div className="collections-assets">
        {items.map((l) => (
          <button
            key={l.listing_id}
            type="button"
            className="listing-tile collection-asset"
            onClick={() => onSelectListing?.(l.listing_id)}
          >
            {l.preview_url
              ? <img className="card-media" src={l.preview_url} alt="" draggable={false} />
              : <span className="collection-asset__noimg" aria-hidden="true" />}
            <span className="collection-asset__meta">
              <strong>{l.title}</strong>
              <em>{Number(l.price_personal || l.price_commercial || 0) > 0
                ? `from ${formatMoney(Number(l.price_personal || l.price_commercial))}`
                : 'Pricing on request'}</em>
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="ex-page">
      <div className="ex-head">
        <h1 className="ex-h1">Collections</h1>
        <p className="ex-sub">Everything listed on Exchange, grouped by category — plus what you saved and viewed.</p>
      </div>

      <div className="asset-tabs" role="tablist" aria-label="Collections views">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`asset-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} /> {t.label}
              {!loading && !loadError && tabCount(t.id) > 0 && (
                <span className="asset-tab__count">{tabCount(t.id)}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="collections-grid" aria-busy="true" aria-label="Loading collections">
          {Array.from({ length: 3 }).map((_, i) => (
            <article key={i} className="ex-card" style={{ overflow: 'hidden' }} aria-hidden="true">
              <div className="ex-skel" style={{ height: 150, borderRadius: 0 }} />
              <div style={{ padding: 16 }}>
                <div className="ex-skel ex-skel--line" style={{ width: '44%' }} />
                <div className="ex-skel ex-skel--line" style={{ width: '30%' }} />
              </div>
            </article>
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<AlertCircle size={30} color="var(--danger, #c0392b)" />}
          title="Couldn't load collections"
          description={`${loadError} This is a connection problem, not an empty catalogue.`}
          primaryLabel="Try again"
          onPrimary={load}
          secondaryLabel="Browse marketplace"
          onSecondary={() => onNavigateMarketplace?.()}
        />
      ) : tab === 'categories' ? (
        groups.length === 0 ? (
          <EmptyState
            icon={<Layers size={28} color="var(--primary)" />}
            title="No collections yet"
            description="When creators list Hub-protected assets, they appear here by category."
            primaryLabel="Browse marketplace"
            onPrimary={() => onNavigateMarketplace?.()}
          />
        ) : (
          <div className="collections-grid">
            {groups.map((c) => (
              <article
                key={c.id}
                className="collection-tile"
                tabIndex={0}
                role="link"
                aria-label={`${c.title} — ${c.count} ${c.count === 1 ? 'asset' : 'assets'}${c.from > 0 ? `, from ${formatMoney(c.from)}` : ''}`}
                // Opens the category, not the first asset in it. This used to
                // call onSelectListing(items[0]) — so a tile labelled
                // "2 assets" opened a single asset detail page.
                onClick={() => onBrowseVertical?.(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBrowseVertical?.(c.id); }
                }}
              >
                {c.img
                  ? <img className="collection-tile__img" src={c.img} alt="" draggable={false} />
                  : <span className="collection-tile__img collection-tile__img--empty" aria-hidden="true" />}
                <div className="collection-tile__body">
                  <h3>{c.title}</h3>
                  <p>
                    <span>{c.count} {c.count === 1 ? 'asset' : 'assets'}</span>
                    {c.from > 0 && <span className="collection-tile__price">from {formatMoney(c.from)}</span>}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )
      ) : tab === 'curated' ? (
        <AssetGrid
          items={curated}
          emptyNode={(
            <EmptyState
              icon={<Sparkles size={28} color="var(--primary)" />}
              title="No Gold-verified assets yet"
              description="Curated shows work that carries a Gold authenticity badge from Pinit HUB."
              primaryLabel="Browse marketplace"
              onPrimary={() => onNavigateMarketplace?.()}
            />
          )}
        />
      ) : tab === 'saved' ? (
        <AssetGrid
          items={saved}
          emptyNode={(
            <EmptyState
              icon={<Heart size={28} color="var(--primary)" />}
              title="Nothing saved yet"
              description="Assets you add to your wishlist appear here."
              primaryLabel="Browse marketplace"
              onPrimary={() => onNavigateMarketplace?.()}
            />
          )}
        />
      ) : (
        <>
          {recent.length > 0 && (
            <p className="collections-note">
              Kept on this device only.
              <button
                type="button"
                className="collections-note__clear"
                onClick={() => { clearRecentlyViewed(); load(); }}
              >
                Clear history
              </button>
            </p>
          )}
          <AssetGrid
            items={recent}
            emptyNode={(
              <EmptyState
                icon={<Clock size={28} color="var(--primary)" />}
                title="No recently viewed assets"
                description="Assets you open appear here, kept on this device only."
                primaryLabel="Browse marketplace"
                onPrimary={() => onNavigateMarketplace?.()}
              />
            )}
          />
        </>
      )}

      {!loading && !loadError && (
        <div className="collections-foot">
          <HubTrustBadge />
          <button type="button" className="ex-btn ex-btn--secondary" onClick={() => onNavigateMarketplace?.()}>
            Browse the full marketplace <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
