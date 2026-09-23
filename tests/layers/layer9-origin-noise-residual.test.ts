/**
 * Layer 9 (Origin) used to derive NO signal from the file's actual pixels in
 * either mode (see layer9.origin.ts's header comment). It now calls a real
 * content-derived noise-residual descriptor for images — this pins the
 * wiring: real descriptor folded into originBundle/bundleHash when the
 * Python service answers, fails soft (falls back to the original
 * metadata-only hash) when it doesn't, and deterministic mode's contract
 * (no external calls) stays untouched.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/ai/ai-embeddings.service', () => ({
  aiService: { extractNoiseResidual: jest.fn() },
}));

jest.mock('../../src/services/dna/deterministic-identity', () => {
  const actual = jest.requireActual('../../src/services/dna/deterministic-identity') as object;
  return { ...actual, isDnaDeterministicModeEnabled: jest.fn(() => false) };
});

import { OriginLayer } from '../../src/services/layers/layer9.origin';
import { aiService } from '../../src/services/ai/ai-embeddings.service';
import { isDnaDeterministicModeEnabled } from '../../src/services/dna/deterministic-identity';

const extractNoiseResidual = aiService.extractNoiseResidual as unknown as jest.Mock<AnyAsync>;
const deterministicMode = isDnaDeterministicModeEnabled as unknown as jest.Mock<() => boolean>;

function makeImage(mimeType: string, buffer = Buffer.from('fake jpeg bytes')) {
  return {
    filePath: '/tmp/x',
    originalName: 'photo.jpg',
    mimeType,
    sizeBytes: buffer.length,
    buffer,
  };
}

beforeEach(() => {
  extractNoiseResidual.mockReset();
  deterministicMode.mockReset();
  deterministicMode.mockReturnValue(false);
});

describe('Layer 9 — real noise-residual wiring', () => {
  test('folds a real descriptor into originBundle and bundleHash when the Python service answers', async () => {
    extractNoiseResidual.mockResolvedValue({ descriptor: 'ZGF0YQ==', gridSize: 48, method: 'wavelet-bayes-shrink-v1' });

    const layer = new OriginLayer();
    const result = await layer.generate(makeImage('image/jpeg'), 'dna-1');

    expect(result.success).toBe(true);
    expect(extractNoiseResidual).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', 'photo.jpg');
    const bundle = result.data.originBundle as Record<string, unknown>;
    expect(bundle['noiseResidual']).toEqual({ descriptor: 'ZGF0YQ==', gridSize: 48, method: 'wavelet-bayes-shrink-v1' });
  });

  test('bundleHash changes when the descriptor changes (real content-derived signal, not a constant)', async () => {
    extractNoiseResidual.mockResolvedValueOnce({ descriptor: 'AAAA', gridSize: 48, method: 'wavelet-bayes-shrink-v1' });
    const layer = new OriginLayer();
    const r1 = await layer.generate(makeImage('image/jpeg'), 'dna-2');

    extractNoiseResidual.mockResolvedValueOnce({ descriptor: 'ZZZZ', gridSize: 48, method: 'wavelet-bayes-shrink-v1' });
    const r2 = await layer.generate(makeImage('image/jpeg'), 'dna-2');

    expect(r1.data.bundleHash).not.toBe(r2.data.bundleHash);
  });

  test('falls back to the metadata-only hash (never blocks) when the Python service is unavailable', async () => {
    extractNoiseResidual.mockResolvedValue(null);

    const layer = new OriginLayer();
    const result = await layer.generate(makeImage('image/jpeg'), 'dna-3');

    expect(result.success).toBe(true);
    const bundle = result.data.originBundle as Record<string, unknown>;
    expect(bundle['noiseResidual']).toBeUndefined();
    expect(typeof result.data.bundleHash).toBe('string');
    expect(result.data.bundleHash.length).toBeGreaterThan(0);
  });

  test('fails soft (never throws into the caller) if extractNoiseResidual rejects', async () => {
    extractNoiseResidual.mockRejectedValue(new Error('python service unreachable'));

    const layer = new OriginLayer();
    const result = await layer.generate(makeImage('image/jpeg'), 'dna-4');

    expect(result.success).toBe(true);
    const bundle = result.data.originBundle as Record<string, unknown>;
    expect(bundle['noiseResidual']).toBeUndefined();
  });

  test('non-image files never call extractNoiseResidual', async () => {
    const layer = new OriginLayer();
    const result = await layer.generate(makeImage('application/pdf'), 'dna-5');

    expect(extractNoiseResidual).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test('deterministic mode never calls extractNoiseResidual — its no-external-calls contract stays intact', async () => {
    deterministicMode.mockReturnValue(true);

    const layer = new OriginLayer();
    const result = await layer.generate(makeImage('image/jpeg'), 'dna-6', undefined, { contentId: 'content-abc' });

    expect(extractNoiseResidual).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
