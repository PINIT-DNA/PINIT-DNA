/**
 * Uploaded HTML / XHTML / SVG / XML is ACTIVE content. The API serves stored user files inline
 * with their original content type, so an uploaded file's script could run from the API origin
 * (including against share-link recipients, who are strangers to the uploader). Active types now
 * get a `sandbox` CSP; everything else is left alone so PDF / image / media viewers keep working.
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { correctImageMime, isActiveContentType, userContentHeaders } from '../../src/lib/user-content-headers';

describe('isActiveContentType', () => {
  test.each([
    'text/html', 'TEXT/HTML', 'text/html; charset=utf-8', ' text/html ;charset=UTF-8',
    'application/xhtml+xml', 'image/svg+xml', 'image/svg+xml; charset=utf-8',
    'text/xml', 'application/xml', 'application/javascript', 'text/javascript',
    'application/rss+xml', 'application/atom+xml', 'application/vnd.foo+xml', // any application/*+xml
  ])('%s is active content', (mime) => {
    expect(isActiveContentType(mime)).toBe(true);
  });

  test.each([
    'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'audio/mpeg',
    'text/plain', 'text/csv', 'application/json', 'application/octet-stream', 'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])('%s is not active content', (mime) => {
    expect(isActiveContentType(mime)).toBe(false);
  });

  test('missing / empty types are not treated as active', () => {
    expect(isActiveContentType(undefined)).toBe(false);
    expect(isActiveContentType(null)).toBe(false);
    expect(isActiveContentType('')).toBe(false);
  });
});

describe('userContentHeaders', () => {
  test('active content gets a sandbox CSP that forbids script, same-origin access and forms', () => {
    const h = userContentHeaders('text/html');
    const csp = h['Content-Security-Policy']!;
    expect(csp).toMatch(/^sandbox;/);                 // a bare `sandbox` (no allow-* tokens)
    expect(csp).not.toMatch(/allow-/);                // no allow-scripts / allow-same-origin / allow-forms ...
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
  });

  test('SVG (an image type that can carry script) is sandboxed too', () => {
    expect(userContentHeaders('image/svg+xml')['Content-Security-Policy']).toMatch(/^sandbox;/);
  });

  test('PDF, images, media and text/plain are NOT given a CSP (viewers can break under sandbox), only nosniff', () => {
    for (const mime of ['application/pdf', 'image/png', 'video/mp4', 'audio/mpeg', 'text/plain']) {
      const h = userContentHeaders(mime);
      expect(h['Content-Security-Policy']).toBeUndefined();
      expect(h['X-Content-Type-Options']).toBe('nosniff');
    }
  });

  test('null / undefined types still get nosniff and no CSP', () => {
    expect(userContentHeaders(undefined)).toEqual({ 'X-Content-Type-Options': 'nosniff' });
  });
});

describe('correctImageMime — label the bytes that are actually sent', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(32)]);
  const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(32)]);

  test('an SVG upload that identity embedding turned into PNG bytes is served as image/png (was unrenderable)', () => {
    expect(correctImageMime('image/svg+xml', png)).toBe('image/png');
  });

  test('a JPEG / WebP upload re-encoded to PNG is labelled image/png', () => {
    expect(correctImageMime('image/jpeg', png)).toBe('image/png');
    expect(correctImageMime('image/webp', png)).toBe('image/png');
  });

  test('a label that already matches its bytes is returned unchanged, parameters included', () => {
    expect(correctImageMime('image/png', png)).toBe('image/png');
    expect(correctImageMime('image/jpeg', jpeg)).toBe('image/jpeg');
    expect(correctImageMime('image/gif', gif)).toBe('image/gif');
    expect(correctImageMime('image/webp', webp)).toBe('image/webp');
    expect(correctImageMime('image/png; charset=binary', png)).toBe('image/png; charset=binary');
  });

  test('a genuine (text) SVG keeps its label — and therefore its sandbox CSP', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    expect(correctImageMime('image/svg+xml', svg)).toBe('image/svg+xml');
  });

  test('non-image labels are never rewritten, whatever the bytes look like', () => {
    expect(correctImageMime('text/html', png)).toBe('text/html');
    expect(correctImageMime('application/pdf', png)).toBe('application/pdf');
    expect(correctImageMime(null, png)).toBe('application/octet-stream');
  });

  test('tiny or unrecognised bodies keep the stored label', () => {
    expect(correctImageMime('image/jpeg', Buffer.from([1, 2, 3]))).toBe('image/jpeg');
    expect(correctImageMime('image/tiff', Buffer.alloc(64, 7))).toBe('image/tiff');
  });
});

describe('every controller that serves a stored file inline uses the helper', () => {
  // Controllers that only ever serve PDFs the SERVER generated (not user uploads).
  const SERVER_GENERATED_ONLY = new Set(['client-report.controller.ts']);
  const dir = path.resolve(__dirname, '../../src/api/controllers');
  const inlineServing = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !SERVER_GENERATED_ONLY.has(f))
    .filter((f) => /Content-Disposition['"]?\s*:\s*[`'"]?(?:\$\{[^}]*\}|inline)/.test(fs.readFileSync(path.join(dir, f), 'utf8'))
      && /inline/.test(fs.readFileSync(path.join(dir, f), 'utf8')));

  test('the scan finds the known file-serving controllers (guards the guard)', () => {
    expect(inlineServing).toEqual(expect.arrayContaining([
      'vault.controller.ts', 'share-link.controller.ts', 'business.controller.ts', 'exchange-bridge.controller.ts',
    ]));
  });

  test.each(inlineServing)('%s applies userContentHeaders()', (file) => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    expect(src).toMatch(/userContentHeaders\(/);
  });
});
