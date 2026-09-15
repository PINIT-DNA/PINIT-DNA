import express from 'express';
import db from '../database.js';
import { requireBuyer, requireSeller } from '../lib/rbac.js';
import { allSql } from '../lib/db.js';

const router = express.Router();

/**
 * Proposal counts come from the proposals table, never from the stored column.
 *
 * `requirements.proposals_count` used to be the only record that a creator had
 * answered a brief — incremented on submit, with nothing else written down.
 * The column is still maintained for anything that reads it directly, but a
 * count that disagrees with the rows is a count that is wrong, so every list
 * here is corrected on read.
 */
async function withLiveCounts(rows) {
  if (!rows || rows.length === 0) return rows || [];
  const ids = rows.map((r) => r.req_id);
  const holes = ids.map(() => '?').join(', ');
  const counts = await allSql(
    `SELECT req_id, COUNT(*) AS n FROM proposals
     WHERE req_id IN (${holes}) AND status <> 'withdrawn'
     GROUP BY req_id`,
    ids,
  );
  const byId = new Map(counts.map((c) => [c.req_id, Number(c.n) || 0]));
  return rows.map((r) => ({ ...r, proposals_count: byId.get(r.req_id) || 0 }));
}

function sendWithCounts(res, rows) {
  withLiveCounts(rows)
    .then((out) => res.json(out))
    // The proposals table is created on boot; if the read fails, the briefs
    // themselves are still worth serving.
    .catch(() => res.json(rows));
}

// Get all open requirement briefs
router.get('/', (req, res) => {
  const mine = String(req.query.mine || '') === '1';
  const pinitId = String(req.query.pinit_id || req.query.buyer_pinit_id || '').trim();
  if (mine && pinitId) {
    db.all(
      `SELECT * FROM requirements
       WHERE buyer_pinit_id = ? OR (buyer_pinit_id IS NULL AND buyer_name = ?)
       ORDER BY created_at DESC`,
      [pinitId, String(req.query.buyer_name || '')],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        sendWithCounts(res, rows || []);
      },
    );
    return;
  }
  db.all("SELECT * FROM requirements ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    sendWithCounts(res, rows || []);
  });
});

// Post a new requirement brief
router.post('/', requireBuyer, (req, res) => {
  const {
    buyer_name, buyer_org, title, description, vertical, budget, deadline,
    pinit_id, buyer_pinit_id, creators_needed,
  } = req.body;
  const buyerPinit = String(buyer_pinit_id || pinit_id || req.exchangeUser?.pinit_id || '').trim();

  if (!buyer_name || !title || !description || !budget) {
    return res.status(400).json({ error: "Missing required requirement fields" });
  }

  const reqId = 'REQ-' + Math.floor(1000 + Math.random() * 9000);
  const needed = Math.min(20, Math.max(1, Number(creators_needed) || 1));

  db.run(`
    INSERT INTO requirements (req_id, buyer_name, buyer_org, title, description, vertical, budget, deadline, proposals_count, status, buyer_pinit_id, creators_needed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', ?, ?)
  `, [
    reqId, buyer_name, buyer_org || 'Independent Buyer', title, description, vertical || 'concepts',
    Number(budget) || 1000, deadline || '2026-09-01', buyerPinit || null, needed,
  ], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT * FROM requirements WHERE req_id = ?", [reqId], (err, newReq) => {
      res.status(201).json({
        message: "Requirement brief published to Pinit Exchange",
        requirement: newReq
      });
    });
  });
});

/**
 * Legacy submit path.
 *
 * This used to be the whole feature: one UPDATE that incremented a counter and
 * recorded nothing about who proposed or what they were offering. It now
 * refuses rather than pretending, and points at the endpoint that writes a real
 * proposal. Kept as a route so an older frontend gets an explanation instead of
 * a 404.
 */
router.post('/:id/propose', requireSeller, (req, res) => {
  res.status(410).json({
    error: 'MOVED',
    message: 'Submitting a proposal now attaches protected work. Reload the page and try again.',
    use: `/api/opportunities/briefs/${req.params.id}/propose`,
  });
});

export default router;
