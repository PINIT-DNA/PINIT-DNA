import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Demo mode decides whether a payment is real. Getting it wrong in the unsafe
 * direction gives away paid accounts and licences, so the guard is tested
 * directly rather than assumed.
 */

const ORIGINAL = { ...process.env };

function reset() {
  delete process.env.PAYMENT_DEMO_MODE;
  delete process.env.PAYMENT_MOCK;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.NODE_ENV;
}

// Imported fresh per assertion set because the module reads env at call time.
const load = async () => import(`../razorpay.js?t=${Date.now()}${Math.random()}`);

test.afterEach(() => {
  reset();
  Object.assign(process.env, ORIGINAL);
});

test('demo mode is off by default', async () => {
  reset();
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  const { isPaymentDemoMode, isPaymentMockMode } = await load();
  assert.equal(isPaymentDemoMode(), false);
  assert.equal(isPaymentMockMode(), false, 'configured test keys must use the real gateway');
});

test('PAYMENT_DEMO_MODE=1 enables demo against a test key', async () => {
  reset();
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  process.env.PAYMENT_DEMO_MODE = '1';
  const { isPaymentDemoMode, isPaymentMockMode } = await load();
  assert.equal(isPaymentDemoMode(), true);
  assert.equal(isPaymentMockMode(), true);
});

test('the older PAYMENT_MOCK spelling still works', async () => {
  reset();
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  process.env.PAYMENT_MOCK = '1';
  const { isPaymentDemoMode } = await load();
  assert.equal(isPaymentDemoMode(), true);
});

test('demo mode is REFUSED against a live key even when explicitly requested', async () => {
  reset();
  process.env.RAZORPAY_KEY_ID = 'rzp_live_real';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  process.env.PAYMENT_DEMO_MODE = '1';
  process.env.PAYMENT_MOCK = '1';
  const { isPaymentDemoMode, isPaymentMockMode } = await load();
  assert.equal(isPaymentDemoMode(), false, 'a live key must win over the demo flag');
  assert.equal(isPaymentMockMode(), false, 'real money must never be simulated');
});

test('missing keys do NOT silently simulate payments in production', async () => {
  reset();
  process.env.NODE_ENV = 'production';
  const { isPaymentMockMode } = await load();
  assert.equal(
    isPaymentMockMode(), false,
    'absent configuration in production must surface as an error, not free payments',
  );
});

test('missing keys still simulate outside production, for local development', async () => {
  reset();
  process.env.NODE_ENV = 'development';
  const { isPaymentMockMode } = await load();
  assert.equal(isPaymentMockMode(), true);
});

test('billing config reports demo and live flags to the client', async () => {
  reset();
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  process.env.PAYMENT_DEMO_MODE = '1';
  const { getBillingPublicConfig } = await load();
  const cfg = getBillingPublicConfig();
  assert.equal(cfg.demo, true, 'the UI needs this to label the payment as a demo');
  assert.equal(cfg.live, false);
  assert.equal(cfg.testMode, true);
});
