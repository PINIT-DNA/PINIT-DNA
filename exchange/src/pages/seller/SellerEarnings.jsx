import React from 'react';
import { Wallet } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { formatMoney } from '../../lib/money.js';

export default function SellerEarnings({ user, onNavigate }) {
  const { metrics, sales, loading } = useSellerDesk(user);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading earnings…</div>;
  }

  return (
    <StudioPage
      title="Earnings"
      subtitle="Creator net after Exchange fees. Withdrawals are not enabled yet — these balances are accrued and will be payable once payouts go live."
    >
      <div className="studio-kpi">
        <div className="glass-panel studio-kpi__card">
          <span>Gross sales</span>
          <Wallet size={18} color="var(--emerald)" />
          <strong>{formatMoney(metrics.total_gross_revenue || 0)}</strong>
          <em>{metrics.sealed_sales_count || 0} sealed licenses</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Creator net</span>
          <Wallet size={18} color="var(--emerald)" />
          <strong>{formatMoney(metrics.total_net_revenue || 0)}</strong>
          <em>After platform fee</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Payout pending</span>
          <Wallet size={18} color="var(--primary)" />
          <strong>{formatMoney(metrics.payout_pending || 0)}</strong>
          <em>Settles through the payment provider</em>
        </div>
      </div>

      <div className="studio-section">
        <div className="studio-section__head">
          <h2>Recent payouts</h2>
          <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_sales')}>View sales</button>
        </div>
        {sales.length === 0 ? (
          <p className="studio-empty">No earnings yet. Publish a listing to start licensing.</p>
        ) : (
          <ul className="studio-activity">
            {sales.slice(0, 8).map((row) => (
              <li key={row.seal_id}>
                +{formatMoney(row.creator_net || 0, row.currency)} net · {row.license_tier || 'license'} · {row.sealed_at ? new Date(row.sealed_at).toLocaleDateString() : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </StudioPage>
  );
}
