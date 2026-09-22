/**
 * `matchLocalDescriptors` is the Node client for /cv/match-descriptors — the
 * previously-unused endpoint that lets ORB comparison reuse descriptors already
 * stored at protect time instead of re-fetching and re-extracting a vault
 * original on every call. Like every other method on this service, it must
 * never throw: an offline AI service degrades to "no signal", not a crash.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const mockPost = jest.fn<AnyAsync>();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({ post: mockPost, get: jest.fn() })),
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { aiService } from '../../src/services/ai/ai-embeddings.service';

beforeEach(() => {
  mockPost.mockReset();
});

describe('AIEmbeddingsService.matchLocalDescriptors', () => {
  test('a successful response is parsed into the expected shape', async () => {
    mockPost.mockResolvedValue({
      data: {
        success: true,
        similarity: 0.72,
        matches: 55,
        method: 'opencv_orb',
        probeKeypoints: 900,
        referenceKeypoints: 1200,
      },
    });

    const result = await aiService.matchLocalDescriptors(Buffer.from('probe'), { keypoints: [] });

    expect(result).toEqual({
      similarity: 0.72,
      matches: 55,
      method: 'opencv_orb',
      probeKeypoints: 900,
      referenceKeypoints: 1200,
    });
  });

  test('axios rejecting (AI service offline) resolves null, never throws', async () => {
    mockPost.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    await expect(
      aiService.matchLocalDescriptors(Buffer.from('probe'), { keypoints: [] }),
    ).resolves.toBeNull();
  });

  test('a malformed response (missing numeric similarity) resolves null', async () => {
    mockPost.mockResolvedValue({ data: { success: false } });

    const result = await aiService.matchLocalDescriptors(Buffer.from('probe'), { keypoints: [] });

    expect(result).toBeNull();
  });

  test('the posted form includes both the probe and the descriptors JSON', async () => {
    mockPost.mockResolvedValue({ data: { success: true, similarity: 0.5, matches: 10 } });

    await aiService.matchLocalDescriptors(Buffer.from('probe-bytes'), { keypoints: [{ x: 1 }] });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, form] = mockPost.mock.calls[0] as [string, { getBuffer?: () => Buffer }];
    expect(url).toBe('/cv/match-descriptors');
    // form-data exposes its accumulated parts via getBuffer(); the raw
    // multipart body must contain both field names we appended.
    const raw = form.getBuffer ? form.getBuffer().toString('utf8') : '';
    expect(raw).toContain('name="probe"');
    expect(raw).toContain('name="descriptors"');
    expect(raw).toContain('"x":1');
  });
});
