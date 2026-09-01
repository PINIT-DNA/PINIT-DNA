/**
 * HTTP end-to-end: seller SSO → subscription → listing → buyer cart →
 * mock Razorpay → sealed licence → Hub bridge confirm/seal/delivery.
 *
 * Spawns an isolated Exchange process + a stub Hub so this does not mutate
 * exchange.db and does not require Render.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exchangeRoot = path.join(__dirname, '..', '..');
const testDb = path.join(__dirname, 'e2e-marketplace.db');
const BRIDGE_SECRET = 'e2e-bridge-secret-min-32-characters!!';
const EXCHANGE_PORT = 18765;
const HUB_PORT = 18766;

let hubServer;
let exchangeProc;
let hubHits = { confirm: 0, seal: 0, delivery: 0, protect: 0 };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startHubStub() {
  hubServer = http.createServer((req, res) => {
    const secret = req.headers['x-pinit-bridge-secret'];
    if (secret !== BRIDGE_SECRET) {
      return json(res, 401, { error: 'Invalid bridge secret' });
    }
    const url = String(req.url || '').split('?')[0];
    if (req.method === 'POST' && url.endsWith('/exchange/listings/confirm')) {
      hubHits.confirm += 1;
      return json(res, 200, { success: true, listed: true });
    }
    if (req.method === 'POST' && url.endsWith('/exchange/sales/seal')) {
      hubHits.seal += 1;
      return json(res, 200, { success: true, sealId: 'HUB-SEAL-E2E', monitoring: 'stub' });
    }
    if (req.method === 'POST' && url.endsWith('/exchange/delivery/prepare')) {
      hubHits.delivery += 1;
      return json(res, 200, {
        success: true,
        downloadUrl: `http://127.0.0.1:${HUB_PORT}/api/v1/exchange/delivery/e2e-token`,
        downloadToken: 'e2e-token',
      });
    }
    if (req.method === 'POST' && url.endsWith('/exchange/protect-upload')) {
      hubHits.protect += 1;
      return json(res, 200, {
        success: true,
        asset: { assetId: 'vault-e2e-protected', vaultId: 'vault-e2e-protected', dnaRecordId: 'dna-e2e' },
      });
    }
    if (req.method === 'GET' && url.includes('/exchange/listable-assets-bridge')) {
      return json(res, 200, { assets: [] });
    }
    json(res, 404, { error: `stub hub has no ${req.method} ${url}` });
  });
  return new Promise((resolve) => hubServer.listen(HUB_PORT, '127.0.0.1', resolve));
}

function startExchange() {
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  return new Promise((resolve, reject) => {
    exchangeProc = spawn(process.execPath, ['server/server.js'], {
      cwd: exchangeRoot,
      env: {
        ...process.env,
        EXCHANGE_ISOLATED_TEST: '1',
        PORT: String(EXCHANGE_PORT),
        NODE_ENV: 'development',
        EXCHANGE_FORCE_SQLITE: '1',
        EXCHANGE_DB_PATH: testDb,
        EXCHANGE_DATABASE_URL: '',
        PAYMENT_MOCK: '1',
        PAYMENT_DEMO_MODE: '1',
        RAZORPAY_KEY_ID: '',
        RAZORPAY_KEY_SECRET: '',
        EXCHANGE_BRIDGE_SECRET: BRIDGE_SECRET,
        HUB_API_URL: `http://127.0.0.1:${HUB_PORT}/api/v1`,
        EXCHANGE_PUBLIC_URL: `http://127.0.0.1:${EXCHANGE_PORT}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('[exchange] ready')) {
        exchangeProc.stdout.off('data', onData);
        resolve();
      }
    };
    exchangeProc.stdout.on('data', onData);
    exchangeProc.stderr.on('data', (c) => {
      buf += c.toString();
    });
    exchangeProc.on('error', reject);
    exchangeProc.on('exit', (code) => {
      if (code && code !== 0) reject(new Error(`Exchange exited ${code}: ${buf.slice(-800)}`));
    });
    setTimeout(() => reject(new Error(`Exchange did not become ready:\n${buf.slice(-800)}`)), 25000);
  });
}

function ssoToken(pinitId, extra = {}) {
  return jwt.sign(
    { purpose: 'exchange_sso', pinitId, name: extra.name, email: extra.email, intent: extra.intent },
    BRIDGE_SECRET,
    { expiresIn: '1h' },
  );
}

async function api(pathname, { method = 'GET', token, body, intent } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${EXCHANGE_PORT}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(intent ? { ...body, intent } : body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  await startHubStub();
  await startExchange();
});

after(() => {
  try { exchangeProc?.kill(); } catch { /* ignore */ }
  try { hubServer?.close(); } catch { /* ignore */ }
  try { if (fs.existsSync(testDb)) fs.unlinkSync(testDb); } catch { /* ignore */ }
});

