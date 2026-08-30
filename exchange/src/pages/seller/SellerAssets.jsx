import React, { useEffect, useMemo, useState } from 'react';
import { Images, PlusCircle, Play, ExternalLink } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';
import { listingPreviewUrl, isListed } from '../../lib/listing-preview.js';
import { isVideoListing } from '../../lib/media.js';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3002').replace(/\/$/, '');

export default function SellerAssets({ user, onOpenListFromHub, onSelectListing, hubAppUrl = HUB_APP_URL }) {
  const [assets, setAssets] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user?.pinit_id) return;
    (async () => {
      setLoading(true);
      const [hub, mine] = await Promise.all([
        apiFetch(`/api/hub/assets?pinit_id=${encodeURIComponent(user.pinit_id)}`),
        apiFetch(`/api/creator/listings?pinit_id=${encodeURIComponent(user.pinit_id)}`),
      ]);
      setAssets(hub.ok ? (hub.data.assets || []) : []);
      setListings(mine.ok ? (mine.data.listings || []) : []);
      setMessage(hub.ok ? (hub.data.message || '') : (hub.error || ''));
      setLoading(false);
    })();
  }, [user?.pinit_id]);

  const listedByAsset = useMemo(() => {
    const map = {};
    listings.forEach((row) => {
      map[String(row.asset_id || '')] = row;
    });
    return map;
  }, [listings]);

  const rows = useMemo(() => {
    const seen = new Set();
    const fromHub = assets.map((asset) => {
      const id = String(asset.asset_id || '');
      seen.add(id);
      return { ...asset, listing: listedByAsset[id] || null, source: 'hub' };
    });
    const listedOnly = listings
      .filter((row) => !seen.has(String(row.asset_id || '')))
      .map((row) => ({ ...row, listing: row, source: 'listing' }));
    return [...fromHub, ...listedOnly];
  }, [assets, listings, listedByAsset]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading your Hub assets…</div>;
  }

  return (
    <StudioPage
      title="My Assets"
      subtitle="Your protected Hub vault. Listing is a separate step — uploading never auto-lists on Exchange."
      actions={(
        <>
          <button type="button" className="btn-primary" onClick={onOpenListFromHub}>
            <PlusCircle size={16} /> List from Hub
          </button>
          <a className="btn-secondary" href={`${hubAppUrl}/vault`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Open Hub vault
          </a>
        </>
      )}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Images size={32} color="var(--primary)" />}
          title="No protected assets yet"
          description={message || 'Protect files in Pinit Hub, then list them here when you are ready to sell.'}
          primaryLabel="Protect in Hub"
          onPrimary={() => window.open(`${hubAppUrl}/generate`, '_blank', 'noreferrer')}
          secondaryLabel="List from Hub"
          onSecondary={onOpenListFromHub}
        />
      ) : (
        <div className="studio-assets studio-assets--wide">
          {rows.map((item) => {
            const listed = item.listing && isListed(item.listing);
            const preview = listingPreviewUrl(item.listing || item);
            const video = isVideoListing(item.listing || item);
            return (
              <article key={item.asset_id || item.listing_id} className="studio-asset studio-asset--mod">
                <button
                  type="button"
                  className="studio-asset__media"
                  onClick={() => {
                    if (item.listing?.listing_id) onSelectListing?.(item.listing.listing_id);
                  }}
                >
                  {preview ? (
                    video ? <video src={preview} muted playsInline /> : <img src={preview} alt="" />
                  ) : (
                    <div className="studio-asset__ph">{video ? <Play size={22} /> : <Images size={22} />}</div>
                  )}
                </button>
                <strong>{item.title || item.listing?.title || 'Protected asset'}</strong>
                <span>{listed ? 'Listed on Exchange' : 'In Hub vault · not listed'}</span>
                <div className="studio-asset__row">
                  {listed ? (
                    <button type="button" className="btn-secondary" onClick={() => onSelectListing?.(item.listing.listing_id)}>
                      View listing
                    </button>
                  ) : (
                    <button type="button" className="btn-primary" onClick={() => onOpenListFromHub?.(item.asset_id)}>
                      List this asset
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
