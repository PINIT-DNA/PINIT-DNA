import { formatFrom, formatMoney } from '../lib/money.js';
import React, { useState } from 'react';
import { CheckCircle2, Heart, Play, ShoppingCart } from 'lucide-react';
import { canPurchase } from '../lib/roles.js';
import { samePinitIdentity } from '../lib/pinit-identity.js';
import {
  isVideoListing,
  hasPlayableVideoPreview,
  formatMediaDuration,
} from '../lib/media.js';

function PreviewPlaceholder({ title = '' }) {
  const letter = String(title || 'P').trim().charAt(0).toUpperCase() || 'P';
  return (
    <div className="listing-card__video-ph listing-card__video-ph--brand" aria-hidden>
      <div className="listing-card__video-ph-inner">
        <span className="listing-card__ph-letter">{letter}</span>
      </div>
    </div>
  );
}

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
  const still = item.preview_url || item.thumbnail_url || item.poster_url || '';

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
            <span>{item.title || 'Video'}</span>
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

  if (mediaFailed || !still) {
    return <PreviewPlaceholder title={item.title} />;
  }

  return (
    <img
      src={still}
      alt={item.title || 'Asset preview'}
      className="card-media pinit-protected-media"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onError={() => setMediaFailed(true)}
    />
  );
}

export default function ListingCard({
  item,
  onSelect,
  onWishlist,
  onAddToCart,
  user = null,
  wishlisted = false,
}) {
  const isVideo = isVideoListing(item);
  const fromPrice = item.price_personal ?? item.price_commercial ?? 0;
  const tierLabel = goldBadgeLabel(item.badge_tier);
  const open = () => onSelect?.(item.listing_id);

  // Gallery cards are the picture. Title, price, creator and provenance all
  // live on the asset page — a browsing grid reads faster when the work is the
  // only thing competing for attention.
  //
  // The caption is always in the DOM (screen readers get it regardless) and
  // reveals visually on hover or keyboard focus.
  return (
    <article
      id={item.listing_id ? `listing-${item.listing_id}` : undefined}
      className="listing-tile"
      tabIndex={0}
      role="link"
      aria-label={`${item.title} by ${item.creator_name || 'verified creator'}, from ${formatMoney(fromPrice)}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
    >
      <CardMedia item={item} isVideo={isVideo} />

      <span className="listing-tile__verified" title="Hub verified & protected">
        <CheckCircle2 size={12} /> Verified
      </span>

      {onWishlist && (!user || canPurchase(user)) && (
        <button
          type="button"
          className={`listing-tile__wish ${wishlisted ? 'active' : ''}`}
          title={wishlisted ? 'Saved' : 'Save to wishlist'}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          onClick={(e) => { e.stopPropagation(); onWishlist(item); }}
        >
          <Heart size={15} fill={wishlisted ? 'currentColor' : 'none'} />
        </button>
      )}

      <div className="listing-tile__caption">
        <div className="listing-tile__text">
          <h3 className="listing-tile__title">{item.title}</h3>
          <p className="listing-tile__by">
            {item.creator_name || 'Verified creator'}
            {tierLabel ? <span className="listing-tile__tier"> · {tierLabel}</span> : null}
          </p>
        </div>

        <div className="listing-tile__right">
          <span className="listing-tile__price">{formatFrom(fromPrice)}</span>
          {(!user || canPurchase(user)) && (
            <button
              type="button"
              className="listing-tile__cart"
              title="Add to cart"
              aria-label={`Add ${item.title} to cart`}
              onClick={(e) => {
                e.stopPropagation();
                if (onAddToCart) onAddToCart(item);
                else open();
              }}
            >
              <ShoppingCart size={15} />
            </button>
          )}
        </div>
      </div>

      {samePinitIdentity(user?.pinit_id, item.pinit_id) && <span className="listing-tile__owner">Your listing</span>}
    </article>
  );
}
