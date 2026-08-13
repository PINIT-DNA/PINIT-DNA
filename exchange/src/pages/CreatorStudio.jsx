import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, Layers, Images, BadgeCheck, Play } from 'lucide-react';
import { isVideoListing } from '../lib/media.js';

function listingPreviewUrl(item) {
  const url = String(item?.preview_url || '');
  if (url && !url.includes('unsplash.com')) return url;
  const id = String(item?.asset_id || '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return `/api/hub/preview/${id}`;
  }
  return '';
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function statusLabel(item) {
  const s = String(item?.status || '').toLowerCase();
  if (s === 'published' || s === 'live') return 'Listed';
  if (s === 'sold_exclusive') return 'Sold';
  if (s === 'draft' || s === 'unlisted') return 'Draft';
  return s || 'Draft';
}

export default function CreatorStudio({ user, onNavigate, onSelectListing }) {
  const [desk, setDesk] = useState(null);
  const [loading, setLoading] = useState(true);
  const name = user?.display_name || user?.name || 'Creator';

  useEffect(() => {
    if (!user?.pinit_id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/creator/desk?pinit_id=${encodeURIComponent(user.pinit_id)}`, {
          headers: { 'X-Pinit-Id': user.pinit_id },
        });
        if (res.ok) setDesk(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.pinit_id]);

  const listings = desk?.listings || [];
  const sales = desk?.sealed_sales || [];
  const metrics = desk?.metrics || {};
  const topAssets = useMemo(
    () => [...listings].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3),
    [listings],
  );

  if (loading) {
    return <div style={{ padding: 48, color: 'var(--text-muted)', textAlign: 'center' }}>Loading your listings…</div>;
  }

  return (
    <div className="studio-home">
      <div className="studio-home__intro">
        <h1>{greeting()}, {name}</h1>
        <p>Your listings, sales and earnings on Pinit Exchange — the same marketplace buyers browse.</p>
      </div>

      <div className="studio-kpi">
        <div className="glass-panel studio-kpi__card">
          <span>Total sales</span>
          <DollarSign size={18} color="var(--emerald)" />
          <strong>${Number(metrics.total_gross_revenue || 0).toFixed(0)}</strong>
          <em>{metrics.sealed_sales_count || 0} licenses sold</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Earnings</span>
          <DollarSign size={18} color="var(--emerald)" />
          <strong>${Number(metrics.total_net_revenue || 0).toFixed(0)}</strong>
          <em>Creator net after fees</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Assets</span>
          <Images size={18} color="var(--primary)" />
          <strong>{listings.length}</strong>
          <em>Protected files listed</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Active listings</span>
          <Layers size={18} color="var(--primary)" />
          <strong>{metrics.active_listings_count || 0}</strong>
          <em>Live for buyers</em>
        </div>
      </div>

      <section className="studio-section">
        <div className="studio-section__head">
          <h2>Your assets</h2>
          <button type="button" className="btn-secondary" onClick={() => onNavigate('seller_assets')}>View all</button>
        </div>
        <div className="studio-assets">
          {listings.length === 0 && (
            <p className="studio-empty">No assets listed yet. Add a protected Hub file to start selling.</p>
          )}
          {listings.slice(0, 8).map((item) => {
            const preview = listingPreviewUrl(item);
            const video = isVideoListing(item);
            return (
              <button
                key={item.listing_id}
                type="button"
                className="studio-asset"
                onClick={() => onSelectListing?.(item.listing_id)}
              >
                <div className="studio-asset__media">
                  {preview ? (
                    video ? <video src={preview} muted playsInline preload="metadata" /> : <img src={preview} alt="" />
                  ) : <div className="studio-asset__ph">{video ? <Play size={18} /> : 'Preview'}</div>}
                </div>
                <strong>{item.title}</strong>
                <span>
                  <BadgeCheck size={11} /> DNA verified · {statusLabel(item)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="studio-split">
        <section className="glass-panel studio-section">
          <div className="studio-section__head">
            <h2>Recent sales</h2>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('seller_sales')}>Ledger</button>
          </div>
          {sales.length === 0 ? (
            <p className="studio-empty">No sealed sales yet.</p>
          ) : (
            <table className="studio-table">
              <thead>
                <tr><th>Asset</th><th>License</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {sales.slice(0, 6).map((s) => (
                  <tr key={s.seal_id}>
                    <td>{s.listing_title || s.asset_id || s.listing_id}</td>
                    <td style={{ textTransform: 'capitalize' }}>{s.license_tier}</td>
                    <td>${s.price_paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="glass-panel studio-section">
          <div className="studio-section__head">
            <h2>Recent activity</h2>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('seller_analytics')}>Analytics</button>
          </div>
          <ul className="studio-activity">
            {listings.filter((l) => l.status === 'published' || l.status === 'live').slice(0, 3).map((l) => (
              <li key={`p-${l.listing_id}`}>✓ Listing published — {l.title}</li>
            ))}
            {sales.slice(0, 2).map((s) => (
              <li key={s.seal_id}>✓ Asset purchased — {s.license_tier} ${s.price_paid}</li>
            ))}
            {sales.slice(0, 1).map((s) => (
              <li key={`d-${s.seal_id}`}>✓ Secure delivery completed</li>
            ))}
            {topAssets[0] && <li>★ Top asset this period — {topAssets[0].title} ({topAssets[0].views || 0} views)</li>}
            {listings.length === 0 && <li>⚠ List a protected asset to go live</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
