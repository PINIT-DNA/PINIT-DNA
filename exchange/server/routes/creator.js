import express from 'express';
import db from '../database.js';
import { requireSeller } from '../lib/rbac.js';

const router = express.Router();

// Creator Desk Consolidated Metrics
router.get('/desk', requireSeller, (req, res) => {
  const pinitId = String(req.query.pinit_id || '').trim();
  if (!pinitId) {
    return res.status(400).json({ error: 'pinit_id is required' });
  }

  db.get("SELECT * FROM users WHERE pinit_id = ?", [pinitId], (err, userRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!userRow) {
      return res.status(404).json({ error: 'Seller not found for this Pinit ID' });
    }
    const user = userRow;

    // Fetch Creator Listings (seller-scoped)
    db.all("SELECT * FROM listings WHERE pinit_id = ? ORDER BY created_at DESC", [pinitId], (err, listings) => {
      if (err) return res.status(500).json({ error: err.message });

      // Fetch Creator Sealed Sales (seller-scoped)
      db.all("SELECT * FROM orders_sealed WHERE seller_pinit_id = ? ORDER BY sealed_at DESC", [pinitId], (err, sales) => {
        if (err) return res.status(500).json({ error: err.message });

        // Fetch Post-Sale Tracking Jobs
        db.all("SELECT * FROM tracking_jobs WHERE seller_pinit_id = ?", [pinitId], (err, trackingJobs) => {
          if (err) return res.status(500).json({ error: err.message });

          // Fetch Open Requirements
          db.all("SELECT * FROM requirements WHERE status = 'open' ORDER BY budget DESC", [], (err, requirements) => {
            if (err) return res.status(500).json({ error: err.message });

            // Calculate aggregate metrics
            const totalGrossRevenue = sales.reduce((acc, s) => acc + (s.price_paid || 0), 0);
            const totalNetRevenue = sales.reduce((acc, s) => acc + (s.creator_net || 0), 0);
            const totalViews = listings.reduce((acc, l) => acc + (l.views || 0), 0);
            const totalSaves = listings.reduce((acc, l) => acc + (l.saves || 0), 0);
            const activeCount = listings.filter((l) => l.status === 'live' || l.status === 'published').length;

            res.json({
              user: user,
              metrics: {
                total_gross_revenue: Math.round(totalGrossRevenue * 100) / 100,
                total_net_revenue: Math.round(totalNetRevenue * 100) / 100,
                total_views: totalViews,
                total_saves: totalSaves,
                active_listings_count: activeCount,
                sealed_sales_count: sales.length,
                payout_pending: Math.round(totalNetRevenue * 100) / 100
              },
              listings: listings,
              sealed_sales: sales,
              tracking_jobs: trackingJobs,
              requirements: requirements
            });
          });
        });
      });
    });
  });
});

export default router;
