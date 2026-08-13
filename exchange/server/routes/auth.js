import express from 'express';
import db from '../database.js';
import { verifyHubBridgeToken } from '../hub-client.js';
import { extractPinitCode, identityCandidates, toExchangePinitId } from '../lib/pinit-identity.js';
import { enrichPublicUser, isSellerRole } from '../lib/roles.js';
import { findUserByPinitId } from '../lib/rbac.js';

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

// Get current logged-in user profile
router.get('/me', (req, res) => {
  const pinitId = req.query.pinit_id;
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
      res.json(publicUser(user));
    });
  });
});

function hubIdentityRequired(res) {
  return res.status(403).json({
    error: 'HUB_BIOMETRIC_REQUIRED',
    message: 'Email and password are disabled on Exchange. Sign in with Pinit HUB biometric identity.',
    hub_url: process.env.HUB_APP_URL || 'http://localhost:3000',
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
    const candidates = identityCandidates(incomingId);
    const placeholders = candidates.map(() => '?').join(', ');

    const respondWithUser = (user) => {
      const isCreator = user?.role === 'creator';
      res.json({
        message: isCreator
          ? 'Signed in with Pinit HUB biometric — protect vault assets, then list them on Exchange.'
          : 'Signed in with Pinit HUB biometric. You can browse and purchase licenses.',
        user: publicUser(user),
        hub_linked: true,
        biometric_verified: true,
        next_step: isCreator
          ? { action: 'protect_in_hub', hub_url: process.env.HUB_APP_URL || 'http://localhost:3000' }
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
            seller_plan, bio, display_name, account_intent, hub_linked, onboarding_step
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'Connected via Pinit HUB biometric', ?, ?, 1, ?)
        `, [pinitId, mintedExchangeId, name, email, role, kyc, sellerPlan, name, requested, onboarding], function(err) {
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
router.post('/become-creator', async (req, res) => {
  try {
    const targetId = String(req.body?.pinit_id || '').trim();
    if (!targetId) return res.status(400).json({ error: 'pinit_id is required' });
    const existing = await findUserByPinitId(targetId);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (isSellerRole(existing.role)) {
      return res.json({
        message: 'Already a Creator account',
        user: publicUser(existing),
      });
    }

    db.run(
      `UPDATE users SET
        role = 'creator',
        account_intent = 'creator',
        seller_plan = COALESCE(seller_plan, 'starter'),
        kyc_status = CASE WHEN kyc_status = 'not_required' THEN 'pending' ELSE kyc_status END,
        onboarding_step = 'protect_in_hub'
       WHERE pinit_id = ?`,
      [existing.pinit_id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get('SELECT * FROM users WHERE pinit_id = ?', [existing.pinit_id], (err2, updated) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({
            message: 'You are now a Creator. Protect assets in Pinit HUB, then list them here.',
            user: publicUser(updated),
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
