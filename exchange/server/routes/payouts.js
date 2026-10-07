import express from 'express';
import crypto from 'crypto';
import { requireSeller, requireActiveSeller } from '../lib/rbac.js';
import { allSql, getSql, runSql, withImmediateTransaction } from '../lib/db.js';
import { sellerMatchClause } from '../lib/pinit-identity.js';
import { activeCurrency } from '../lib/money.js';
import { reviewPayoutAccount } from '../lib/payout-account.js';
import { withdrawalStatementDocument, renderFinancialPdf } from '../lib/financial-document.js';

const router = express.Router();

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function accountView(row) {
  if (!row) return null;
  return {
    id: row.id,
    account_holder: row.account_holder,
    ifsc: row.ifsc,
    last4: row.last4,
    status: row.status,
    verified_at: row.verified_at,
  };
}

async function loadAccount(pinitId) {
  const scope = sellerMatchClause('pinit_id', pinitId);
  return getSql(
    `SELECT id, account_holder, ifsc, last4, status, verified_at
     FROM seller_payout_accounts
     WHERE ${scope.sql.replace(/^\s*AND\s+/i, '')} AND status = 'verified'
     ORDER BY verified_at DESC LIMIT 1`,
    scope.params,
  );
}

async function availableEarnings(pinitId) {
  const scope = sellerMatchClause('seller_pinit_id', pinitId);
  const where = scope.sql.replace(/^\s*AND\s+/i, '');
  const rows = await allSql(
    `SELECT id, net_amount FROM seller_earnings
     WHERE ${where}
       AND status = 'accrued'
       AND (payout_id IS NULL OR payout_id = '')`,
    scope.params,
  );
  const amount = money(rows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0));
  return { rows, amount, currency: activeCurrency() };
}

router.get('/', requireSeller, async (req, res) => {
  try {
    const pinitId = req.exchangeUser.pinit_id;
    const account = await loadAccount(pinitId);
    const available = await availableEarnings(pinitId);
    const scope = sellerMatchClause('seller_pinit_id', pinitId);
    const where = scope.sql.replace(/^\s*AND\s+/i, '');
    const payouts = await allSql(
      `SELECT id, amount, currency, status, earnings_count, requested_at, settled_at
       FROM payouts WHERE ${where}
       ORDER BY requested_at DESC LIMIT 20`,
      scope.params,
    );
    const clearing = money(
      payouts.filter((row) => row.status === 'requested' || row.status === 'processing')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    );
    res.json({
      account: accountView(account),
      available: available.amount,
      clearing,
      currency: available.currency,
      payouts,
    });
  } catch (err) {
    console.error('[payouts] summary', err.message);
    res.status(500).json({ error: 'PAYOUT_SUMMARY_FAILED', message: 'Earnings could not be loaded.' });
  }
});

router.post('/account', requireActiveSeller, async (req, res) => {
  const reviewed = reviewPayoutAccount(req.body || {});
  if (!reviewed.ok) {
    return res.status(400).json({ error: 'ACCOUNT_REJECTED', message: reviewed.error });
  }
  const pinitId = req.exchangeUser.pinit_id;
  const { holder, ifsc, last4, fingerprint } = reviewed.value;
  try {
    const existing = await getSql(
      'SELECT id FROM seller_payout_accounts WHERE pinit_id = ? AND account_fingerprint = ? AND status = \'verified\' LIMIT 1',
      [pinitId, fingerprint],
    );
    if (existing) {
      const account = await loadAccount(pinitId);
      return res.json({ account: accountView(account), message: 'This payout account is already verified.' });
    }
    await runSql('DELETE FROM seller_payout_accounts WHERE pinit_id = ?', [pinitId]);
    const id = `PAC-${crypto.randomUUID()}`;
    await runSql(
      `INSERT INTO seller_payout_accounts (
        id, pinit_id, account_holder, ifsc, last4, account_fingerprint, status, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'verified', CURRENT_TIMESTAMP)`,
      [id, pinitId, holder, ifsc, last4, fingerprint],
    );
    const account = await loadAccount(pinitId);
    res.status(201).json({
      account: accountView(account),
      message: 'Payout account verified and saved.',
    });
  } catch (err) {
    console.error('[payouts] account', err.message);
    res.status(500).json({ error: 'ACCOUNT_SAVE_FAILED', message: 'The payout account could not be saved.' });
  }
});

