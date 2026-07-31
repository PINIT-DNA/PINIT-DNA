/**
 * Unit tests — Universal Asset lifecycle + DNA helpers + discovery model.
 */

import { canTransitionAsset, inferAssetType, ASSET_STATUS } from '../src/services/assets/lifecycle';
import { compareVideoAssetDna } from '../src/services/assets/video-asset-dna.service';
import { buildDocumentAssetDna, compareDocumentAssetDna } from '../src/services/assets/document-asset-dna.service';

describe('Asset lifecycle', () => {
  test('allows DRAFT → PROTECTED', () => {
    expect(canTransitionAsset(ASSET_STATUS.DRAFT, ASSET_STATUS.PROTECTED)).toBe(true);
  });

  test('blocks ARCHIVED → MONITORING', () => {
    expect(canTransitionAsset(ASSET_STATUS.ARCHIVED, ASSET_STATUS.MONITORING)).toBe(false);
  });

  test('infers asset types from mime', () => {
    expect(inferAssetType('image/png', 'a.png')).toBe('IMAGE');
    expect(inferAssetType('video/mp4', 'a.mp4')).toBe('VIDEO');
    expect(inferAssetType('application/pdf', 'a.pdf')).toBe('DOCUMENT');
    expect(inferAssetType('audio/mpeg', 'a.mp3')).toBe('AUDIO');
  });
});

describe('Video asset DNA compare', () => {
  test('scores overlapping keyframes', () => {
    const r = compareVideoAssetDna(
      { keyframeHashes: ['a', 'b', 'c'], framePHashes: ['p1'], audioFingerprint: 'aud' },
      { keyframeHashes: ['b', 'c', 'd'], framePHashes: ['p1'], audioFingerprint: 'aud' },
    );
    expect(r.similarity).toBeGreaterThan(0.3);
    expect(r.audioMatch).toBe(true);
  });
});

describe('Document asset DNA', () => {
  test('builds content + structure hashes', async () => {
    const buf = Buffer.from('hello pinIT document');
    const dna = await buildDocumentAssetDna({
      buffer: buf,
      mimeType: 'text/plain',
      originalFilename: 'note.txt',
    });
    expect(dna.contentHash).toHaveLength(64);
    expect(dna.structureHash).toHaveLength(64);
  });

  test('exact content match is high similarity', async () => {
    const buf = Buffer.from('same-bytes');
    const a = await buildDocumentAssetDna({ buffer: buf, mimeType: 'text/plain', originalFilename: 'a.txt' });
    const b = await buildDocumentAssetDna({ buffer: buf, mimeType: 'text/plain', originalFilename: 'b.txt' });
    const cmp = compareDocumentAssetDna(a, b);
    expect(cmp.similarity).toBeGreaterThanOrEqual(0.7);
  });
});
