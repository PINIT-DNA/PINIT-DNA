/**
 * Sale receipts, seller copies, credit notes, verification receipts and
 * withdrawal statements share one document. Isolated SQLite only.
 */
process.env.EXCHANGE_ISOLATED_TEST = '1';
process.env.EXCHANGE_DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { initDatabase } = await import('../database.js');
const { runSql } = await import('../lib/db.js');
const { default: orders } = await import('../routes/orders.js');
const { default: onboarding } = await import('../routes/seller-onboarding.js');
const { default: payouts } = await import('../routes/payouts.js');

await initDatabase();

const SELLER = 'PINIT-EX-DOC00001';
const BUYER = 'PINIT-EX-DOC00002';
const OTHER = 'PINIT-EX-DOC00003';

await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, seller_onboarding_status)
   VALUES (?, 'PX-DOC1', 'Seller One', 'seller-doc@example.com', 'creator', 'verified', 1, 'pro', 'SELLER_ACTIVE')`,
  [SELLER],
);
await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, seller_onboarding_status)
   VALUES (?, 'PX-DOC2', 'Buyer Two', 'buyer-doc@example.com', 'buyer', 'verified', 1, 'free', 'PAYMENT_METHOD_REQUIRED')`,
  [BUYER],
);
await runSql(
  `INSERT INTO orders_sealed (
     seal_id, order_id, listing_id, asset_id, seller_pinit_id, seller_exchange_id,
     buyer_pinit_id, buyer_name, buyer_email, license_tier, price_paid, platform_fee,
     creator_net, dna_hash_summary, status, payment_status, currency, invoice_number, sealed_at
   ) VALUES (
     'SEAL-DOC1', 'ORD-DOC1', 'LIST-1', 'ASSET-1', ?, 'PX-DOC1',
     ?, 'Buyer Two', 'buyer-doc@example.com', 'standard', 100, 7,
     93, 'hash', 'sealed', 'paid', 'INR', 'INV-2026-DOC1', '2026-10-01T00:00:00.000Z'
   )`,
  [SELLER, BUYER],
);

const app = express();
app.use(express.json());
app.use('/api/orders', orders);
app.use('/api/seller/onboarding', onboarding);
app.use('/api/seller/payouts', payouts);
const server = app.listen(0);
server.unref();
const base = `http://127.0.0.1:${server.address().port}`;

function headers(as, json = true) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(as ? { 'X-Pinit-Id': as } : {}),
  };
}