test('seller → listing → buyer cart → payment → licence → Hub bridge', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.payments?.mock, true);
  assert.equal(health.data.hub_link_status, 'bridge_configured');

  const sellerSso = await api('/api/auth/hub-sso', {
    method: 'POST',
    body: { token: ssoToken('PINIT-USER-E2ESLR1', { name: 'E2E Seller', email: 'seller-e2e@test.local' }), intent: 'creator' },
  });
  assert.equal(sellerSso.status, 200, JSON.stringify(sellerSso.data));
  const sellerToken = sellerSso.data.session_token;
  const sellerId = sellerSso.data.user.pinit_id;
  assert.ok(sellerToken, 'SSO must mint a session token');
  assert.equal(sellerSso.data.user.role, 'creator');
  assert.equal(sellerSso.data.user.can_list, false, 'subscription unpaid — listing is gated');

  const blocked = await api('/api/listings', {
    method: 'POST',
    token: sellerToken,
    body: { asset_id: 'vault-e2e-1', title: 'Should fail', price_commercial: 149 },
  });
  assert.equal(blocked.status, 403, 'new creators must pay the seller subscription before listing');
  assert.equal(blocked.data.error, 'PAYMENT_VERIFICATION_REQUIRED');

  const payInit = await api('/api/seller/onboarding/payment-method', { method: 'POST', token: sellerToken, body: {} });
  assert.equal(payInit.status, 200, JSON.stringify(payInit.data));
  assert.equal(payInit.data.mock, true);

  const payOk = await api('/api/seller/onboarding/payment-method/verify', {
    method: 'POST',
    token: sellerToken,
    body: {
      razorpay_order_id: payInit.data.orderId,
      razorpay_payment_id: `pay_mock_${Date.now()}`,
      razorpay_signature: 'mock',
    },
  });
  assert.equal(payOk.status, 200, JSON.stringify(payOk.data));
  assert.equal(payOk.data.seller_onboarding_complete, true);
  assert.equal(payOk.data.user?.can_list, true);

  const listed = await api('/api/listings', {
    method: 'POST',
    token: sellerToken,
    body: {
      asset_id: 'vault-e2e-1',
      title: 'E2E Protected Still',
      description: 'Isolated E2E listing',
      vertical: 'images',
      price_personal: 49,
      price_commercial: 149,
      price_exclusive: 0,
      price_enterprise: 0,
      ai_training_opt_out: true,
      human_percent: 92,
      ai_percent: 8,
    },
  });
  assert.equal(listed.status, 201, JSON.stringify(listed.data));
  const listingId = listed.data.listing.listing_id;
  assert.ok(listingId);
  assert.equal(hubHits.confirm, 1, 'publish must call Hub listings/confirm');

  const market = await api('/api/listings?search=E2E%20Protected');
  assert.equal(market.status, 200);
  const items = market.data.items || market.data;
  const found = (Array.isArray(items) ? items : []).some((l) => l.listing_id === listingId);
  assert.equal(found, true, 'published listing must appear on the marketplace');

  const buyerSso = await api('/api/auth/hub-sso', {
    method: 'POST',
    body: { token: ssoToken('PINIT-USER-E2EBUY1', { name: 'E2E Buyer', email: 'buyer-e2e@test.local' }), intent: 'buyer' },
  });
  assert.equal(buyerSso.status, 200, JSON.stringify(buyerSso.data));
  const buyerToken = buyerSso.data.session_token;
  const buyerId = buyerSso.data.user.pinit_id;
  assert.equal(buyerSso.data.user.can_purchase, true);

  const cartAdd = await api('/api/commerce/cart', {
    method: 'POST',
    token: buyerToken,
    body: { buyer_key: buyerId, listing_id: listingId, license_tier: 'commercial' },
  });
  assert.equal(cartAdd.status, 201, JSON.stringify(cartAdd.data));

  const created = await api('/api/commerce/cart/create-payment', {
    method: 'POST',
    token: buyerToken,
    body: {
      buyer_key: buyerId,
      buyer_name: 'E2E Buyer',
      buyer_email: 'buyer-e2e@test.local',
      buyer_pinit_id: buyerId,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.mock, true);

  const verified = await api('/api/orders/verify-payment', {
    method: 'POST',
    token: buyerToken,
    body: {
      payment_intent_id: created.data.payment_intent_id,
      razorpay_order_id: created.data.orderId,
      razorpay_payment_id: `pay_mock_${Date.now()}`,
      razorpay_signature: 'mock',
    },
  });
  assert.equal(verified.status, 201, JSON.stringify(verified.data));
  assert.equal(verified.data.sealed, 1, JSON.stringify(verified.data));
  assert.ok(verified.data.order?.seal_id);
  assert.equal(hubHits.seal, 1, 'seal must call Hub /exchange/sales/seal');
  assert.equal(hubHits.delivery, 1, 'seal must call Hub /exchange/delivery/prepare');
  assert.ok(verified.data.order?.download_url || verified.data.order?.delivery_url, 'licence must receive Hub delivery URL');

  const licenses = await api('/api/orders/my-licenses', { token: buyerToken });
  assert.equal(licenses.status, 200, JSON.stringify(licenses.data));
  assert.equal(licenses.data.licenses?.length, 1);
  assert.equal(licenses.data.licenses[0].seal_id, verified.data.order.seal_id);

  const stolen = await api('/api/orders/my-licenses', { token: sellerToken });
  assert.equal(stolen.status, 200);
  assert.equal(stolen.data.licenses?.length || 0, 0, 'seller session must not read buyer licences');
});