router.post('/withdraw', requireActiveSeller, async (req, res) => {
  const pinitId = req.exchangeUser.pinit_id;
  try {
    const account = await loadAccount(pinitId);
    if (!account) {
      return res.status(409).json({
        error: 'ACCOUNT_REQUIRED',
        message: 'Add a verified payout account before withdrawing.',
      });
    }
    const currency = activeCurrency();
    const result = await withImmediateTransaction(async ({ allSql: txAll, runSql: txRun }) => {
      const scope = sellerMatchClause('seller_pinit_id', pinitId);
      const where = scope.sql.replace(/^\s*AND\s+/i, '');
      const rows = await txAll(
        `SELECT id, net_amount FROM seller_earnings
         WHERE ${where}
           AND status = 'accrued'
           AND (payout_id IS NULL OR payout_id = '')`,
        scope.params,
      );
      const amount = money(rows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0));
      if (!rows.length || amount <= 0) {
        const err = new Error('Nothing is available to withdraw.');
        err.status = 409;
        err.code = 'NOTHING_AVAILABLE';
        throw err;
      }
      const payoutId = `PO-${crypto.randomUUID()}`;
      await txRun(
        `INSERT INTO payouts (
          id, seller_pinit_id, amount, currency, status, provider, earnings_count
        ) VALUES (?, ?, ?, ?, 'requested', 'bank', ?)`,
        [payoutId, pinitId, amount, currency, rows.length],
      );
      const placeholders = rows.map(() => '?').join(', ');
      await txRun(
        `UPDATE seller_earnings
         SET payout_id = ?
         WHERE id IN (${placeholders})
           AND status = 'accrued'
           AND (payout_id IS NULL OR payout_id = '')`,
        [payoutId, ...rows.map((row) => row.id)],
      );
      return { payoutId, amount, currency, count: rows.length };
    });
    res.status(201).json({
      payout: {
        id: result.payoutId,
        amount: result.amount,
        currency: result.currency,
        status: 'requested',
        earnings_count: result.count,
        account_last4: account.last4,
      },
      message: `Withdrawal of the available balance was requested to the account ending ${account.last4}.`,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'WITHDRAW_FAILED', message: err.message });
    }
    console.error('[payouts] withdraw', err.message);
    res.status(500).json({ error: 'WITHDRAW_FAILED', message: 'The withdrawal could not be requested.' });
  }
});

router.get('/:id/statement', requireActiveSeller, async (req, res) => {
  try {
    const pinitId = req.exchangeUser.pinit_id;
    const scope = sellerMatchClause('seller_pinit_id', pinitId);
    const where = scope.sql.replace(/^\s*AND\s+/i, '');
    const payout = await getSql(
      `SELECT id, amount, currency, status, requested_at FROM payouts WHERE id = ? AND ${where}`,
      [req.params.id, ...scope.params],
    );
    if (!payout) return res.status(404).json({ error: 'STATEMENT_NOT_FOUND', message: 'Withdrawal not found.' });
    const account = await loadAccount(pinitId);
    const document = withdrawalStatementDocument({
      user: { name: req.exchangeUser.name, pinit_id: pinitId },
      payout,
      last4: account?.last4,
    });
    if (req.query.format === 'pdf' || req.query.format == null) {
      const pdf = renderFinancialPdf(document);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${document.number}.pdf"`);
      return res.send(pdf);
    }
    res.json({ document });
  } catch (err) {
    console.error('[payouts] statement', err.message);
    res.status(500).json({ error: 'STATEMENT_FAILED', message: 'The withdrawal statement could not be loaded.' });
  }
});

export default router;
