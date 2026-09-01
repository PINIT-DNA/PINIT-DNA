import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sellerSubscriptionPaymentAcceptable,
  SELLER_SUBSCRIPTION_AMOUNT_PAISE,
  SELLER_SUBSCRIPTION_CURRENCY,
} from '../razorpay.js';

test('mock payments are acceptable for local demo', () => {
  assert.equal(sellerSubscriptionPaymentAcceptable({ mock: true, id: 'pay_mock_1' }, 'order_mock_1').ok, true);
});

test('captured ₹2,500 INR on the matching order is accepted', () => {
  const r = sellerSubscriptionPaymentAcceptable({
    id: 'pay_real',
    order_id: 'order_abc',
    status: 'captured',
    amount: SELLER_SUBSCRIPTION_AMOUNT_PAISE,
    currency: SELLER_SUBSCRIPTION_CURRENCY,
  }, 'order_abc');
  assert.equal(r.ok, true);
});

test('wrong amount is rejected', () => {
  const r = sellerSubscriptionPaymentAcceptable({
    id: 'pay_real',
    order_id: 'order_abc',
    status: 'captured',
    amount: 100,
    currency: 'INR',
  }, 'order_abc');
  assert.equal(r.ok, false);
});

test('failed status is rejected', () => {
  const r = sellerSubscriptionPaymentAcceptable({
    id: 'pay_real',
    order_id: 'order_abc',
    status: 'failed',
    amount: SELLER_SUBSCRIPTION_AMOUNT_PAISE,
    currency: 'INR',
  }, 'order_abc');
  assert.equal(r.ok, false);
});

test('order id mismatch is rejected', () => {
  const r = sellerSubscriptionPaymentAcceptable({
    id: 'pay_real',
    order_id: 'order_other',
    status: 'captured',
    amount: SELLER_SUBSCRIPTION_AMOUNT_PAISE,
    currency: 'INR',
  }, 'order_abc');
  assert.equal(r.ok, false);
});
