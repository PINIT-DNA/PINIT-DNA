import React, { useMemo } from 'react';
import { LineChart, Eye, Bookmark } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { listingPreviewUrl } from '../../lib/listing-preview.js';

export default function SellerAnalytics({ user, onSelectListing }) {
  const { listings, sales, metrics, loading } = useSellerDesk(user);

  const top = useMemo(
    () => [...listings].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8),
    [listings],
  );

  const conversion = useMemo(() => {
    const views = Number(metrics.total_views || 0);
    const sold = Number(metrics.sealed_sales_count || 0);
    if (!views) return 0;
    return Math.round((sold / views) * 1000) / 10;
  }, [metrics]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading analytics…</div>;
  }

  return (
    <StudioPage
      title="Analytics"
      subtitle="Performance for your listings only — not marketplace Discover traffic."
    >
      <div className="studio-kpi">
        <div className="glass-panel studio-kpi__card">
          <span>Views</span>
          <Eye size={18} color="var(--primary)" />
          <strong>{metrics.total_views || 0}</strong>
          <em>Across your listings</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Saves</span>
          <Bookmark size={18} color="var(--primary)" />
          <strong>{metrics.total_saves || 0}</strong>
          <em>Buyer wishlists</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Conversion</span>
          <LineChart size={18} color="var(--emerald)" />
          <strong>{conversion}%</strong>
          <em>{sales.length} licenses / {metrics.total_views || 0} views</em>
        </div>
      </div>

      <div className="studio-section">
        <div className="studio-section__head">
          <h2>Top assets</h2>
        </div>
        {top.length === 0 ? (
          <p className="studio-empty">List an asset to start tracking views.</p>
        ) : (
          <div className="glass-panel" style={{ padding: 8, overflowX: 'auto' }}>
            <table className="studio-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Views</th>
                  <th>Saves</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {top.map((item) => (
                  <tr key={item.listing_id}>
                    <td>
                      <button type="button" className="studio-link" onClick={() => onSelectListing?.(item.listing_id)}>
                        {listingPreviewUrl(item) ? <img src={listingPreviewUrl(item)} alt="" className="studio-mini" /> : null}
                        {item.title}
                      </button>
                    </td>
                    <td>{item.views || 0}</td>
                    <td>{item.saves || 0}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </StudioPage>
  );
}
