import React, { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';

export default function SellerReviews({ user, onSelectListing }) {
  const [reviews, setReviews] = useState([]);
  const [average, setAverage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.pinit_id) return;
    (async () => {
      setLoading(true);
      const { ok, data } = await apiFetch(
        `/api/commerce/reviews/seller?pinit_id=${encodeURIComponent(user.pinit_id)}`,
      );
      setReviews(ok ? (data.reviews || []) : []);
      setAverage(ok ? Number(data.average || 0) : 0);
      setLoading(false);
    })();
  }, [user?.pinit_id]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading reviews…</div>;
  }

  return (
    <StudioPage
      title="Reviews"
      subtitle={`Buyer feedback on your listings${reviews.length ? ` · ${average.toFixed(1)} average` : ''}.`}
    >
      {reviews.length === 0 ? (
        <EmptyState
          icon={<Star size={32} color="var(--primary)" />}
          title="No reviews yet"
          description="Reviews appear after buyers license your work and leave feedback."
        />
      ) : (
        <div className="studio-reviews">
          {reviews.map((row) => (
            <article key={row.id} className="glass-panel studio-review">
              <div className="studio-review__top">
                <strong>{row.listing_title || row.listing_id}</strong>
                <span><Star size={13} fill="currentColor" /> {row.rating}/5</span>
              </div>
              <p>{row.comment || 'No written comment.'}</p>
              <div className="studio-review__meta">
                {row.buyer_name || 'Buyer'} · {row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}
                {row.listing_id && onSelectListing ? (
                  <button type="button" className="btn-secondary" onClick={() => onSelectListing(row.listing_id)}>
                    View listing
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </StudioPage>
  );
}
