/**
 * Signed Exchange session tokens.
 *
 * Identity on Exchange used to be whatever Pinit ID the browser claimed. The
 * SSO handshake verified a signed Hub token, but nothing was issued in return,
 * so every later request carried a bare `X-Pinit-Id` header and the role guards
 * trusted it. Pinit IDs are public — they appear on listings and reviews — so
 * anyone could act as anyone else by editing one header.
 *
 * A session token closes that. It is minted only after an identity has actually
 * been proven (Hub SSO, or a server-side lookup the caller already passed), is
 * signed with a server secret, carries an expiry, and cannot be forged from a
 * Pinit ID alone.
 *
 * Deliberately a compact HMAC token rather than a full JWT: it holds one claim
 * (which Pinit ID you are), and mirrors preview-token.js so there is one signing
 * story in this codebase rather than two.
 */
import crypto from 'crypto';

/** Sessions last a day; long enough to shop, short enough to bound a leak. */
const DEFAULT_TTL_SEC = 86400;

/** Reject absurd lifetimes even if a caller passes one. */
const MAX_TTL_SEC = 604800;

function signingSecret() {
  // Same fallback chain as the bridge and preview signer, so existing
  // deployments work without new configuration.
  return (
    process.env.SESSION_SIGNING_SECRET
    || process.env.EXCHANGE_BRIDGE_SECRET
    || process.env.HUB_BRIDGE_SECRET
    || ''
  );
}

/** True when signing is configured. Without a secret nothing can be verified. */
export function isSessionSigningEnabled() {
  return signingSecret().length > 0;
}

function computeSignature(pinitId, expiresAt) {
  return crypto
    .createHmac('sha256', signingSecret())
    .update(`${pinitId}.${expiresAt}`)
    .digest('base64url');
}

/**
 * Mint a session token for a Pinit ID whose identity has already been proven.
 * Returns null when signing is not configured, so callers can fall back rather
 * than handing out a token that will never verify.
 */
export function mintSessionToken(pinitId, ttlSec = DEFAULT_TTL_SEC) {
  if (!isSessionSigningEnabled()) return null;
  const id = String(pinitId || '').trim();
  if (!id) return null;
  const ttl = Math.min(MAX_TTL_SEC, Math.max(60, Number(ttlSec) || DEFAULT_TTL_SEC));
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const sig = computeSignature(id, expiresAt);
  // id.exp.sig — the id is base64url'd so a Pinit ID can never introduce a dot.
  return `${Buffer.from(id).toString('base64url')}.${expiresAt}.${sig}`;
}

/**
 * Verify a session token and return the Pinit ID it proves.
 * @returns {{ok: true, pinitId: string} | {ok: false, reason: string}}
 */
export function verifySessionToken(token) {
  if (!isSessionSigningEnabled()) {
    return { ok: false, reason: 'session signing not configured' };
  }
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'missing token' };

  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };

  const [encodedId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed token' };
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };

  let pinitId;
  try {
    pinitId = Buffer.from(encodedId, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed token' };
  }
  if (!pinitId) return { ok: false, reason: 'malformed token' };

  const expected = computeSignature(pinitId, exp);
  // Constant-time compare; length guard first because timingSafeEqual throws
  // on a length mismatch.
  if (sig.length !== expected.length) return { ok: false, reason: 'bad signature' };
  const match = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return match ? { ok: true, pinitId } : { ok: false, reason: 'bad signature' };
}

/** Read a bearer token from the Authorization header or X-Session-Token. */
export function sessionTokenFromReq(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers?.['x-session-token'] || '').trim();
}

/**
 * The Pinit ID this request has *proven*, or '' when it has proven nothing.
 * Never falls back to a client-supplied id — that is the whole point.
 */
export function verifiedPinitIdFromReq(req) {
  const result = verifySessionToken(sessionTokenFromReq(req));
  return result.ok ? result.pinitId : '';
}

export { DEFAULT_TTL_SEC };
