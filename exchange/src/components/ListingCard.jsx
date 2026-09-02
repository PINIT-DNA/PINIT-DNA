import { formatMoney } from '../lib/money.js';
import React, { useState } from 'react';
import { CheckCircle2, Heart, Play, ShieldCheck, FileText, Box, Headphones } from 'lucide-react';
import { canPurchase } from '../lib/roles.js';
import { samePinitIdentity } from '../lib/pinit-identity.js';
import {
  isVideoListing,
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
  const poster = item.poster_url || item.thumbnail_url || null;
  const still = item.preview_url || item.thumbnail_url || item.poster_url || '';

  if (isVideo) {
    const cover = poster || still;
    return (
      <>
        {cover && !mediaFailed ? (
          <img
            src={cover}
            alt=""
            className="card-media pinit-protected-media"
            draggable={false}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <PreviewPlaceholder title={item.title} kind="video" />
        )}
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

  if (kind === 'audio') {
    return (
      <>
        {still && !mediaFailed ? (
          <img src={still} alt="" className="card-media pinit-protected-media" draggable={false} onError={() => setMediaFailed(true)} />
        ) : (
          <PreviewPlaceholder title={item.title} kind="audio" />
        )}
        <div className="asset-card__wave" aria-hidden>
          {Array.from({ length: 18 }).map((_, i) => <span key={i} style={{ '--h': `${30 + ((i * 17) % 55)}%` }} />)}
        </div>
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
      className="asset-card asset-card--poster"
    >
      <div
        className="asset-card__media"
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        aria-label={`${item.title || 'Asset'} — ${formatMoney(fromPrice)}. Hover or focus for details.`}
      >
        <CardMedia item={item} isVideo={isVideo} kind={kind} />
        {own && <span className="listing-tile__owner">Your listing</span>}
        <div className="asset-card__overlay">
          <h3 className="asset-card__title">{item.title}</h3>
          {subtitle ? <p className="asset-card__tag">{subtitle}</p> : null}
          <p className="asset-card__by">by {item.creator_name || 'Verified creator'}</p>
          <div className="asset-card__chips">
            <span>{assetKindLabel(item)}</span>
            <span><ShieldCheck size={11} /> HUB Protected</span>
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
                aria-label={wishlisted ? 'Saved to wishlist' : 'Add to wishlist'}
                onClick={(e) => { e.stopPropagation(); onWishlist(item); }}
              >
                <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
              </button>
            )}
            <span className="asset-card__view">View asset</span>
          </div>
        </div>
      </div>
    </article>
  );
}
