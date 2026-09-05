import express from 'express';
import { requireExchangeUser } from '../lib/rbac.js';
import {
  assemblePortfolio,
  findUserForSlug,
  listLegacyProfiles,
  loadPublishedFromHub,
  readProfileByPinitId,
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
    const previewToken = String(req.query.preview_token || req.query.pt || '').trim();
    const fromHub = await loadPublishedFromHub(slug, previewToken || undefined);
    if (fromHub) return sendPortfolio(res, fromHub);
    // Legacy read-only fallback until Hub backfill has a published snapshot.
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

router.get('/me', requireExchangeUser, async (req, res) => {
  try {
    const user = req.exchangeUser;
    if (!user?.pinit_id) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Your session has expired.' });
    }
    const local = await readProfileByPinitId(user.pinit_id);
    const slug = local?.slug;
    if (slug) {
      const fromHub = await loadPublishedFromHub(slug);
      if (fromHub) return sendPortfolio(res, fromHub);
    }
    return res.status(404).json({
      error: 'NOT_PUBLISHED',
      message: 'Publish your portfolio in Pinit HUB to see it here.',
    });
  } catch (err) {
    return fail(res, err, 'Unable to load portfolio. Please try again.');
  }
});

router.put('/me', requireExchangeUser, async (_req, res) => {
  return res.status(410).json({
    error: 'PORTFOLIO_OWNED_BY_HUB',
    message: 'Portfolio content is owned by Pinit HUB. Open the Hub editor to save or publish.',
  });
});

export default router;
