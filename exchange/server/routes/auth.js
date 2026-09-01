import express from 'express';
import db from '../database.js';
import { verifyHubBridgeToken } from '../hub-client.js';
import { extractPinitCode, identityCandidates, toExchangePinitId } from '../lib/pinit-identity.js';
import { enrichPublicUser, isSellerRole } from '../lib/roles.js';
import { findUserByPinitId, resolveIdentity, requireVerifiedIdentity } from '../lib/rbac.js';
import { mintSessionToken } from '../lib/session-token.js';
import { initialCreatorOnboardingStatus, ONBOARDING } from '../lib/seller-onboarding.js';

const router = express.Router();

function mintExchangeId() {
  return 'PX-' + Math.floor(100000 + Math.random() * 900000);
}

function publicUser(row) {
  return enrichPublicUser(row);
}

let userColumnsReady = false;
function ensureUserColumns(cb) {
  if (userColumnsReady) return cb();
  // Additive columns for stock-agency style signup (safe if already present)
  const alters = [
    `ALTER TABLE users ADD COLUMN password_hash TEXT`,
    `ALTER TABLE users ADD COLUMN display_name TEXT`,
    `ALTER TABLE users ADD COLUMN creator_type TEXT`,
    `ALTER TABLE users ADD COLUMN org_name TEXT`,
    `ALTER TABLE users ADD COLUMN account_intent TEXT`,
    `ALTER TABLE users ADD COLUMN hub_linked INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN onboarding_step TEXT DEFAULT 'complete'`,
    `ALTER TABLE users ADD COLUMN seller_onboarding_status TEXT DEFAULT 'SELLER_ACTIVE'`,
    `ALTER TABLE users ADD COLUMN razorpay_customer_id TEXT`,
  ];
  let i = 0;
  const next = () => {
    if (i >= alters.length) {
      userColumnsReady = true;
      return cb();
    }
    db.run(alters[i], () => {
      i += 1;
      next();
    });
  };
  next();
}

/**
 * Get the caller's own profile.
 *
 * This returned a full user row — email, onboarding state, payment customer id
 * — for whatever pinit_id was passed in the query string, with no auth at all.
 * Pinit IDs are public, so that was an open profile lookup for any account.
 *
 * A verified session now takes precedence and can only ever read itself. The
 * query parameter is still honoured while sessions are being rolled out, but
 * once a token is present it decides, and a token may not read a different id.
 */
router.get('/me', (req, res) => {
  const { pinitId: identityId, verified } = resolveIdentity(req);
  const requested = String(req.query.pinit_id || '').trim();

  if (verified && requested) {
    const code = (v) => String(v || '').toUpperCase().split('-').pop();
    if (code(requested) !== code(identityId)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You can only read your own profile.',
      });
    }
  }

  const pinitId = verified ? identityId : requested;
  if (!pinitId) return res.status(400).json({ error: 'pinit_id is required' });
  ensureUserColumns(() => {
    const candidates = identityCandidates(pinitId);
    const ids = candidates.length ? candidates : [pinitId];
    const placeholders = ids.map(() => '?').join(', ');
    db.get(
      `SELECT * FROM users WHERE pinit_id IN (${placeholders}) ORDER BY CASE WHEN pinit_id LIKE 'PINIT-EX-%' THEN 0 ELSE 1 END LIMIT 1`,
      ids,
      (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Without a proven session this is an unauthenticated lookup by a public
      // Pinit ID, so it may only return what the marketplace already shows
      // publicly. The full row — email, KYC state, payment customer id —
      // requires a verified session.
      if (!verified) {
        const safe = publicUser(user);
        return res.json({
          pinit_id: safe.pinit_id,
          exchange_id: safe.exchange_id,
          name: safe.name,
          display_name: safe.display_name,
          role: safe.role,
          exchange_role: safe.exchange_role,
          account_type: safe.account_type,
          can_list: safe.can_list,
          can_purchase: safe.can_purchase,
          positioning: safe.positioning,
          seller_onboarding_complete: safe.seller_onboarding_complete,
          session_required: true,
        });
      }

      res.json(publicUser(user));
    });
  });
});