async function getJson(path, as) {
  const res = await fetch(base + path, { headers: headers(as) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.after(() => server.close());

test('buyer receipt uses the stored platform fee and is not a tax invoice', async () => {
  const res = await getJson('/api/orders/invoice/SEAL-DOC1', BUYER);
  assert.equal(res.status, 200);
  const doc = res.body.document;
  assert.equal(doc.title, 'Receipt');
  assert.equal(doc.number, 'INV-2026-DOC1');
  assert.equal(doc.parties.find((p) => p.role === 'Buyer').name, 'Buyer Two');
  assert.equal(doc.parties.find((p) => p.role === 'Seller').name, 'Seller One');
  const fee = doc.totals.find((row) => row.label === 'Platform fee (included)');
  assert.equal(fee.amount, 7);
  assert.equal(doc.totals.find((row) => row.label === 'Total paid').amount, 100);
  assert.equal(doc.tax.applied, false);
  assert.match(doc.tax.note, /not a tax invoice/i);
});

test('another person cannot open the receipt', async () => {
  const res = await getJson('/api/orders/invoice/SEAL-DOC1', OTHER);
  assert.equal(res.status, 404);
});

test('the seller copy uses the same stored amounts', async () => {
  const asBuyer = await getJson('/api/orders/invoice/SEAL-DOC1?audience=seller', BUYER);
  assert.equal(asBuyer.status, 404);
  const res = await getJson('/api/orders/invoice/SEAL-DOC1?audience=seller', SELLER);
  assert.equal(res.status, 200);
  assert.equal(res.body.document.title, 'Invoice');
  assert.equal(res.body.document.totals.find((row) => row.label === 'Platform fee').amount, -7);
  assert.equal(res.body.document.totals.find((row) => row.label === 'Net to seller').amount, 93);
});

test('the receipt PDF is a real PDF with the invoice number', async () => {
  const res = await fetch(base + '/api/orders/invoice/SEAL-DOC1?format=pdf', { headers: headers(BUYER, false) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/pdf/);
  const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.match(text, /PINIT/);
  assert.match(text, /INV-2026-DOC1/);
  assert.match(text, /Buyer Two/);
  assert.match(text, /Seller One/);
});

test('a credit note is refused until the order is refunded', async () => {
  const before = await getJson('/api/orders/credit-note/SEAL-DOC1', BUYER);
  assert.equal(before.status, 404);
  await runSql(
    `INSERT INTO refunds (id, order_id, seal_id, amount, reason, status) VALUES ('REF-DOC1', 'ORD-DOC1', 'SEAL-DOC1', 100, 'buyer_refund', 'completed')`,
  );
  await runSql(`UPDATE orders_sealed SET status = 'refunded', payment_status = 'refunded' WHERE seal_id = 'SEAL-DOC1'`);
  const res = await getJson('/api/orders/credit-note/SEAL-DOC1', SELLER);
  assert.equal(res.status, 200);
  assert.equal(res.body.document.title, 'Credit note');
  assert.equal(res.body.document.number, 'CN-INV-2026-DOC1');
  assert.equal(res.body.document.totals.find((row) => row.label === 'Amount refunded').amount, 100);
  assert.equal(res.body.document.references.find((row) => row.label === 'Original invoice').value, 'INV-2026-DOC1');
});

test('verification receipt exists only after a verified payment', async () => {
  const missing = await getJson('/api/seller/onboarding/receipt', SELLER);
  assert.equal(missing.status, 404);
  await runSql(
    `INSERT INTO seller_payment_methods (id, pinit_id, provider, provider_payment_id, status, verified_at)
     VALUES ('PM-DOC1', ?, 'razorpay', 'pay_doc123456789', 'verified', '2026-10-02T00:00:00.000Z')`,
    [SELLER],
  );
  const res = await getJson('/api/seller/onboarding/receipt', SELLER);
  assert.equal(res.status, 200);
  assert.equal(res.body.document.totals.find((row) => row.label === 'Amount paid').amount, 2500);
  assert.equal(res.body.document.parties[0].name, 'Seller One');
  const other = await getJson('/api/seller/onboarding/receipt', BUYER);
  assert.equal(other.status, 404);
});

test('hub subscription receipt uses the same document', async () => {
  const { hubSubscriptionDocument, renderFinancialPdf } = await import('../lib/financial-document.js');
  const doc = hubSubscriptionDocument({
    row: {
      number: 'INV-202610-ABCDEF',
      createdAt: '2026-10-01T00:00:00.000Z',
      status: 'SUCCEEDED',
      currency: 'INR',
      amount: 499,
      planName: 'Pro',
      transactionId: 'pay_hub1',
    },
    payer: { name: 'Hub Payer', pinitId: 'PINIT-USER-HUB1' },
  });
  assert.equal(doc.title, 'Receipt');
  assert.equal(doc.tax.applied, false);
  assert.equal(doc.totals.find((row) => row.label === 'Amount paid').amount, 499);
  const pdf = renderFinancialPdf(doc).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  assert.match(pdf, /INV-202610-ABCDEF/);
  assert.match(pdf, /Hub Payer/);
});
test('a withdrawal statement uses the stored amount and stays with its seller', async () => {
  await runSql(
    `INSERT INTO payouts (id, seller_pinit_id, amount, currency, status, requested_at)
     VALUES ('PO-DOC1', ?, 93, 'INR', 'requested', '2026-10-03T00:00:00.000Z')`,
    [SELLER],
  );
  const other = await getJson('/api/seller/payouts/PO-DOC1/statement?format=json', BUYER);
  assert.equal(other.status, 403);
  const res = await getJson('/api/seller/payouts/PO-DOC1/statement?format=json', SELLER);
  assert.equal(res.status, 200);
  assert.equal(res.body.document.totals.find((row) => row.label === 'Net amount').amount, 93);
  assert.equal(res.body.document.lines[0].amount, 93);
  assert.equal(res.body.document.totals.find((row) => row.label === 'Fees recorded').amount, 0);
  const pdf = await fetch(base + '/api/seller/payouts/PO-DOC1/statement', { headers: headers(SELLER, false) });
  const text = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.match(text, /PO-DOC1/);
});
