import express from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { verifyHubBridgeToken } from '../hub-client.js';

const router = express.Router();

function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(':')) return false;
  const [salt, hash] = String(stored).split(':');
  const next = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'));
}

function mintPinitId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'PINIT-';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function mintExchangeId() {
  return 'PX-' + Math.floor(100000 + Math.random() * 900000);
}

function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

function ensureUserColumns(cb) {
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
    if (i >= alters.length) return cb();
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
    db.get('SELECT * FROM users WHERE pinit_id = ?', [pinitId], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(publicUser(user));
    });
  });
});

/**
 * POST /api/auth/signup
 * Stock-agency style: buyer (customer) or creator (contributor)
 */
router.post('/signup', (req, res) => {
  ensureUserColumns(() => {
    const intent = req.body?.intent === 'creator' ? 'creator' : 'buyer';

    // Sellers MUST have a Pinit HUB account — no Exchange-only creator email signup
    if (intent === 'creator') {
      return res.status(403).json({
        error: 'HUB_ACCOUNT_REQUIRED',
        message: 'Sellers must create a Pinit HUB account first, protect their work in the vault, then continue with Pinit HUB to sell on Exchange.',
        hub_url: process.env.HUB_APP_URL || 'http://localhost:3000',
        action: 'continue_with_hub',
      });
    }

    const fullName = String(req.body?.full_name || '').trim();
    const displayName = String(req.body?.display_name || fullName).trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const creatorType = String(req.body?.creator_type || '').trim() || null;
    const bio = String(req.body?.bio || '').trim() || null;
    const orgName = String(req.body?.org_name || '').trim() || null;
    const acceptTerms = !!req.body?.accept_terms;
    const confirmOwnWork = !!req.body?.confirm_own_work;
    const confirmAge = !!req.body?.confirm_age;

    if (!fullName || !email || password.length < 8) {
      return res.status(400).json({ error: 'Name, email, and password (8+ chars) are required' });
    }
    if (!acceptTerms) {
      return res.status(400).json({ error: 'You must accept the terms' });
    }

    db.get('SELECT pinit_id FROM users WHERE email = ?', [email], (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists — sign in instead' });

      const pinitId = mintPinitId();
      const exchangeId = intent === 'creator' ? mintExchangeId() : null;
      const role = intent === 'creator' ? 'creator' : 'buyer';
      const passwordHash = hashPassword(password);
      const kyc = intent === 'creator' ? 'pending' : 'not_required';
      const sellerPlan = intent === 'creator' ? 'starter' : null;
      const onboarding = intent === 'creator' ? 'protect_in_hub' : 'complete';

      db.run(`
        INSERT INTO users (
          pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified,
          seller_plan, bio, password_hash, display_name, creator_type, org_name,
          account_intent, hub_linked, onboarding_step
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `, [
        pinitId,
        exchangeId,
        fullName,
        email,
        role,
        kyc,
        sellerPlan,
        bio,
        passwordHash,
        displayName,
        creatorType,
        orgName,
        intent,
        onboarding,
      ], function(insertErr) {
        if (insertErr) return res.status(500).json({ error: insertErr.message });
        db.get('SELECT * FROM users WHERE pinit_id = ?', [pinitId], (err2, user) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.status(201).json({
            message: intent === 'creator'
              ? 'Creator contributor account created. Protect assets in Pinit HUB, then list on Exchange.'
              : 'Buyer account created. You can browse and purchase licenses.',
            user: publicUser(user),
            next_step: intent === 'creator'
              ? { action: 'open_hub', url: process.env.HUB_APP_URL || 'http://localhost:3000', reason: 'protect_first' }
              : { action: 'browse_marketplace' },
          });
        });
      });
    });
  });
});

/** POST /api/auth/login */
router.post('/login', (req, res) => {
  ensureUserColumns(() => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user || !user.password_hash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      try {
        if (!verifyPassword(password, user.password_hash)) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
      } catch {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      res.json({ message: 'Signed in', user: publicUser(user) });
    });
  });
});

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

    const pinitId = payload.pinitId;
    if (!pinitId) {
      return res.status(401).json({ error: 'Hub SSO token missing Pinit ID' });
    }
    const name = payload.name || 'Pinit Creator';
    const email = payload.email || `${String(pinitId).toLowerCase().replace(/[^a-z0-9]/g, '')}@pinithub.local`;
    const exchangeId = mintExchangeId();

    db.run(`
      INSERT INTO users (
        pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified,
        seller_plan, bio, display_name, account_intent, hub_linked, onboarding_step
      ) VALUES (?, ?, ?, ?, 'creator', 'pending', 1, 'starter', 'Connected via Pinit HUB', ?, 'creator', 1, 'protect_in_hub')
      ON CONFLICT(pinit_id) DO UPDATE SET
        name = excluded.name,
        email = COALESCE(excluded.email, users.email),
        role = 'creator',
        account_intent = 'creator',
        hub_linked = 1,
        biometric_verified = 1,
        exchange_id = COALESCE(users.exchange_id, excluded.exchange_id),
        display_name = COALESCE(users.display_name, excluded.display_name),
        onboarding_step = CASE
          WHEN users.onboarding_step = 'complete' THEN 'complete'
          ELSE 'protect_in_hub'
        END
    `, [pinitId, exchangeId, name, email, name], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM users WHERE pinit_id = ?', [pinitId], (err2, user) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({
          message: 'Signed in with Pinit HUB — protect vault assets, then list them on Exchange.',
          user: publicUser(user),
          hub_linked: true,
          next_step: {
            action: 'protect_in_hub',
            hub_url: process.env.HUB_APP_URL || 'http://localhost:3000',
          },
        });
      });
    });
  });
});

// Update Profile / Seller Onboarding
router.post('/onboard-seller', (req, res) => {
  ensureUserColumns(() => {
    const { pinit_id, name, email, bio, seller_plan, display_name, creator_type } = req.body;
    const targetId = pinit_id;
    if (!targetId) return res.status(400).json({ error: 'pinit_id is required' });

    const exchangeId = mintExchangeId();

    db.run(`
      UPDATE users
      SET name = COALESCE(?, name),
          email = COALESCE(?, email),
          bio = COALESCE(?, bio),
          seller_plan = COALESCE(?, seller_plan),
          display_name = COALESCE(?, display_name),
          creator_type = COALESCE(?, creator_type),
          kyc_status = 'verified',
          biometric_verified = 1,
          exchange_id = COALESCE(exchange_id, ?),
          role = 'creator',
          account_intent = 'creator',
          onboarding_step = 'complete'
      WHERE pinit_id = ?
    `, [name, email, bio, seller_plan, display_name, creator_type, exchangeId, targetId], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.get('SELECT * FROM users WHERE pinit_id = ?', [targetId], (err2, updatedUser) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ message: 'Seller onboarding completed successfully', user: publicUser(updatedUser) });
      });
    });
  });
});

export default router;
