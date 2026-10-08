/**
 * Payout account and withdrawal. Isolated SQLite only.
 * A bad account is not stored. A withdrawal can settle an earning only once.
 */
process.env.EXCHANGE_ISOLATED_TEST = '1';
process.env.EXCHANGE_DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { initDatabase } = await import('../database.js');
const { runSql, getSql } = await import('../lib/db.js');
const { default: payouts } = await import('../routes/payouts.js');

await initDatabase();

const SELLER = 'PINIT-EX-PAY00001';
const BLOCKED = 'PINIT-EX-PAY00002';

await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, seller_onboarding_status)
   VALUES (?, 'PX-PAY1', 'Pay Seller', 'pay@example.com', 'creator', 'verified', 1, 'pro', 'SELLER_ACTIVE')`,
  [SELLER],
);
await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, seller_onboarding_status)
   VALUES (?, 'PX-PAY2', 'Blocked Seller', 'blocked@example.com', 'creator', 'verified', 1, 'pro', 'PAYMENT_METHOD_REQUIRED')`,
  [BLOCKED],
);
await runSql(
  `INSERT INTO seller_earnings (id, seller_pinit_id, order_id, seal_id, gross_amount, platform_fee, net_amount, status)
   VALUES ('EAR-1', ?, 'ORD-1', 'SEAL-1', 100, 15, 85, 'accrued')`,
  [SELLER],
);

const app = express();
app.use(express.json());
app.use('/api/seller/payouts', payouts);
const server = app.listen(0);
server.unref();
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, as, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { 'X-Pinit-Id': as } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.after(() => server.close());

const goodAccount = {
  holder: 'Ashwitha Reddy',
  accountNumber: '123456789012',
  confirmAccountNumber: '123456789012',
  ifsc: 'HDFC0001234',
};

test('a mismatched account is not saved', async () => {
  const res = await call('POST', '/api/seller/payouts/account', SELLER, {
    ...goodAccount,
    confirmAccountNumber: '123456789099',
  });
  assert.equal(res.status, 400);
  const row = await getSql('SELECT id FROM seller_payout_accounts WHERE pinit_id = ?', [SELLER]);
  assert.equal(row, null);
});

test('seller verification must be finished before an account can be added', async () => {
  const res = await call('POST', '/api/seller/payouts/account', BLOCKED, goodAccount);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'PAYMENT_VERIFICATION_REQUIRED');
});

test('a matching account is saved without the full number, then withdrawn once', async () => {
  const saved = await call('POST', '/api/seller/payouts/account', SELLER, goodAccount);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.account.last4, '9012');
  assert.equal(saved.body.account.account_number, undefined);
  const stored = await getSql('SELECT account_holder, last4, account_fingerprint FROM seller_payout_accounts WHERE pinit_id = ?', [SELLER]);
  assert.equal(stored.last4, '9012');
  assert.equal(String(stored.account_fingerprint).includes('123456789012'), false);

  const first = await call('POST', '/api/seller/payouts/withdraw', SELLER, {});
  assert.equal(first.status, 201);
  assert.equal(first.body.payout.amount, 85);
  assert.equal(first.body.payout.status, 'requested');

  const second = await call('POST', '/api/seller/payouts/withdraw', SELLER, {});
  assert.equal(second.status, 409);

  const summary = await call('GET', '/api/seller/payouts', SELLER);
  assert.equal(summary.body.available, 0);
  assert.equal(summary.body.clearing, 85);
});
