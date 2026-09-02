import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicLicensedShareUrl, isShareApiHost } from '../lib/share-viewer-url.js';

test('licensed share URL never uses Hub API host', () => {
  assert.equal(isShareApiHost('https://pinit-dna-uf5y.onrender.com/share/x'), true);
  const url = publicLicensedShareUrl('Tok_en-1', 'https://pinit-dna-uf5y.onrender.com', {
    NODE_ENV: 'production',
    PUBLIC_APP_URL: 'https://pinit-dna-uf5y.onrender.com',
  });
  assert.equal(url, 'https://www.pinithub.com/s/Tok_en-1');
});

test('local licensed share URL uses Hub UI', () => {
  const url = publicLicensedShareUrl('abc', '', {
    NODE_ENV: 'development',
    HUB_APP_URL: 'http://localhost:3002',
  });
  assert.equal(url, 'http://localhost:3002/s/abc');
});
