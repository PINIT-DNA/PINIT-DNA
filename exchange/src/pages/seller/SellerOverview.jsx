import React from 'react';
import { ArrowRight, Images, ListTree, BadgeDollarSign, Briefcase } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { formatMoney } from '../../lib/money.js';
import { listingTitleMap } from '../../lib/seller-workspace.js';

export default function SellerOverview({ user, onNavigate, onOpenListFromHub }) {
  const { metrics, sales, listings, loading } = useSellerDesk(user);
  const titles = listingTitleMap(listings);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading seller overview…</div>;
  }

  return (
    <StudioPage
      title="Overview"
      subtitle="Selling on Exchange. Protection, certificates and full asset history stay in Pinit HUB."
      actions={(
        <button type="button" className="btn-primary" onClick={onOpenListFromHub}>
          List from Pinit HUB
        </button>
      )}
    >
      <div className="studio-kpi">
        <button type="button" className="glass-panel studio-kpi__card" onClick={() => onNavigate?.('seller_earnings')}>
          <span>Revenue</span>
          <strong>{formatMoney(metrics.total_net_revenue || 0)}</strong>
          <em>Creator net</em>
        </button>
        <button type="button" className="glass-panel studio-kpi__card" onClick={() => onNavigate?.('seller_sales')}>
          <span>Orders</span>
          <strong>{metrics.sealed_sales_count || 0}</strong>
          <em>Sealed licenses</em>
        </button>
        <button type="button" className="glass-panel studio-kpi__card" onClick={() => onNavigate?.('seller_listings')}>
          <span>Live listings</span>
          <strong>{metrics.active_listings_count || 0}</strong>
          <em>{listings.length} total offers</em>
        </button>
        <button type="button" className="glass-panel studio-kpi__card" onClick={() => onNavigate?.('seller_sales')}>
          <span>Listing views</span>
          <strong>{metrics.total_views || 0}</strong>
          <em>{metrics.total_saves || 0} saves</em>
        </button>
      </div>

      <div className="seller-overview-grid">
        <section className="glass-panel seller-panel">
          <div className="studio-section__head">
            <h2>Recent sales</h2>
            <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_sales')}>
              Open Sales <ArrowRight size={14} />
            </button>
          </div>
          {sales.length === 0 ? (
            <p className="studio-empty">No sealed licenses yet. Publish a listing to start selling.</p>
          ) : (
            <ul className="studio-activity">
              {sales.slice(0, 6).map((row) => (
                <li key={row.seal_id}>
                  {titles.get(row.listing_id) || row.listing_id} · {row.buyer_pinit_id || 'Buyer'} · {formatMoney(row.price_paid || 0, row.currency)}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="glass-panel seller-panel">
          <h2>Jump to</h2>
          <div className="seller-jump">
            <button type="button" onClick={() => onNavigate?.('seller_assets')}><Images size={16} /> Assets</button>
            <button type="button" onClick={() => onNavigate?.('seller_listings')}><ListTree size={16} /> Listings</button>
            <button type="button" onClick={() => onNavigate?.('seller_opportunities')}><Briefcase size={16} /> Opportunities</button>
            <button type="button" onClick={() => onNavigate?.('seller_earnings')}><BadgeDollarSign size={16} /> Earnings</button>
          </div>
        </section>
      </div>
    </StudioPage>
  );
}
