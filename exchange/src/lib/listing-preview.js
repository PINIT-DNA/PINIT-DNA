/** Hub vault preview for Exchange cards. Never fall back to stock photos. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function listingPreviewUrl(item) {
  const url = String(item?.preview_url || '');
  if (url && !url.includes('unsplash.com')) return url;
  // Preview URLs are signed server-side and arrive on the payload. Building
  // a bare /api/hub/preview/<id> here would produce an unsigned URL that the
  // server now rejects, so return nothing and let the placeholder show.
  return '';
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