function hubIdentityRequired(res) {
  return res.status(403).json({
    error: 'HUB_BIOMETRIC_REQUIRED',
    message: 'Email and password are disabled on Exchange. Sign in with Pinit HUB biometric identity.',
    hub_url: process.env.HUB_APP_URL || 'http://localhost:3002',
    action: 'continue_with_hub',
  });
}

/** POST /api/auth/signup — disabled. Identity is Hub biometric SSO only. */
router.post('/signup', (_req, res) => hubIdentityRequired(res));

/** POST /api/auth/login — disabled. Identity is Hub biometric SSO only. */
router.post('/login', (_req, res) => hubIdentityRequired(res));

/**
 * POST /api/auth/hub-sso
 * Consume Hub SSO token (Continue with Pinit HUB).
 */
router.post('/hub-sso', (req, res) => {
  ensureUserColumns(() => {
    const token = req.body?.token || req.body?.hub_sso;
    let payload;
    try {
      payload = verifyHubBridgeToken(token, 'exchange_sso');
    } catch (e) {
      return res.status(e.status || 401).json({
        error: e.message || 'Invalid Hub SSO token',
        hint: 'Open Pinit HUB, sign in, then use Exchange from the Hub top bar — or Continue with Pinit HUB here.',
      });
    }

    const incomingId = payload.pinitId || payload.rootPinitId;
    const code = extractPinitCode(incomingId);
    if (!code) {
      return res.status(401).json({ error: 'Hub SSO token missing Pinit ID' });
    }
    const pinitId = toExchangePinitId(incomingId);
    const requested = String(req.body?.intent || payload.intent || '').toLowerCase() === 'creator'
      ? 'creator'
      : 'buyer';
    const name = payload.name || (requested === 'creator' ? 'Pinit Creator' : 'Pinit Buyer');
    const email = payload.email || `ex-${code.toLowerCase()}@pinithub.local`;
    const mintedExchangeId = pinitId;
    const role = requested;
    const kyc = requested === 'creator' ? 'pending' : 'not_required';
    const sellerPlan = requested === 'creator' ? 'starter' : null;
    const onboarding = requested === 'creator' ? 'protect_in_hub' : 'complete';
    const sellerOnboarding = requested === 'creator'
      ? ONBOARDING.PAYMENT_METHOD_REQUIRED
      : null;
    const candidates = identityCandidates(incomingId);
    const placeholders = candidates.map(() => '?').join(', ');

    const respondWithUser = (user) => {
      const isCreator = user?.role === 'creator';
      // This is the only place identity is genuinely proven — the Hub token
      // above was signature-checked — so it is the only place a session token
      // is minted. Nothing that merely takes a Pinit ID may issue one.
      const sessionToken = mintSessionToken(user?.pinit_id);
      res.json({
        message: isCreator
          ? 'Signed in with Pinit HUB biometric — protect vault assets, then list them on Exchange.'
          : 'Signed in with Pinit HUB biometric. You can browse and purchase licenses.',
        user: publicUser(user),
        session_token: sessionToken,
        hub_linked: true,
        biometric_verified: true,
        next_step: isCreator
          ? { action: 'protect_in_hub', hub_url: process.env.HUB_APP_URL || 'http://localhost:3002' }
          : { action: 'browse_marketplace' },
      });
    };

    db.get(
      `SELECT * FROM users WHERE pinit_id IN (${placeholders}) ORDER BY CASE
        WHEN pinit_id LIKE 'PINIT-EX-%' THEN 0 ELSE 1 END LIMIT 1`,
      candidates,
      (lookupErr, existing) => {
        if (lookupErr) return res.status(500).json({ error: lookupErr.message });

        if (existing) {
          const keepActive = initialCreatorOnboardingStatus(existing);
          db.run(`
            UPDATE users SET
              pinit_id = ?,
              name = COALESCE(?, name),
              email = COALESCE(?, email),
              account_intent = COALESCE(account_intent, ?),
              hub_linked = 1,
              biometric_verified = 1,
              exchange_id = COALESCE(exchange_id, ?),
              display_name = COALESCE(display_name, ?),
              seller_plan = COALESCE(seller_plan, ?),
              onboarding_step = CASE
                WHEN onboarding_step = 'complete' THEN 'complete'
                WHEN ? = 'creator' THEN 'protect_in_hub'
                ELSE COALESCE(onboarding_step, 'complete')
              END,
              seller_onboarding_status = CASE
                WHEN seller_onboarding_status IN ('SELLER_ACTIVE', 'PAYMENT_METHOD_VERIFIED') THEN seller_onboarding_status
                WHEN ? = 'creator' AND role = 'creator' THEN COALESCE(seller_onboarding_status, ?)
                ELSE COALESCE(seller_onboarding_status, 'SELLER_ACTIVE')
              END
            WHERE pinit_id = ?
          `, [
            pinitId,
            name,
            email,
            requested,
            mintedExchangeId,
            name,
            sellerPlan,
            requested,
            requested,
            keepActive === ONBOARDING.SELLER_ACTIVE ? keepActive : ONBOARDING.PAYMENT_METHOD_REQUIRED,
            existing.pinit_id,
          ], (updErr) => {
            if (updErr) return res.status(500).json({ error: updErr.message });
            db.get('SELECT * FROM users WHERE pinit_id = ?', [pinitId], (err2, user) => {
              if (err2) return res.status(500).json({ error: err2.message });
              respondWithUser(user);
            });
          });
          return;
        }

        db.run(`
          INSERT INTO users (
            pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified,
            seller_plan, bio, display_name, account_intent, hub_linked, onboarding_step,
            seller_onboarding_status
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'Connected via Pinit HUB biometric', ?, ?, 1, ?, ?)
        `, [
          pinitId, mintedExchangeId, name, email, role, kyc, sellerPlan, name, requested,
          onboarding, sellerOnboarding || 'SELLER_ACTIVE',
        ], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          db.get('SELECT * FROM users WHERE pinit_id = ?', [pinitId], (err2, user) => {
            if (err2) return res.status(500).json({ error: err2.message });
            respondWithUser(user);
          });
        });
      },
    );
  });
});

