/** Hub vault preview for Exchange cards. Never fall back to stock photos. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function listingPreviewUrl(item) {
  for (const key of ['thumbnail_url', 'poster_url', 'preview_url']) {
    const url = String(item?.[key] || '');
    if (url && !url.includes('unsplash.com')) return url;
  }
  return '';
}

/** Gallery caption: never surface a UUID or a raw file extension as the title. */
export function galleryTitle(item) {
  const raw = String(item?.title || '').trim();
  if (!raw || UUID_RE.test(raw)) return 'Untitled';
  return raw.replace(/\.(jpe?g|png|gif|webp|mp4|mov|webm|pdf|wav|mp3|m4a|aac)$/i, '');
}

export function listingStatusLabel(item) {
  const s = String(item?.status || '').toLowerCase();
  if (s === 'published' || s === 'live') return 'Listed';
  if (s === 'sold_exclusive') return 'Sold exclusive';
  if (s === 'draft' || s === 'unlisted') return 'Unlisted';
  if (s === 'suspended') return 'Suspended';
  if (s === 'archived') return 'Archived';
  return s || 'Draft';
}

export function isListed(item) {
  const s = String(item?.status || '').toLowerCase();
  return s === 'published' || s === 'live';
}
