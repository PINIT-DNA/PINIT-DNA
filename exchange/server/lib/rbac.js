import { getSql } from './db.js';
import { identityCandidates } from './pinit-identity.js';
import {
  canList,
  canPurchase,
  buyerDeniedList,
  sellerDeniedPurchase,
  buyerDeniedSellerAction,
} from './roles.js';

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

export function pinitIdFromReq(req) {
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

export async function requireBuyer(req, res, next) {
  try {
    const pinitId = pinitIdFromReq(req) || maybePinitFromBuyerKey(req);
    if (!pinitId) {
      return res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'Sign in as a buyer to purchase or post requirements.',
      });
    }
    const user = await findUserByPinitId(pinitId);
    if (!user || !canPurchase(user.role)) {
      return res.status(403).json(sellerDeniedPurchase());
    }
    req.exchangeUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Guests may browse/save; signed sellers cannot use buyer commerce. */
export async function forbidSellerCommerce(req, res, next) {
  try {
    const pinitId = pinitIdFromReq(req) || maybePinitFromBuyerKey(req);
    if (!pinitId) return next();
    const user = await findUserByPinitId(pinitId);
    if (user && !canPurchase(user.role)) {
      return res.status(403).json(sellerDeniedPurchase());
    }
    if (user) req.exchangeUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export { buyerDeniedSellerAction };