/** PATCH profile fields without changing marketplace role. */
router.post('/profile', async (req, res) => {
  try {
    const targetId = String(req.body?.pinit_id || '').trim();
    if (!targetId) return res.status(400).json({ error: 'pinit_id is required' });
    const existing = await findUserByPinitId(targetId);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const { name, email, bio, display_name } = req.body || {};
    db.run(
      `UPDATE users SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        bio = COALESCE(?, bio),
        display_name = COALESCE(?, display_name)
       WHERE pinit_id = ?`,
      [name || null, email || null, bio || null, display_name || null, existing.pinit_id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get('SELECT * FROM users WHERE pinit_id = ?', [existing.pinit_id], (err2, updated) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ message: 'Profile updated', user: publicUser(updated) });
        });
      },
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Controlled buyer → creator conversion. Never automatic from Hub upload.
 */
router.post('/become-creator', requireVerifiedIdentity, async (req, res) => {
  try {
    const targetId = req.verifiedPinitId;
    if (!targetId) return res.status(400).json({ error: 'pinit_id is required' });
    const existing = await findUserByPinitId(targetId);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (isSellerRole(existing.role)) {
      return res.json({
        message: 'Already a Creator account',
        user: publicUser(existing),
      });
    }

    /**
     * Never charge someone twice for an activation they already completed.
     *
     * This used to set PAYMENT_METHOD_REQUIRED unconditionally, guarding only
     * on the caller's *current* role. Anyone who had activated before and was
     * not a creator at this moment — a role switched back and forth, an account
     * restored — was silently downgraded: their verified payment method stayed
     * in the table while their user row went back to "must pay", which hides
     * the listing tools and pushes every seller page to the payment screen.
     *
     * The payment method table is the record of what was actually paid, so it
     * decides. A returning creator resumes as active; a genuinely new one still
     * has to pay.
     */
    const paid = await new Promise((resolve) => {
      db.get(
        `SELECT id FROM seller_payment_methods
          WHERE pinit_id = ? AND status = 'verified' LIMIT 1`,
        [existing.pinit_id],
        (err, row) => resolve(err ? null : row),
      );
    });
    const nextStatus = paid ? ONBOARDING.SELLER_ACTIVE : ONBOARDING.PAYMENT_METHOD_REQUIRED;

    db.run(
      `UPDATE users SET
        role = 'creator',
        account_intent = 'creator',
        seller_plan = COALESCE(seller_plan, 'starter'),
        kyc_status = CASE WHEN kyc_status = 'not_required' THEN 'pending' ELSE kyc_status END,
        onboarding_step = 'protect_in_hub',
        seller_onboarding_status = ?
       WHERE pinit_id = ?`,
      [nextStatus, existing.pinit_id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get('SELECT * FROM users WHERE pinit_id = ?', [existing.pinit_id], (err2, updated) => {
          if (err2) return res.status(500).json({ error: err2.message });
          // The next step follows the status decided above, so a returning
          // creator is not sent to a payment screen for an activation they
          // have already paid for.
          res.json({
            message: paid
              ? 'Creator account restored. Your activation is already paid — you can list straight away.'
              : 'Seller capability added. Pay the ₹2,500 subscription to start listing. Buying on this account is unchanged.',
            user: publicUser(updated),
            next_step: paid
              ? { action: 'start_listing', path: '/exchange/seller/listings' }
              : { action: 'verify_payment_method', path: '/exchange/seller/onboarding/payment' },
          });
        });
      },
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Profile / Seller Onboarding — does NOT convert buyers unless become_creator=true
router.post('/onboard-seller', async (req, res) => {
  try {
    const { pinit_id, name, email, bio, seller_plan, display_name, creator_type, become_creator } = req.body || {};
    const targetId = pinit_id;
    if (!targetId) return res.status(400).json({ error: 'pinit_id is required' });
    const existing = await findUserByPinitId(targetId);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const convert = Boolean(become_creator) || isSellerRole(existing.role);
    const exchangeId = mintExchangeId();

    db.run(`
      UPDATE users
      SET name = COALESCE(?, name),
          email = COALESCE(?, email),
          bio = COALESCE(?, bio),
          seller_plan = COALESCE(?, seller_plan),
          display_name = COALESCE(?, display_name),
          creator_type = COALESCE(?, creator_type),
          biometric_verified = 1,
          exchange_id = COALESCE(exchange_id, ?),
          role = CASE WHEN ? = 'yes' THEN 'creator' ELSE role END,
          account_intent = CASE WHEN ? = 'yes' THEN 'creator' ELSE account_intent END,
          onboarding_step = CASE WHEN ? = 'yes' THEN 'complete' ELSE onboarding_step END
      WHERE pinit_id = ?
    `, [
      name, email, bio, seller_plan, display_name, creator_type, exchangeId,
      convert ? 'yes' : 'no', convert ? 'yes' : 'no', convert ? 'yes' : 'no',
      existing.pinit_id,
    ], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.get('SELECT * FROM users WHERE pinit_id = ?', [existing.pinit_id], (err2, updatedUser) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({
          message: convert && !isSellerRole(existing.role)
            ? 'Seller onboarding completed successfully'
            : 'Settings updated',
          user: publicUser(updatedUser),
        });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
