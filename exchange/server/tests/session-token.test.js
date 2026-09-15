import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SIGNING_SECRET = 'test-session-secret-value';

const {
  mintSessionToken,
  verifySessionToken,
  verifiedPinitIdFromReq,
  isSessionSigningEnabled,
} = await import('../lib/session-token.js');

test('signing is enabled when a secret is configured', () => {
  assert.equal(isSessionSigningEnabled(), true);
});

test('a minted token verifies back to the same Pinit ID', () => {
  const token = mintSessionToken('PINIT-EX-N29WYF9D');
  const result = verifySessionToken(token);
  assert.equal(result.ok, true);
  assert.equal(result.pinitId, 'PINIT-EX-N29WYF9D');
});

test('a tampered signature is rejected', () => {
  const token = mintSessionToken('PINIT-EX-N29WYF9D');
  const [id, exp, sig] = token.split('.');
  const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  const result = verifySessionToken(`${id}.${exp}.${flipped}`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad signature');
});

test('swapping in another Pinit ID is rejected — the core impersonation case', () => {
  const token = mintSessionToken('PINIT-EX-VICTIM01');
  const [, exp, sig] = token.split('.');
  const attacker = Buffer.from('PINIT-EX-ATTACKER').toString('base64url');
  const result = verifySessionToken(`${attacker}.${exp}.${sig}`);
  assert.equal(result.ok, false);
});

test('an expired token is rejected', () => {
  const token = mintSessionToken('PINIT-EX-N29WYF9D', 60);
  const [id, , sig] = token.split('.');
  const past = Math.floor(Date.now() / 1000) - 10;
  const result = verifySessionToken(`${id}.${past}.${sig}`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('malformed and empty tokens are rejected', () => {
  for (const bad of ['', 'nonsense', 'a.b', 'a.b.c.d']) {
    assert.equal(verifySessionToken(bad).ok, false);
  }
});

test('verifiedPinitIdFromReq reads Bearer and X-Session-Token, and never a claimed id', () => {
  const token = mintSessionToken('PINIT-EX-N29WYF9D');

  assert.equal(
    verifiedPinitIdFromReq({ headers: { authorization: `Bearer ${token}` } }),
    'PINIT-EX-N29WYF9D',
  );
  assert.equal(
    verifiedPinitIdFromReq({ headers: { 'x-session-token': token } }),
    'PINIT-EX-N29WYF9D',
  );
  // A claimed header alone proves nothing.
  assert.equal(
    verifiedPinitIdFromReq({ headers: { 'x-pinit-id': 'PINIT-EX-ATTACKER' } }),
    '',
  );
});
