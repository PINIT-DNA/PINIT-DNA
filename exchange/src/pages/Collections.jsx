import { formatFrom } from '../lib/money.js';
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
      const { ok, data } = await apiFetch('/api/listings?vertical=all&badge=all&sort=newest&limit=60');
      setListings(ok ? unwrapList(data).items : []);
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
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ color: '#fff', fontSize: '2rem', marginBottom: 8 }}>Collections</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Live marketplace inventory grouped by category. No sample or duplicate catalog.
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading collections…</div>
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
            <article key={c.id} className="glass-panel collection-card">
              <div className="collection-card__media">
                {c.img ? <img src={c.img} alt={c.title} /> : null}
              </div>
              <div className="collection-card__body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)', marginBottom: 8 }}>
                  <Layers size={16} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{c.count} verified asset{c.count === 1 ? '' : 's'}</span>
                </div>
                <h3 style={{ color: '#fff', marginBottom: 6 }}>{c.title}</h3>
                <div style={{ color: 'var(--emerald)', fontWeight: 700, marginBottom: 12 }}>{formatFrom(c.from)}</div>
                <HubTrustBadge compact />
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: '100%', marginTop: 14 }}
                  onClick={() => {
                    if (c.items[0]?.listing_id) onSelectListing?.(c.items[0].listing_id);
                    else onNavigateMarketplace?.();
                  }}
                >
                  View collection <ArrowRight size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
