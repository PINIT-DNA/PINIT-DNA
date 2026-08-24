import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRole,
  canList,
  canPurchase,
  enrichPublicUser,
} from '../lib/roles.js';

test('normalizeRole maps creator/seller to seller', () => {
  assert.equal(normalizeRole('creator'), 'seller');
  assert.equal(normalizeRole('seller'), 'seller');
  assert.equal(normalizeRole('buyer'), 'buyer');
  assert.equal(normalizeRole('admin'), 'admin');
});

test('buyers cannot list; sellers cannot purchase', () => {
  assert.equal(canList('buyer'), false);
  assert.equal(canPurchase('buyer'), true);
  assert.equal(canList('creator'), true);
  assert.equal(canPurchase('creator'), false);
  assert.equal(canList('admin'), true);
  assert.equal(canPurchase('admin'), true);
});

test('enrichPublicUser strips password and adds flags', () => {
  const pub = enrichPublicUser({
    pinit_id: 'PINIT-EX-TEST',
    role: 'buyer',
    password_hash: 'secret',
    name: 'Buyer',
  });
  assert.equal(pub.password_hash, undefined);
  assert.equal(pub.exchange_role, 'buyer');
  assert.equal(pub.can_list, false);
  assert.equal(pub.can_purchase, true);
  assert.equal(pub.seller_onboarding_complete, true);
});
