/**
 * Layer 11 used to be a hand-tuned pixel-statistics heuristic (EXIF markers,
 * blur variance, resolution matching) despite being called "AI Deepfake
 * Detection." It now calls the real multi-engine authenticity ensemble
 * (CLIP zero-shot + EfficientNet AI classifier, ELA, FFT, PRNU, metadata)
 * already built in the Python service — the old heuristic survives only as
 * a fallback for when that service is unavailable.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { deepfakeLayer: { create: jest.fn(async () => ({})) } },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/ai/ai-embeddings.service', () => ({
  aiService: { analyzeAuthenticity: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { processLayer11 } from '../../src/services/layers/layers-11-15.service';
import { aiService } from '../../src/services/ai/ai-embeddings.service';

const deepfakeCreate = prisma.deepfakeLayer.create as unknown as jest.Mock<AnyAsync>;
const analyzeAuthenticity = aiService.analyzeAuthenticity as unknown as jest.Mock<AnyAsync>;

beforeEach(() => {
  deepfakeCreate.mockReset();
  analyzeAuthenticity.mockReset();
  deepfakeCreate.mockResolvedValue({});
});

function dataOf(call: unknown) {
  return (call as { data: Record<string, unknown> }).data;
}

describe('Layer 11 — real ensemble wiring', () => {
  test('uses the real ensemble result for images when the Python service is up', async () => {
    analyzeAuthenticity.mockResolvedValue({
      verdict: 'LIKELY_AI',
      aiProbability: 78.4,
      tamperScore: 12,
      authenticityScore: 20,
      confidence: 0.71,
      aiGenerated: true,
      reasons: ['CLIP zero-shot flagged synthetic texture'],
      engines: [],
      signals: {},
    });

    await processLayer11('dna-1', Buffer.from('fake jpeg bytes'), 'image/jpeg');

    const data = dataOf(deepfakeCreate.mock.calls[0]![0]);
    expect(data['deepfakeScore']).toBe(78.4);
    expect(data['isDeepfake']).toBe(true);
    expect(data['flagged']).toBe(true);
    expect(data['confidence']).toBe(71);
    expect(data['analysisMethod']).toBe('authenticity-ensemble-v1');
    expect((data['metadata'] as Record<string, unknown>)['verdict']).toBe('LIKELY_AI');
  });

  test('falls back to the old heuristic (never blocks) when the ensemble is unavailable', async () => {
    analyzeAuthenticity.mockResolvedValue(null);

    const result = await processLayer11('dna-2', Buffer.from('fake jpeg bytes'), 'image/jpeg');

    expect(result).toBe(true);
    const data = dataOf(deepfakeCreate.mock.calls[0]![0]);
    expect(data['analysisMethod']).toBe('decoded-pixel-multi-factor-fallback');
    expect(typeof data['deepfakeScore']).toBe('number');
  });

  test('a genuinely original photo scores low and is not flagged', async () => {
    analyzeAuthenticity.mockResolvedValue({
      verdict: 'ORIGINAL',
      aiProbability: 8.2,
      tamperScore: 3,
      authenticityScore: 91,
      confidence: 0.83,
      aiGenerated: false,
      reasons: [],
      engines: [],
      signals: {},
    });

    await processLayer11('dna-3', Buffer.from('real photo bytes'), 'image/jpeg');

    const data = dataOf(deepfakeCreate.mock.calls[0]![0]);
    expect(data['deepfakeScore']).toBe(8.2);
    expect(data['isDeepfake']).toBe(false);
    expect(data['flagged']).toBe(false);
  });

  test('video (non-image media) never calls the image-only ensemble', async () => {
    await processLayer11('dna-4', Buffer.from('mp4 bytes'), 'video/mp4');

    expect(analyzeAuthenticity).not.toHaveBeenCalled();
    const data = dataOf(deepfakeCreate.mock.calls[0]![0]);
    expect(data['analysisMethod']).toBe('byte-heuristic-fallback');
  });

  test('a non-media file (e.g. a document) is not analyzed at all', async () => {
    await processLayer11('dna-5', Buffer.from('pdf bytes'), 'application/pdf');

    expect(analyzeAuthenticity).not.toHaveBeenCalled();
    const data = dataOf(deepfakeCreate.mock.calls[0]![0]);
    expect(data['deepfakeScore']).toBe(0);
    expect(data['confidence']).toBe(0);
  });

  test('processLayer11 never throws even if analyzeAuthenticity rejects', async () => {
    analyzeAuthenticity.mockRejectedValue(new Error('network error'));

    const result = await processLayer11('dna-6', Buffer.from('jpeg bytes'), 'image/jpeg');

    // The whole layer function has its own try/catch — a hard failure here
    // returns false (layer failed) rather than throwing into the caller.
    expect(result).toBe(false);
  });
});
