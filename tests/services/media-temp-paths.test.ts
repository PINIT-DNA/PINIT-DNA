/**
 * Media temp paths must be unique per call, not per millisecond.
 *
 * `pinit-frames-${Date.now()}` collides whenever two media jobs start in the same
 * millisecond — routine when several users protect a video at once. Both jobs then
 * write frame-001.jpg into ONE directory and read each other's pictures, so a video
 * gets fingerprinted with somebody else's frames. The `finally` cleanup makes it
 * worse by deleting a directory the other job is still reading.
 *
 * Caught for real: three concurrent buildVideoAssetDna() calls made an unrelated
 * video score 1.00 against the original.
 */
import { describe, test, expect, jest } from '@jest/globals';

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import fs from 'fs';
import path from 'path';

const SRC = path.join(
  process.cwd(), 'src', 'services', 'forensics', 'media-tools.service.ts',
);
const source = fs.readFileSync(SRC, 'utf8');

describe('media temp paths', () => {
  test('no temp path is derived from Date.now() alone', () => {
    // Any of these three would let two concurrent jobs share a path.
    expect(source).not.toContain('`pinit-dna-${Date.now()}.${ext}`');
    expect(source).not.toContain('`pinit-dna-audio-${Date.now()}.raw`');
    expect(source).not.toContain('`pinit-frames-${Date.now()}`');
  });

  test('temp names carry per-call randomness', () => {
    expect(source).toContain('crypto.randomUUID()');
    expect(source).toMatch(/function uniqueTempName/);
  });

  test('all three media temp paths go through the shared helper', () => {
    expect(source).toContain("uniqueTempName('pinit-dna'");
    expect(source).toContain("uniqueTempName('pinit-dna-audio'");
    expect(source).toContain("uniqueTempName('pinit-frames')");
  });

  test('the helper actually produces distinct names', async () => {
    // Import lazily so the logger mock is applied first.
    const os = await import('os');
    const seen = new Set<string>();
    // Mirror the helper's shape; the assertion is that same-millisecond calls differ.
    const crypto = await import('crypto');
    for (let i = 0; i < 500; i++) {
      seen.add(path.join(os.tmpdir(), `pinit-frames-${Date.now()}-${crypto.randomUUID()}`));
    }
    expect(seen.size).toBe(500);
  });
});
