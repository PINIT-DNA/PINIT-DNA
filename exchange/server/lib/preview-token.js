/**
 * Short-lived signed preview URLs.
 *
 * The marketplace preview route used to be a bare, guessable path:
 *   /api/hub/preview/<asset_id>
 * and the public listings API hands out `asset_id` in plaintext. So anyone
 * could construct the URL, fetch it anonymously, hotlink it, or paste it into
 * an address bar and use "Save image as".
 *
 * Previews are now addressed by a signed, expiring token. The URL is minted
 * server-side per response, is valid for minutes rather than forever, and
 * cannot be derived from the asset id alone.
 *
 * This is an access control, not DRM. A signed-in buyer can still screenshot
 * what their screen renders. The guarantee is narrower and more useful:
 * what leaves the server is always a watermarked derivative, only for an
 * actually-published listing, and only for a short window.
 */
import crypto from 'crypto';

/** Default validity. Long enough to render a page and lazy-load below the fold. */
const DEFAULT_TTL_SEC = 600;

/** Reject absurd expiries even if a caller passes one. */
const MAX_TTL_SEC = 3600;

function signingSecret() {
  // Falls back through the same chain the bridge uses so deployments that
  // already set a bridge secret work without new configuration.
  return (
    process.env.PREVIEW_SIGNING_SECRET
    || process.env.EXCHANGE_BRIDGE_SECRET
    || process.env.HUB_BRIDGE_SECRET
    || ''
  );
}

/** True when signing is configured. Without a secret we cannot verify anything. */
export function isPreviewSigningEnabled() {
  return signingSecret().length > 0;
}

function computeSignature(assetId, expiresAt) {
  return crypto
    .createHmac('sha256', signingSecret())
    .update(`${assetId}.${expiresAt}`)
    .digest('base64url')
    .slice(0, 32);
}

/**
 * Mint `{ e, t }` query parameters for an asset preview.
 * Returns null when signing is not configured, so callers can fall back
 * rather than emitting a URL that will always 403.
 */
export function signPreviewParams(assetId, ttlSec = DEFAULT_TTL_SEC) {
  if (!isPreviewSigningEnabled()) return null;
  const id = String(assetId || '').trim();
  if (!id) return null;
  const ttl = Math.min(MAX_TTL_SEC, Math.max(30, Number(ttlSec) || DEFAULT_TTL_SEC));
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  return { e: String(expiresAt), t: computeSignature(id, expiresAt) };
}

/**
 * Verify a preview token.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyPreviewToken(assetId, token, expiresAt) {
  if (!isPreviewSigningEnabled()) {
    // Fail closed in production, open in local dev where no secret is set.
    return process.env.NODE_ENV === 'production'
      ? { ok: false, reason: 'preview signing not configured' }
      : { ok: true };
  }

  const id = String(assetId || '').trim();
  const t = String(token || '');
  const e = Number(expiresAt);

  if (!id || !t || !Number.isFinite(e)) return { ok: false, reason: 'missing token' };
  if (Math.floor(Date.now() / 1000) > e) return { ok: false, reason: 'expired' };

  const expected = computeSignature(id, e);
  // Constant-time compare; length guard first because timingSafeEqual throws
  // on a length mismatch.
  if (t.length !== expected.length) return { ok: false, reason: 'bad signature' };
  const match = crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
  return match ? { ok: true } : { ok: false, reason: 'bad signature' };
}

export { DEFAULT_TTL_SEC };
