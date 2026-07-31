/**
 * Phase 2 forensic DNA unit tests
 */
import { verifyOcrDna } from '../../src/services/forensics/ocr-dna.service';
import { verifyScreenshotDna } from '../../src/services/forensics/screenshot-dna.service';
import { verifyVideoDna } from '../../src/services/forensics/video-dna-enhancements.service';
import { verifyAudioDna } from '../../src/services/forensics/audio-dna-enhancements.service';
import { compareLightweightDna } from '../../src/services/forensics/lightweight-dna.service';
import { detectMediaProfile } from '../../src/services/forensics/adaptive-scoring.service';
import { dnaExplanationService } from '../../src/services/forensics/dna-explanation.service';
import { evidenceConfidenceService } from '../../src/services/forensics/evidence-confidence.service';
import type { LayerScoreInput, LightweightDnaFingerprint } from '../../src/types/dna-enhancements.types';

describe('Phase 2 OCR DNA', () => {
  it('verifyOcrDna returns 1 for identical data', () => {
    const ocr = {
      ocrSha256: 'abc',
      ocrSimHash: 'ff00',
      semanticFingerprint: 'sem1',
      layoutFingerprint: 'lay1',
    };
    expect(verifyOcrDna(ocr, ocr)).toBe(1);
  });
});

describe('Phase 2 Screenshot DNA', () => {
  it('verifyScreenshotDna scores aspect ratio match', () => {
    const a = { aspectRatioProfile: '16:9', uiLayoutFingerprint: 'abc' };
    const b = { aspectRatioProfile: '16:9', uiLayoutFingerprint: 'xyz' };
    expect(verifyScreenshotDna(a, b)).toBeGreaterThan(0.3);
  });
});

describe('Phase 2 Video DNA', () => {
  it('verifyVideoDna compares keyframe overlap', () => {
    const a = { keyframeHashes: ['a', 'b', 'c'], motionFingerprint: 'm1' };
    const b = { keyframeHashes: ['a', 'b', 'd'], motionFingerprint: 'm1' };
    expect(verifyVideoDna(a, b)).toBeGreaterThan(0.4);
  });
});

describe('Phase 2 Audio DNA', () => {
  it('verifyAudioDna compares chromaprint', () => {
    const a = { chromaprint: 'abc123' };
    const b = { chromaprint: 'abc123' };
    expect(verifyAudioDna(a, b)).toBe(1);
  });
});

describe('Phase 2 Lightweight DNA', () => {
  it('compareLightweightDna detects exact sha256 match', () => {
    const fp: LightweightDnaFingerprint = {
      version: '2.2-lite',
      mediaProfile: 'image',
      sha256: 'same',
      generatedAt: new Date().toISOString(),
    };
    const result = compareLightweightDna(fp, fp);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.matchedFields).toContain('sha256');
  });
});

describe('Phase 2 Adaptive scoring', () => {
  it('detectMediaProfile identifies video', () => {
    expect(detectMediaProfile('video/mp4', 'VIDEO')).toBe('video');
    expect(detectMediaProfile('image/jpeg', 'IMAGE')).toBe('image');
  });
});

describe('Phase 2 Explanation engine', () => {
  it('returns undefined when phase2 disabled', () => {
    const layers: LayerScoreInput[] = [
      { layer: 'cryptographic', score: 1, weight: 0.3, passed: true },
    ];
    expect(dnaExplanationService.explain(0.95, layers)).toBeUndefined();
  });
});

describe('Phase 2 Evidence confidence', () => {
  it('returns undefined when phase2 disabled', () => {
    const layers: LayerScoreInput[] = [
      { layer: 'perceptual', score: 0.9, weight: 0.2, passed: true },
    ];
    expect(evidenceConfidenceService.compute(0.9, layers)).toBeUndefined();
  });
});
