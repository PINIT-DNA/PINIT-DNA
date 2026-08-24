/**
 * Recently viewed assets — stored on the device.
 *
 * There is no view-history table on the server. The `listings.views` counter is
 * an aggregate: it records that a listing was viewed, not who viewed it, so it
 * cannot answer "what did *I* look at". Rather than invent a backend table or
 * fabricate a list, this keeps the last few listings the person opened in
 * localStorage and says so in the UI.
 *
 * Only the listing id and the moment it was opened are stored. Titles, prices
 * and previews are re-fetched from the API at render time, so a delisted or
 * repriced asset can never be shown from a stale local copy.
 */

const KEY = 'pinit_recently_viewed';
const MAX = 12;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((r) => r && typeof r.listing_id === 'string');
  } catch {
    return [];
  }
}

/** Listing ids, most recently opened first. */
export function recentlyViewedIds() {
  return read().map((r) => r.listing_id);
}

export function recordListingView(listingId) {
  const id = String(listingId || '').trim();
  if (!id) return;
  try {
    const next = [{ listing_id: id, at: Date.now() }, ...read().filter((r) => r.listing_id !== id)]
      .slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — history simply is not kept */
  }
}

export function clearRecentlyViewed() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
