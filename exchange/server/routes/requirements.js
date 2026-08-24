import express from 'express';
import db from '../database.js';
import { requireBuyer, requireSeller } from '../lib/rbac.js';

const router = express.Router();

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
        res.json(rows || []);
      },
    );
    return;
  }
  db.all("SELECT * FROM requirements ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Post a new requirement brief
router.post('/', requireBuyer, (req, res) => {
  const { buyer_name, buyer_org, title, description, vertical, budget, deadline, pinit_id, buyer_pinit_id } = req.body;
  const buyerPinit = String(buyer_pinit_id || pinit_id || req.exchangeUser?.pinit_id || '').trim();

  if (!buyer_name || !title || !description || !budget) {
    return res.status(400).json({ error: "Missing required requirement fields" });
  }

  const reqId = 'REQ-' + Math.floor(1000 + Math.random() * 9000);

  db.run(`
    INSERT INTO requirements (req_id, buyer_name, buyer_org, title, description, vertical, budget, deadline, proposals_count, status, buyer_pinit_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', ?)
  `, [
    reqId, buyer_name, buyer_org || 'Independent Buyer', title, description, vertical || 'concepts',
    Number(budget) || 1000, deadline || '2026-09-01', buyerPinit || null,
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

// Submit proposal to requirement
router.post('/:id/propose', requireSeller, (req, res) => {
  const reqId = req.params.id;
  db.run("UPDATE requirements SET proposals_count = proposals_count + 1 WHERE req_id = ?", [reqId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Proposal submitted successfully to buyer brief", req_id: reqId });
  });
});

export default router;
