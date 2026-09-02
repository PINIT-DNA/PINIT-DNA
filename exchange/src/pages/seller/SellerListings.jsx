import React, { useState } from 'react';
import { ListTree, PlusCircle } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';
import { listingPreviewUrl, listingStatusLabel, isListed } from '../../lib/listing-preview.js';
import { isVideoListing } from '../../lib/media.js';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { formatMoney } from '../../lib/money.js';

function ListingThumb({ item, onOpen }) {
  const preview = listingPreviewUrl(item);
  const video = isVideoListing(item);
  const [failed, setFailed] = useState(false);
  const letter = String(item.title || 'P').trim().charAt(0).toUpperCase() || 'P';

  return (
    <button type="button" className="studio-list__thumb" onClick={() => onOpen?.(item.listing_id)} aria-label={`Open ${item.title}`}>
      {preview && !failed ? (
        video ? (
          <video src={preview} muted playsInline onError={() => setFailed(true)} />
        ) : (
          <img src={preview} alt="" onError={() => setFailed(true)} />
        )
      ) : (
        <span className="studio-list__ph" aria-hidden>{letter}</span>
      )}
    </button>
  );
}

export default function SellerListings({ user, onOpenListFromHub, onSelectListing, onOpenAssetActivity }) {
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
    return (
      <StudioPage title="Listings" subtitle="Loading your marketplace offers…">
        <div className="studio-list" aria-busy="true">
          {[1, 2, 3].map((n) => (
            <div key={n} className="glass-panel studio-list__row studio-list__row--skel">
              <div className="studio-list__thumb studio-list__thumb--skel" />
              <div className="studio-list__skel-lines">
                <span />
                <span />
              </div>
            </div>
          ))}
        </div>
      </StudioPage>
    );
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
          title="No listings yet"
          description="Protect an asset in Pinit HUB and list it on Exchange."
          primaryLabel="List an asset"
          onPrimary={onOpenListFromHub}
        />
      ) : (
        <div className="studio-list">
          {visible.map((item) => {
            const listed = isListed(item);
            return (
              <article key={item.listing_id} className="glass-panel studio-list__row">
                <ListingThumb item={item} onOpen={onSelectListing} />
                <div className="studio-list__meta">
                  <strong>{item.title}</strong>
                  <span>{item.listing_id} · {listingStatusLabel(item)} · {item.views || 0} views</span>
                </div>
                <div className="studio-list__price">{formatMoney(Number(item.price_personal || item.price_commercial || 0))}</div>
                <div className="studio-list__actions">
                  <button type="button" className="btn-secondary" onClick={() => onSelectListing?.(item.listing_id)}>
                    View
                  </button>
                  {/* Opens Asset 360 for THIS asset. It previously went to the
                      generic analytics page, which showed portfolio-wide
                      numbers regardless of which listing you clicked. */}
                  <button type="button" className="btn-secondary" onClick={() => onOpenAssetActivity?.(item.asset_id)}>
                    Activity
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
