/**
 * Unit tests — DNA enhancement v2.1 forensic modules
 */
import { computeChunkHashes, chunkHashSimilarity } from '../../src/services/forensics/chunk-hash.service';
import { tamperClassifierService } from '../../src/services/forensics/tamper-classifier.service';
import { weightedDnaScoringService } from '../../src/services/forensics/weighted-dna-scoring.service';
import type { LayerScoreInput } from '../../src/types/dna-enhancements.types';

describe('Crypto enhancements', () => {
  it('chunk hash similarity detects partial overlap', () => {
    const a = computeChunkHashes(Buffer.from('abc'), 1);
    const b = computeChunkHashes(Buffer.from('abd'), 1);
    expect(chunkHashSimilarity(a, b)).toBeCloseTo(2 / 3, 1);
  });
});

describe('Weighted DNA scoring', () => {
  it('returns scores in valid range', () => {
    const layers: LayerScoreInput[] = [
      { layer: 'cryptographic', score: 0, weight: 0.22, passed: false },
      { layer: 'perceptual', score: 0.9, weight: 0.22, passed: true },
      { layer: 'steganography', score: 1, weight: 0.1, passed: true },
    ];
    const result = weightedDnaScoringService.compute(layers);
    expect(result.overallMatchScore).toBeGreaterThan(0);
    expect(result.overallMatchScore).toBeLessThanOrEqual(1);
    expect(result.ownershipConfidence).toBeLessThanOrEqual(100);
  });
});

describe('Tamper classifier', () => {
  it('classifies exact copy', () => {
    const layers: LayerScoreInput[] = [
      { layer: 'cryptographic', score: 1, weight: 0.22, passed: true },
      { layer: 'perceptual', score: 0.98, weight: 0.22, passed: true },
    ];
    const t = tamperClassifierService.classify(layers);
    expect(t.primaryVector).toBe('EXACT_COPY');
  });

  it('classifies compression pattern', () => {
    const layers: LayerScoreInput[] = [
      { layer: 'cryptographic', score: 0.2, weight: 0.22, passed: false },
      { layer: 'perceptual', score: 0.88, weight: 0.22, passed: true },
      { layer: 'steganography', score: 0.6, weight: 0.1, passed: false },
    ];
    const t = tamperClassifierService.classify(layers);
    expect(['COMPRESSION', 'REENCODE', 'SCREENSHOT', 'UNKNOWN_TAMPER']).toContain(t.primaryVector);
  });

  it('classifies metadata removal', () => {
    const layers: LayerScoreInput[] = [
      { layer: 'cryptographic', score: 1, weight: 0.22, passed: true },
      { layer: 'perceptual', score: 0.7, weight: 0.22, passed: false },
    ];
    const t = tamperClassifierService.classify(layers);
    expect(t.primaryVector).toBe('METADATA_REMOVAL');
  });
});

describe('Metadata enhancements', () => {
  it('verify returns 1 for identical fingerprints', async () => {
    const { verifyMetadataEnhancements } = await import(
      '../../src/services/forensics/metadata-enhancements'
    );
    const meta = {
      cameraModel: 'TestCam',
      lensModel: '50mm',
      exifFingerprint: 'abc123',
    };
    expect(verifyMetadataEnhancements(meta, meta)).toBe(1);
    expect(verifyMetadataEnhancements(meta, { ...meta, exifFingerprint: 'different' })).toBe(0);
  });
});
