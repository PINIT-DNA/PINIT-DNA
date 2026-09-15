import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';
import { buyerKey } from '../../lib/buyer.js';

export default function BuyerNotifications({ user, onNavigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const notes = [];
      const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer');
      if (user?.pinit_id) {
        // Scoped to the signed-in session server-side; no identity in the query.
        const licRes = await apiFetch('/api/orders/my-licenses');
        const licenses = licRes.ok ? licRes.data : null;
        (licenses?.licenses || []).slice(0, 8).forEach((row) => {
          notes.push({
            id: row.seal_id || row.listing_id,
            title: 'License sealed',
            body: row.asset_title || row.listing_id || 'Purchase complete',
            at: row.sealed_at || row.created_at,
            page: 'my_licenses',
          });
        });
        const mine = await apiFetch(`/api/commerce/reviews/mine?pinit_id=${encodeURIComponent(user.pinit_id)}`);
        if (mine.ok) {
          (mine.data.reviews || []).slice(0, 5).forEach((row) => {
            notes.push({
              id: `rev-${row.id}`,
              title: 'Your review',
              body: row.listing_title || row.listing_id,
              at: row.created_at,
              page: 'my_licenses',
            });
          });
        }
      }
      if (key) {
        const wish = await apiFetch(`/api/commerce/wishlist?buyer_key=${encodeURIComponent(key)}`);
        if (wish.ok && (wish.data.items || []).length) {
          notes.push({
            id: 'wishlist',
            title: 'Saved assets',
            body: `${wish.data.items.length} assets on your wishlist`,
            at: new Date().toISOString(),
            page: 'wishlist',
          });
        }
      }
      setItems(notes);
      setLoading(false);
    })();
  }, [user?.pinit_id, user?.email]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading notifications…</div>;
  }

  return (
    <StudioPage
      title="Notifications"
      subtitle="Purchases, saved assets, and review activity for your buyer account."
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} color="var(--primary)" />}
          title="You're all caught up"
          description="License activity and saved assets will show here."
          primaryLabel="Browse marketplace"
          onPrimary={() => onNavigate?.('marketplace')}
        />
      ) : (
        <ul className="studio-activity">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="studio-link" onClick={() => onNavigate?.(item.page)}>
                <strong>{item.title}</strong> — {item.body}
              </button>
            </li>
          ))}
        </ul>
      )}
    </StudioPage>
  );
}
