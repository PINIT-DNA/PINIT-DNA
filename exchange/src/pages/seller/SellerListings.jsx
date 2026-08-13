import React, { useState } from 'react';
import { ListTree, PlusCircle, Play, Images } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';
import { listingPreviewUrl, listingStatusLabel, isListed } from '../../lib/listing-preview.js';
import { isVideoListing } from '../../lib/media.js';
import useSellerDesk from '../../hooks/useSellerDesk.js';

export default function SellerListings({ user, onOpenListFromHub, onSelectListing, onNavigate }) {
  const { listings, loading, refresh } = useSellerDesk(user);
  const [busyId, setBusyId] = useState('');
  const [filter, setFilter] = useState('all');

  const visible = listings.filter((row) => {
    if (filter === 'listed') return isListed(row);
    if (filter === 'unlisted') return !isListed(row);
    return true;
  });

  const setStatus = async (listing, status) => {
    setBusyId(listing.listing_id);
    await apiFetch(`/api/listings/${encodeURIComponent(listing.listing_id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, pinit_id: user.pinit_id }),
    });
    setBusyId('');
    refresh();
  };

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading listings…</div>;
  }

  return (
    <StudioPage
      title="Listings"
      subtitle="Published marketplace offers. Drafts stay off Discover until you publish."
      actions={(
        <button type="button" className="btn-primary" onClick={onOpenListFromHub}>
          <PlusCircle size={16} /> New listing
        </button>
      )}
    >
      <div className="studio-mod__filters">
        {[
          ['all', 'All'],
          ['listed', 'Published'],
          ['unlisted', 'Unlisted'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`home-chip ${filter === id ? 'creators-chip--active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListTree size={32} color="var(--primary)" />}
          title="No listings in this view"
          description="List a protected Hub asset when you are ready to sell. Marketplace Discover stays separate."
          primaryLabel="List from Hub"
          onPrimary={onOpenListFromHub}
        />
      ) : (
        <div className="studio-list">
          {visible.map((item) => {
            const preview = listingPreviewUrl(item);
            const video = isVideoListing(item);
            const listed = isListed(item);
            return (
              <article key={item.listing_id} className="glass-panel studio-list__row">
                <button type="button" className="studio-list__thumb" onClick={() => onSelectListing?.(item.listing_id)}>
                  {preview ? (
                    video ? <video src={preview} muted playsInline /> : <img src={preview} alt="" />
                  ) : (
                    <span>{video ? <Play size={18} /> : <Images size={18} />}</span>
                  )}
                </button>
                <div className="studio-list__meta">
                  <strong>{item.title}</strong>
                  <span>{item.listing_id} · {listingStatusLabel(item)} · {item.views || 0} views</span>
                </div>
                <div className="studio-list__price">${Number(item.price_personal || item.price_commercial || 0).toFixed(0)}</div>
                <div className="studio-list__actions">
                  <button type="button" className="btn-secondary" onClick={() => onSelectListing?.(item.listing_id)}>
                    View
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_analytics')}>
                    Analytics
                  </button>
                  {listed ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyId === item.listing_id}
                      onClick={() => setStatus(item, 'unlisted')}
                    >
                      Unlist
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busyId === item.listing_id}
                      onClick={() => setStatus(item, 'published')}
                    >
                      Publish
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </StudioPage>
  );
}
