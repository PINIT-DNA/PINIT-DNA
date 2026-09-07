import {
  isCompletedAnalysisPayload,
  resolveImageAnalysisStatus,
  STALE_ANALYZING_MS,
} from '../src/services/vault/image-analysis-lifecycle';

describe('image analysis lifecycle', () => {
  test('completed payload is recognized from stored vault JSON', () => {
    expect(isCompletedAnalysisPayload({
      verdict: 'ORIGINAL',
      scores: { authenticityScore: 90, tamperScore: 2, aiProbability: 5, confidence: 80 },
    })).toBe(true);
    expect(isCompletedAnalysisPayload({ status: 'ANALYZING' })).toBe(false);
    expect(isCompletedAnalysisPayload(null)).toBe(false);
  });

  test('non-images are not sent through the image pipeline', () => {
    expect(resolveImageAnalysisStatus({
      mimeType: 'application/pdf',
      filename: 'brief.pdf',
      contentAnalysis: null,
    })).toBe('NOT_APPLICABLE');
  });

  test('stored scores mean COMPLETED even if status column is stale', () => {
    expect(resolveImageAnalysisStatus({
      mimeType: 'image/jpeg',
      filename: 'photo.jpg',
      storedStatus: 'NOT_ANALYZED',
      contentAnalysis: {
        verdict: 'ORIGINAL',
        scores: { authenticityScore: 88, tamperScore: 4, aiProbability: 6, confidence: 70 },
      },
    })).toBe('COMPLETED');
  });

  test('opening later does not treat a finished job as missing', () => {
    expect(resolveImageAnalysisStatus({
      mimeType: 'image/png',
      filename: 'art.png',
      storedStatus: 'COMPLETED',
      contentAnalysis: {
        label: 'ORIGINAL',
        scores: { authenticityScore: 80, tamperScore: 1, aiProbability: 3, confidence: 60 },
      },
    })).toBe('COMPLETED');
  });

  test('stale ANALYZING becomes FAILED so the UI can retry', () => {
    expect(resolveImageAnalysisStatus({
      mimeType: 'image/jpeg',
      filename: 'x.jpg',
      storedStatus: 'ANALYZING',
      analyzingStartedAt: new Date(Date.now() - STALE_ANALYZING_MS - 1000),
    })).toBe('FAILED');
  });

  test('FAILED does not auto-promote to a new run', () => {
    expect(resolveImageAnalysisStatus({
      mimeType: 'image/jpeg',
      filename: 'x.jpg',
      storedStatus: 'FAILED',
      contentAnalysis: null,
    })).toBe('FAILED');
  });
});
