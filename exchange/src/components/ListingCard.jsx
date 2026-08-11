import React, { useState } from 'react';
import { CheckCircle2, Heart, Play, ArrowRight } from 'lucide-react';
import HubTrustBadge from './HubTrustBadge.jsx';
import ProvenanceDrawer from './ProvenanceDrawer.jsx';
import { verticalLabel } from '../lib/api.js';
import {
  isVideoListing,
  hasPlayableVideoPreview,
  formatMediaDuration,
} from '../lib/media.js';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80';

function goldBadgeLabel(tier) {
  const t = String(tier || '').toLowerCase();
  if (t === 'gold') return 'Gold · Human Verified';
  if (t === 'silver') return 'Silver · Pinit Verified';
  if (t === 'bronze') return 'Bronze · Pinit Verified';
  return null;
}

function CardMedia({ item, isVideo }) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const [duration, setDuration] = useState(
    item.duration_sec != null ? formatMediaDuration(item.duration_sec) : null,
  );
  const playable = hasPlayableVideoPreview(item.preview_url);
  const poster = item.poster_url || item.thumbnail_url || null;

  if (isVideo) {
    if (playable && !mediaFailed) {
      return (
        <>
          <video
            src={item.preview_url}
            poster={poster || undefined}
            className="card-media"
            muted
            playsInline
            preload="metadata"
            onError={() => setMediaFailed(true)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDuration(formatMediaDuration(d));
            }}
          />
          <div className="listing-card__play" aria-hidden>
            <Play size={18} fill="#fff" />
          </div>
          <div className="listing-card__media-meta">
            <span className="listing-card__type">Video</span>
            {duration && <span className="listing-card__duration">{duration}</span>}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="listing-card__video-ph" aria-hidden>
          <div className="listing-card__video-ph-inner">
            <Play size={28} fill="#fff" />
            <span>Video preview</span>
          </div>
        </div>
        <div className="listing-card__play" aria-hidden>
          <Play size={18} fill="#fff" />
        </div>
        <div className="listing-card__media-meta">
          <span className="listing-card__type">Video</span>
          {duration && <span className="listing-card__duration">{duration}</span>}
        </div>
      </>
    );
  }

  return (
    <img
      src={!mediaFailed && item.preview_url ? item.preview_url : FALLBACK_IMAGE}
      alt={item.title || 'Asset preview'}
      className="card-media"
      onError={() => setMediaFailed(true)}
    />
  );
}

export default function ListingCard({
  item,
  onSelect,
  onWishlist,
  wishlisted = false,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isVideo = isVideoListing(item);
  const fromPrice = item.price_personal ?? item.price_commercial ?? 0;
  const tierLabel = goldBadgeLabel(item.badge_tier);

  return (
    <>
      <article
        id={item.listing_id ? `listing-${item.listing_id}` : undefined}
        className="listing-card listing-card--pro"
        onClick={() => onSelect?.(item.listing_id)}
      >
        <div className="listing-card__media">
          <CardMedia item={item} isVideo={isVideo} />

          <div className="watermark-overlay" style={{ pointerEvents: 'none' }}>
            <div className="watermark-text">Pinit PROVENANCE</div>
          </div>

          <div className={`card-badge-container listing-card__badges${onWishlist ? ' listing-card__badges--under-wish' : ''}`}>
            <span className="badge-verified listing-card__verified-pill">
              <CheckCircle2 size={12} /> Verified
            </span>
            {tierLabel && (
              <span className={`badge-${String(item.badge_tier).toLowerCase()} listing-card__tier-pill`}>
                {tierLabel}
              </span>
            )}
          </div>

          {onWishlist && (
            <button
              type="button"
              className={`listing-card__wish ${wishlisted ? 'active' : ''}`}
              title={wishlisted ? 'Saved' : 'Add to wishlist'}
              onClick={(e) => {
                e.stopPropagation();
                onWishlist(item);
              }}
            >
              <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

        <div className="listing-card__body">
          <h3 className="listing-card__title">{item.title}</h3>

          <div className="listing-card__meta">
            {verticalLabel(item.vertical)}
            {' · '}
            Commercial
          </div>

          <div className="listing-card__by">
            by {item.creator_name || 'Verified creator'}
          </div>

          <div className="listing-card__price-row">
            <div className="listing-card__from">From ${Number(fromPrice).toFixed(0)}</div>
            <div className="listing-card__tiers">Personal • Commercial • Exclusive</div>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="listing-card__hub"
          >
            <HubTrustBadge compact onOpenProvenance={() => setDrawerOpen(true)} />
          </div>

          <button
            type="button"
            className="btn-primary listing-card__cta"
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(item.listing_id);
            }}
          >
            View &amp; License <ArrowRight size={14} />
          </button>
        </div>
      </article>

      <ProvenanceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} listing={item} />
    </>
  );
}
