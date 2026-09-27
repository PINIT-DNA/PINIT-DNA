/**
 * music-metadata <= 11.12.1 has an infinite loop in its ASF (WMA/WMV) parser
 * (npm audit: high). Upgrading is a breaking major bump (ESM-only), so instead a
 * file carrying an ASF header never reaches the parser — even when it is
 * declared as mp3/wav, because the library also picks a parser from the bytes.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const parseBuffer = jest.fn<AnyAsync>();
jest.mock('music-metadata', () => ({ parseBuffer }));
// The engine writes its result to the DB; never let a unit test reach a real database.
jest.mock('../../src/lib/prisma', () => ({
  prisma: { dnaRecord: { update: jest.fn(async () => ({})) } },
}));
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { AudioDnaEngine, looksLikeAsf } from '../../src/services/engines/audio/audio-dna-engine';

const ASF_GUID = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');

beforeEach(() => {
  parseBuffer.mockReset();
  parseBuffer.mockResolvedValue({ format: {}, common: {} });
});

const file = (buffer: Buffer, mime = 'audio/mpeg') => ({
  filePath: '', originalName: 'x.mp3', declaredMimeType: mime, sizeBytes: buffer.length, buffer,
});

describe('looksLikeAsf', () => {
  test('recognises the ASF header GUID', () => {
    expect(looksLikeAsf(Buffer.concat([ASF_GUID, Buffer.alloc(64)]))).toBe(true);
  });
  test('rejects ordinary audio and short buffers', () => {
    expect(looksLikeAsf(Buffer.from('ID3\u0003\u0000\u0000', 'latin1'))).toBe(false);
    expect(looksLikeAsf(Buffer.from('RIFF....WAVEfmt ', 'latin1'))).toBe(false);
    expect(looksLikeAsf(Buffer.alloc(4))).toBe(false);
    expect(looksLikeAsf(Buffer.alloc(0))).toBe(false);
  });
});

describe('AudioDnaEngine metadata parsing', () => {
  test('an ASF-header file declared as audio/mpeg never reaches the metadata parser', async () => {
    const asf = Buffer.concat([ASF_GUID, Buffer.alloc(4096, 7)]);
    const r = await new AudioDnaEngine().generate(file(asf), 'dna-asf');
    expect(parseBuffer).not.toHaveBeenCalled();
    expect(r).toBeDefined(); // the engine still completes via its binary-analysis fallback
  });

  test('an ordinary audio file is still parsed', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4096, 3)]);
    await new AudioDnaEngine().generate(file(wav, 'audio/wav'), 'dna-wav');
    expect(parseBuffer).toHaveBeenCalledTimes(1);
  });
});
