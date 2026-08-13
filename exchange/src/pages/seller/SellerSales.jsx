import React from 'react';
import { BadgeDollarSign, Receipt } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';

export default function SellerSales({ user, mode = 'sales' }) {
  const { sales, loading } = useSellerDesk(user);
  const orders = mode === 'orders';

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading {orders ? 'orders' : 'sales'}…</div>;
  }

  return (
    <StudioPage
      title={orders ? 'Orders' : 'Sales'}
      subtitle={orders
        ? 'Sealed license orders for your listings. Delivery stays with the buyer after purchase.'
        : 'Completed licenses on your assets. Creators cannot purchase on Exchange.'}
    >
      {sales.length === 0 ? (
        <EmptyState
          icon={orders ? <Receipt size={32} color="var(--primary)" /> : <BadgeDollarSign size={32} color="var(--primary)" />}
          title={orders ? 'No orders yet' : 'No sales yet'}
          description="When a buyer licenses your work, the sealed sale appears here with payout details."
        />
      ) : (
        <div className="glass-panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="studio-table">
            <thead>
              <tr>
                <th>Seal</th>
                <th>Listing</th>
                <th>License</th>
                <th>Paid</th>
                <th>Your net</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((row) => (
                <tr key={row.seal_id || row.id}>
                  <td>{row.seal_id || '—'}</td>
                  <td>{row.listing_id || row.asset_id || '—'}</td>
                  <td>{row.license_tier || 'commercial'}</td>
                  <td>${Number(row.price_paid || 0).toFixed(2)}</td>
                  <td>${Number(row.creator_net || 0).toFixed(2)}</td>
                  <td>{row.sealed_at ? new Date(row.sealed_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StudioPage>
  );
}
