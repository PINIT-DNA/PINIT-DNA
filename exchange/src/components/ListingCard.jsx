import React, { useState } from 'react';
import { Heart, Play, FileText, Box, Headphones } from 'lucide-react';
import { canPurchase } from '../lib/roles.js';
import { samePinitIdentity } from '../lib/pinit-identity.js';
import { isVideoListing } from '../lib/media.js';
import { assetKind } from '../lib/asset-type.js';
import { listingPreviewUrl, galleryTitle } from '../lib/listing-preview.js';

function PreviewPlaceholder({ title = '', kind = 'other' }) {
  const letter = String(title || 'P').trim().charAt(0).toUpperCase() || 'P';
  const Icon = kind === 'audio' ? Headphones : kind === 'document' ? FileText : kind === '3d' ? Box : null;
  return (
    <div className="listing-card__video-ph listing-card__video-ph--brand" aria-hidden>
      <div className="listing-card__video-ph-inner">
        {Icon ? <Icon size={22} /> : <span className="listing-card__ph-letter">{letter}</span>}
      </div>
    </div>
  );
}

function CardMedia({ item, isVideo, kind }) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const still = listingPreviewUrl(item);

  if (isVideo) {
    return (
      <>
        {still && !mediaFailed ? (
          <img
            src={still}
            alt=""
            className="card-media pinit-protected-media"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <PreviewPlaceholder title={item.title} kind="video" />
        )}
        <div className="listing-card__play" aria-hidden>
          <Play size={16} fill="#fff" />
        </div>
      </>
    );
  }

  if (kind === 'audio') {
    return still && !mediaFailed ? (
      <img
        src={still}
        alt=""
        className="card-media pinit-protected-media"
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setMediaFailed(true)}
      />
    ) : (
      <PreviewPlaceholder title={item.title} kind="audio" />
    );
  }

  if (mediaFailed || !still) {
    return <PreviewPlaceholder title={item.title} kind={kind} />;
  }

  return (
    <img
      src={still}
      alt=""
      className="card-media pinit-protected-media"
      loading="lazy"
      decoding="async"
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
  user = null,
  wishlisted = false,
}) {
  const isVideo = isVideoListing(item);
  const kind = assetKind(item);
  const own = samePinitIdentity(user?.pinit_id, item.pinit_id);
  const showSave = Boolean(onWishlist) && !own && (!user || canPurchase(user));
  const title = galleryTitle(item);
  const creatorName = item.creator_name || 'Creator';

  const open = () => onSelect?.(item.listing_id);

  return (
    <article
      id={item.listing_id ? `listing-${item.listing_id}` : undefined}
      className="asset-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      aria-label={`${title} by ${creatorName}. Open asset to view details.`}
    >
      <div className="asset-card__media">
        {showSave && (
          <button
            type="button"
            className={`asset-card__wish ${wishlisted ? 'is-on' : ''}`}
            aria-label={wishlisted ? 'Remove from saved' : 'Save'}
            onClick={(e) => {
              e.stopPropagation();
              onWishlist(item);
            }}
          >
            <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
          </button>
        )}
        <CardMedia item={item} isVideo={isVideo} kind={kind} />
        <span className="asset-card__hover" aria-hidden>View asset →</span>
      </div>
    </article>
  );
}
