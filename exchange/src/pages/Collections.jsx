import { formatMoney } from '../lib/money.js';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import HubTrustBadge from '../components/HubTrustBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { apiFetch, verticalLabel, unwrapList } from '../lib/api.js';

export default function Collections({ onSelectListing, onNavigateMarketplace }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Collections group the whole catalogue, so ask for the maximum page.
      const { ok, data, headers } = await apiFetch('/api/listings?vertical=all&badge=all&sort=newest&limit=60');
      setListings(ok ? unwrapList(data, headers).items : []);
      setLoading(false);
    })();
  }, []);

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of listings) {
      const key = item.vertical || 'concepts';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()].map(([id, items]) => {
      const prices = items.map((i) => Number(i.price_personal || i.price_commercial || 0));
      return {
        id,
        title: verticalLabel(id),
        count: items.length,
        from: prices.length ? Math.min(...prices) : 0,
        img: items[0]?.preview_url,
        items,
      };
    });
  }, [listings]);

  return (
    <div className="ex-page">
      <div className="ex-head">
        <h1 className="ex-h1">Collections</h1>
        <p className="ex-sub">Everything listed on Exchange, grouped by category.</p>
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
      ) : groups.length === 0 ? (
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
              aria-label={`${c.title} — ${c.count} assets, from ${formatMoney(c.from)}`}
              onClick={() => {
                if (c.items[0]?.listing_id) onSelectListing?.(c.items[0].listing_id);
                else onNavigateMarketplace?.();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (c.items[0]?.listing_id) onSelectListing?.(c.items[0].listing_id);
                  else onNavigateMarketplace?.();
                }
              }}
            >
              {/* Real protected previews, not decorative art: the first asset in
                  the group stands for the collection. */}
              <div className="collection-tile__art">
                {c.img ? (
                  <img
                    src={c.img}
                    alt=""
                    className="pinit-protected-media"
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                ) : (
                  <div className="collection-tile__art-empty"><Layers size={22} /></div>
                )}
              </div>

              <div className="collection-tile__caption">
                <h3 className="collection-tile__title">{c.title}</h3>
                <div className="collection-tile__meta">
                  <span>{c.count} asset{c.count === 1 ? '' : 's'}</span>
                  <span className="collection-tile__price">from {formatMoney(c.from)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
