import { getSql } from './db.js';
import { identityCandidates } from './pinit-identity.js';
import {
  canList,
  buyerDeniedList,
  buyerDeniedSellerAction,
  isBuyerCapabilityEnabled,
  isSellerRole,
  enableBuyerDenied,
} from './roles.js';
import { sellerOnboardingBlocked } from './seller-onboarding.js';
import { verifiedPinitIdFromReq, isSessionSigningEnabled } from './session-token.js';

/**
 * Strict mode rejects any request that has not proven its identity with a
 * signed session token.
 *
 * It is off by default on purpose. The frontend and the API deploy separately,
 * so a backend that demanded tokens before the new frontend shipped would sign
 * every existing user out mid-session. The rollout is: deploy both halves with
 * this off (tokens get minted and sent), then set EXCHANGE_STRICT_AUTH=1 to
 * close the legacy path for good.
 *
 * Endpoints that return personal data do NOT wait for this flag — see
 * requireVerifiedIdentity below. Those are strict from today.
 */
function strictAuthEnabled() {
  return String(process.env.EXCHANGE_STRICT_AUTH || '').trim() === '1';
}

export async function findUserByPinitId(pinitId) {
  const id = String(pinitId || '').trim();
  if (!id) return null;
  const candidates = identityCandidates(id);
  const ids = candidates.length ? candidates : [id];
  const placeholders = ids.map(() => '?').join(', ');
  return getSql(
    `SELECT * FROM users WHERE pinit_id IN (${placeholders})
     ORDER BY CASE WHEN pinit_id LIKE 'PINIT-EX-%' THEN 0 ELSE 1 END
     LIMIT 1`,
    ids,
  );
}

/** The Pinit ID the client merely *claims*, from body, query or header. */
function claimedPinitIdFromReq(req) {
  return String(
    req.body?.pinit_id ||
      req.body?.buyer_pinit_id ||
      req.body?.seller_pinit_id ||
      req.query?.pinit_id ||
      req.query?.seller_pinit_id ||
      req.headers['x-pinit-id'] ||
      '',
  ).trim();
}

/**
 * Resolve who this request is, and how much that is worth.
 *
 * `verified` is true only when a signed session token proved it. A claimed id
 * is still returned during the transition so existing sessions keep working,
 * but callers that expose personal data must check `verified` themselves.
 */
export function resolveIdentity(req) {
  const verified = verifiedPinitIdFromReq(req);
  if (verified) return { pinitId: verified, verified: true };
  return { pinitId: claimedPinitIdFromReq(req), verified: false };
}

/**
 * Back-compatible accessor used by existing call sites.
 *
 * Prefers the identity proven by a session token and falls back to the claimed
 * one. In strict mode the claimed value is discarded entirely.
 */
export function pinitIdFromReq(req) {
  const { pinitId, verified } = resolveIdentity(req);
  if (verified) return pinitId;
  return strictAuthEnabled() ? '' : pinitId;
}

/**
 * Guard for endpoints that return or act on personal data — orders, licences,
 * invoices, profiles. These never accept a claimed id, regardless of the
 * transition flag, because reading someone's purchase history by typing their
 * public Pinit ID into a query string was the actual leak.
 */
export function requireVerifiedIdentity(req, res, next) {
  const { pinitId, verified } = resolveIdentity(req);
  if (verified && pinitId) {
    req.verifiedPinitId = pinitId;
    return next();
  }
  // Same bar as listing while EXCHANGE_STRICT_AUTH is off: Hub SSO often
  // leaves a Pinit ID in localStorage without a minted session_token.
  // Seller ₹2,500 checkout and become-creator were 401ing on production.
  if (!strictAuthEnabled()) {
    const claimed = pinitIdFromReq(req);
    if (claimed) {
      req.verifiedPinitId = claimed;
      return next();
    }
  }
  return res.status(401).json({
    error: 'SESSION_REQUIRED',
    message: isSessionSigningEnabled()
      ? 'Sign in again to view this. Your session has expired or is missing.'
      : 'Session signing is not configured on this server.',
  });
}

function maybePinitFromBuyerKey(req) {
  const key = String(req.body?.buyer_key || req.query?.buyer_key || req.headers['x-buyer-key'] || '').trim();
  return key.toUpperCase().startsWith('PINIT-') ? key : '';
}

export async function requireSeller(req, res, next) {
  try {
    const pinitId = pinitIdFromReq(req);
    if (!pinitId) {
      return res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'Sign in as a Creator to use seller tools.',
      });
    }
    const user = await findUserByPinitId(pinitId);
    if (!user || !canList(user.role)) {
      return res.status(403).json(buyerDeniedList());
    }
    req.exchangeUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Seller role + payment-method verification complete (new sellers only). */
export async function requireActiveSeller(req, res, next) {
  try {
    const pinitId = pinitIdFromReq(req);
    if (!pinitId) {
      return res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'Sign in as a Creator to use seller tools.',
      });
    }
    const user = await findUserByPinitId(pinitId);
    if (!user || !canList(user.role)) {
      return res.status(403).json(buyerDeniedList());
    }
    const blocked = sellerOnboardingBlocked(user);
    if (blocked) {
      return res.status(403).json(blocked);
    }
    req.exchangeUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function requireBuyer(req, res, next) {
  try {
    const pinitId = pinitIdFromReq(req) || maybePinitFromBuyerKey(req);
    if (!pinitId) {
      return res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'Sign in to purchase or post requirements.',
      });
    }
    const user = await findUserByPinitId(pinitId);
    if (!user) {
      return res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'Sign in to purchase or post requirements.',
      });
    }
    if (!isBuyerCapabilityEnabled(user)) {
      return res.status(403).json(enableBuyerDenied());
    }
    req.exchangeUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Guests may browse/save. Sellers need Become a Buyer before cart/wishlist. */
export async function forbidSellerCommerce(req, res, next) {
  try {
    const pinitId = pinitIdFromReq(req) || maybePinitFromBuyerKey(req);
    if (!pinitId) return next();
    const user = await findUserByPinitId(pinitId);
    if (user) req.exchangeUser = user;
    if (user && isSellerRole(user.role) && !isBuyerCapabilityEnabled(user)) {
      return res.status(403).json(enableBuyerDenied());
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export { buyerDeniedSellerAction };
