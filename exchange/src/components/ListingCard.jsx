import { formatMoney } from '../lib/money.js';
import React, { useState } from 'react';
import { CheckCircle2, Heart, Play, ShieldCheck, FileText, Box, Headphones } from 'lucide-react';
import { canPurchase } from '../lib/roles.js';
import { samePinitIdentity } from '../lib/pinit-identity.js';
import {
  isVideoListing,
  hasPlayableVideoPreview,
  formatMediaDuration,
} from '../lib/media.js';
import { assetKind, assetKindLabel, licenseTeaser, listingFromPrice } from '../lib/asset-type.js';

function PreviewPlaceholder({ title = '', kind = 'other' }) {
  const letter = String(title || 'P').trim().charAt(0).toUpperCase() || 'P';
  const Icon = kind === 'audio' ? Headphones : kind === 'document' ? FileText : kind === '3d' ? Box : null;
  return (
    <div className="listing-card__video-ph listing-card__video-ph--brand" aria-hidden>
      <div className="listing-card__video-ph-inner">
        {Icon ? <Icon size={28} /> : <span className="listing-card__ph-letter">{letter}</span>}
      </div>
    </div>
  );
}

function CardMedia({ item, isVideo, kind }) {
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
          {duration && (
            <div className="listing-card__media-meta">
              <span className="listing-card__duration">{duration}</span>
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <PreviewPlaceholder title={item.title} kind="video" />
        <div className="listing-card__play" aria-hidden>
          <Play size={18} fill="#fff" />
        </div>
      </>
    );
  }

  if (kind === 'audio') {
    return (
      <>
        {still && !mediaFailed ? (
          <img src={still} alt="" className="card-media pinit-protected-media" draggable={false} onError={() => setMediaFailed(true)} />
        ) : (
          <PreviewPlaceholder title={item.title} kind="audio" />
        )}
        <div className="listing-card__media-meta">
          <span className="listing-card__type">Audio</span>
        </div>
      </>
    );
  }

  if (kind === 'document' || kind === 'design' || kind === '3d') {
    if (still && !mediaFailed) {
      return (
        <img
          src={still}
          alt={item.title || 'Asset preview'}
          className="card-media pinit-protected-media"
          draggable={false}
          onError={() => setMediaFailed(true)}
        />
      );
    }
    return <PreviewPlaceholder title={item.title} kind={kind} />;
  }

  if (mediaFailed || !still) {
    return <PreviewPlaceholder title={item.title} kind={kind} />;
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
  onAddToCart: _onAddToCart,
  user = null,
  wishlisted = false,
}) {
  const isVideo = isVideoListing(item);
  const kind = assetKind(item);
  const fromPrice = listingFromPrice(item);
  const own = samePinitIdentity(user?.pinit_id, item.pinit_id);
  const showBuyActions = !own && (!user || canPurchase(user));
  const open = () => onSelect?.(item.listing_id);
  const subtitle = String(item.tagline || '').trim();

  return (
    <article
      id={item.listing_id ? `listing-${item.listing_id}` : undefined}
      className="asset-card"
    >
      <button
        type="button"
        className="asset-card__media"
        onClick={open}
        aria-label={`View ${item.title || 'asset'}`}
      >
        <CardMedia item={item} isVideo={isVideo} kind={kind} />
        {own && <span className="listing-tile__owner">Your listing</span>}
      </button>

      <div className="asset-card__body">
        <h3 className="asset-card__title">
          <button type="button" onClick={open}>{item.title}</button>
        </h3>
        {subtitle ? <p className="asset-card__tag">{subtitle}</p> : null}
        <p className="asset-card__by">by {item.creator_name || 'Verified creator'}</p>
        <div className="asset-card__chips">
          <span>{assetKindLabel(item)}</span>
          <span><ShieldCheck size={11} /> Hub protected</span>
          <span><CheckCircle2 size={11} /> Verified</span>
        </div>
        <div className="asset-card__price-row">
          <strong>{formatMoney(fromPrice)}</strong>
          <span>{licenseTeaser(item)}</span>
        </div>
        <div className="asset-card__actions">
          {onWishlist && showBuyActions && (
            <button
              type="button"
              className={`asset-card__wish ${wishlisted ? 'is-on' : ''}`}
              onClick={() => onWishlist(item)}
            >
              <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
              {wishlisted ? 'Saved' : 'Add to wishlist'}
            </button>
          )}
          <button type="button" className="btn-primary asset-card__view" onClick={open}>
            View asset
          </button>
        </div>
      </div>
    </article>
  );
}
