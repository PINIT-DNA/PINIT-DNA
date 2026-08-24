import express from 'express';
import { requireSeller } from '../lib/rbac.js';
import {
  assemblePortfolio,
  ensureProfile,
  findUserForSlug,
  saveProfile,
} from '../lib/portfolio.js';

const router = express.Router();

function sendPortfolio(res, payload, extra = {}) {
  if (!payload || typeof payload !== 'object') {
    return res.status(500).json({
      error: 'PORTFOLIO_EMPTY',
      message: 'Portfolio API returned an invalid response.',
    });
  }
  return res.json({
    ...extra,
    portfolio: payload,
    ...payload,
  });
}

function fail(res, err, fallbackMessage) {
  const status = Number(err?.status) || 500;
  console.error('[portfolio]', fallbackMessage, err?.message || err);
  if (status === 409) {
    return res.status(409).json({
      error: 'SLUG_TAKEN',
      message: 'That portfolio URL is already taken',
    });
  }
  if (status === 401) {
    return res.status(401).json({
      error: 'AUTH_REQUIRED',
      message: 'Your session has expired.',
    });
  }
  if (status === 403) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'You do not have access to this portfolio.',
    });
  }
  if (status === 404) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: err?.message || 'Portfolio not found',
    });
  }
  return res.status(status).json({
    error: 'PORTFOLIO_FAILED',
    message: fallbackMessage,
  });
}

router.get('/public/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const found = await findUserForSlug(slug);
    if (!found?.user || !found?.profile) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Portfolio not found' });
    }
    const payload = await assemblePortfolio(found.user, found.profile, { ownerView: false });
    if (!payload) {
      return res.status(404).json({ error: 'NOT_PUBLIC', message: 'This portfolio is not public' });
    }
    return sendPortfolio(res, payload);
  } catch (err) {
    return fail(res, err, 'Unable to load portfolio. Please try again.');
  }
});

router.get('/me', requireSeller, async (req, res) => {
  try {
    const user = req.exchangeUser;
    if (!user?.pinit_id) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Your session has expired.' });
    }
    const profile = await ensureProfile(user);
    if (!profile) {
      return res.status(500).json({
        error: 'PORTFOLIO_INIT_FAILED',
        message: 'Unable to load portfolio. Please try again.',
      });
    }
    const payload = await assemblePortfolio(user, profile, { ownerView: true });
    if (!payload) {
      return res.status(500).json({
        error: 'PORTFOLIO_ASSEMBLE_FAILED',
        message: 'Unable to load portfolio. Please try again.',
      });
    }
    return sendPortfolio(res, payload);
  } catch (err) {
    return fail(res, err, 'Unable to load portfolio. Please try again.');
  }
});

router.put('/me', requireSeller, async (req, res) => {
  try {
    const user = req.exchangeUser;
    if (!user?.pinit_id) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Your session has expired.' });
    }
    const publish = Boolean(req.body?.publish);
    const profile = await saveProfile(user.pinit_id, req.body || {}, { publish });
    const payload = await assemblePortfolio(user, profile, { ownerView: true });
    if (!payload) {
      return res.status(500).json({
        error: 'PORTFOLIO_ASSEMBLE_FAILED',
        message: publish ? 'Could not publish portfolio.' : 'Could not save portfolio.',
      });
    }
    return sendPortfolio(res, payload, {
      message: publish ? 'Portfolio published' : 'Portfolio saved',
    });
  } catch (err) {
    return fail(res, err, req.body?.publish ? 'Could not publish portfolio.' : 'Could not save portfolio.');
  }
});

export default router;
