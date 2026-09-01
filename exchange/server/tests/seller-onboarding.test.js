import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING,
  isSellerOnboardingComplete,
  sellerOnboardingBlocked,
  normalizeOnboardingStatus,
  initialCreatorOnboardingStatus,
} from '../lib/seller-onboarding.js';
import { enrichPublicUser } from '../lib/roles.js';

test('normalizeOnboardingStatus defaults empty to SELLER_ACTIVE (grandfather)', () => {
  assert.equal(normalizeOnboardingStatus(''), ONBOARDING.SELLER_ACTIVE);
  assert.equal(normalizeOnboardingStatus(null), ONBOARDING.SELLER_ACTIVE);
});

test('isSellerOnboardingComplete accepts active and verified states', () => {
  assert.equal(isSellerOnboardingComplete({ seller_onboarding_status: 'SELLER_ACTIVE' }), true);
  assert.equal(isSellerOnboardingComplete({ seller_onboarding_status: 'PAYMENT_METHOD_VERIFIED' }), true);
  assert.equal(isSellerOnboardingComplete({ seller_onboarding_status: 'PAYMENT_METHOD_REQUIRED' }), false);
});

test('sellerOnboardingBlocked returns payment gate for new sellers only', () => {
  assert.equal(sellerOnboardingBlocked({ seller_onboarding_status: 'SELLER_ACTIVE' }), null);
  const blocked = sellerOnboardingBlocked({ seller_onboarding_status: 'PAYMENT_METHOD_REQUIRED' });
  assert.equal(blocked?.error, 'PAYMENT_VERIFICATION_REQUIRED');
});

test('initialCreatorOnboardingStatus keeps active sellers active', () => {
  assert.equal(
    initialCreatorOnboardingStatus({ seller_onboarding_status: 'SELLER_ACTIVE' }),
    ONBOARDING.SELLER_ACTIVE,
  );
  assert.equal(initialCreatorOnboardingStatus(null), ONBOARDING.PAYMENT_METHOD_REQUIRED);
});

test('enrichPublicUser gates can_list until onboarding complete', () => {
  const pending = enrichPublicUser({
    pinit_id: 'PINIT-EX-TEST',
    role: 'creator',
    name: 'Creator',
    seller_onboarding_status: 'PAYMENT_METHOD_REQUIRED',
  });
  assert.equal(pending.can_list, false);
  assert.equal(pending.can_purchase, true);
  assert.equal(pending.seller_onboarding_complete, false);

  const active = enrichPublicUser({
    pinit_id: 'PINIT-EX-TEST2',
    role: 'creator',
    name: 'Creator',
    seller_onboarding_status: 'SELLER_ACTIVE',
  });
  assert.equal(active.can_list, true);
  assert.equal(active.can_purchase, true);
  assert.equal(active.capabilities.buy, true);
  assert.equal(active.capabilities.sell, true);
});
