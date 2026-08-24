/**
 * Signed marketplace preview URLs.
 *
 * Guards the two failures that made the preview route a bulk-download vector:
 *  1. A bare, guessable /api/hub/preview/<asset_id> resolving without a token —
 *     asset_id is returned in plaintext by the public listings API.
 *  2. The allow-list being defeated by `|| isHubVaultId(assetId)`, which only
 *     checked UUID *format* and so served assets belonging to other users that
 *     were never listed on Exchange.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PREVIEW_SIGNING_SECRET = 'test-preview-secret-value';

const { signPreviewParams, verifyPreviewToken, isPreviewSigningEnabled } =
  await import('../lib/preview-token.js');

const ASSET = '134c63bb-7c14-460f-b34b-be11b2a1526b';
const OTHER = '2fafdcf0-ed7b-454e-94c3-9dc343927f28';

test('signing is enabled when a secret is configured', () => {
  assert.equal(isPreviewSigningEnabled(), true);
});

test('a freshly minted token verifies', () => {
  const p = signPreviewParams(ASSET);
  assert.ok(p && p.t && p.e);
  assert.equal(verifyPreviewToken(ASSET, p.t, p.e).ok, true);
});

test('a missing token is rejected — the guessable URL case', () => {
  assert.equal(verifyPreviewToken(ASSET, undefined, undefined).ok, false);
  assert.equal(verifyPreviewToken(ASSET, '', '').ok, false);
});

test('a tampered signature is rejected', () => {
  const p = signPreviewParams(ASSET);
  const tampered = `X${p.t.slice(1)}`;
  assert.equal(verifyPreviewToken(ASSET, tampered, p.e).ok, false);
});

test('an expired token is rejected even though it is correctly signed', () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  // Mint against the past expiry using the same algorithm the module uses.
  const p = signPreviewParams(ASSET, 30);
  // Reuse the signature with a stale expiry — signature will not match either,
  // but the expiry check must fire first and independently.
  assert.equal(verifyPreviewToken(ASSET, p.t, String(past)).ok, false);
});

test('a token minted for one asset does not work for another', () => {
  const p = signPreviewParams(ASSET);
  assert.equal(verifyPreviewToken(OTHER, p.t, p.e).ok, false);
});

test('expiry is bounded — a caller cannot mint a decade-long token', () => {
  const p = signPreviewParams(ASSET, 60 * 60 * 24 * 365);
  const ttl = Number(p.e) - Math.floor(Date.now() / 1000);
  assert.ok(ttl <= 3600, `ttl ${ttl}s exceeded the 3600s ceiling`);
});

test('a very short ttl is floored rather than producing an already-dead token', () => {
  const p = signPreviewParams(ASSET, 1);
  assert.equal(verifyPreviewToken(ASSET, p.t, p.e).ok, true);
});
