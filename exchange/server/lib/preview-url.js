const PLACEHOLDER_PREVIEW =
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80';

export function isHubVaultId(assetId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(assetId || ''),
  );
}

/** Same-origin Hub vault preview proxy for real assets (playable video/image). */
export function exchangePreviewUrl(assetId, fallback = PLACEHOLDER_PREVIEW) {
  if (isHubVaultId(assetId)) return `/api/hub/preview/${assetId}`;
  if (fallback && !String(fallback).includes('unsplash.com')) return fallback;
  return isHubVaultId(assetId) ? `/api/hub/preview/${assetId}` : fallback || PLACEHOLDER_PREVIEW;
}

export { PLACEHOLDER_PREVIEW };
