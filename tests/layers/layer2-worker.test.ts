/**
 * Layer 2's per-pixel Sobel math used to run on the main thread: 3.5 s of frozen
 * event loop for a 12 MP photo, stalling every other request. It now runs in a
 * worker thread for large images. The stored DNA fingerprints must NOT change,
 * so this pins the exact outputs the previous inline implementation produced
 * (golden values captured from the old code before the refactor) and proves the
 * worker path, the inline path and the failure fallback all agree byte for byte.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals';
import sharp from 'sharp';
import crypto from 'crypto';

import { StructuralLayer } from '../../src/services/layers/layer2.structural';
import { structuralCore, computeStructuralCore } from '../../src/services/layers/layer2.core';

/** Deterministic test image — identical generator to the one used to capture the goldens. */
async function photo(w: number, h: number, seed: number) {
  const px = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = ((i / 3) | 0) % w;
    const y = (i / 3 / w) | 0;
    px[i] = (((x * 5 + y * 3) % 255) * 0.6 + ((s >>> 24) % 60)) & 255;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 24);

// Captured from the ORIGINAL inline implementation (git HEAD before this change).
const GOLDEN: Array<[number, number, number, string, string, string]> = [
  [300, 200, 1, '66b3dd6e37d9ec76', '1616e2057d59058c8b01caf0', '97438a2f7378ae6020d898ad'],   // small -> inline path
  [1200, 900, 2, '00fcd23ebc6e0efc', '76719cefae46e0146492f54a', 'a1c5e0daff3947b18f0ecc07'],  // worker path
  [1601, 1003, 3, '00de4a0c0f3e3bf7', '64666a8b7c36d6b56b07527a', '6c9a951910eeaa9bf0c00d54'], // worker, odd size
  [1000, 1000, 4, '5abd4af56ad57a15', '28cf0da0ae8ad640d9fdd98e', 'f82387f184bd37ca79526374'], // exactly at the threshold
];

afterEach(() => {
  jest.resetModules();
  jest.dontMock('worker_threads');
  delete process.env['LAYER2_WORKER'];
});

describe('Layer 2 output is unchanged by the worker refactor', () => {
  test.each(GOLDEN)('%ix%i #%i matches the original implementation exactly', async (w, h, seed, sig, edgeMap, vec) => {
    const buf = await photo(w, h, seed);
    const r = await new StructuralLayer().generate({
      filePath: '', originalName: 'g.png', mimeType: 'image/png', sizeBytes: buf.length, buffer: buf,
    } as never);
    expect(r.success).toBe(true);
    expect(r.data.edgeSignature64).toBe(sig);
    expect(sha(r.data.edgeMapB64)).toBe(edgeMap);
    expect(sha(JSON.stringify(r.data.edgeVectors))).toBe(vec);
  }, 60_000);
});

describe('worker vs inline', () => {
  test('a large image gives byte-identical results through the worker and inline', async () => {
    const w = 1400, h = 1000;
    const { data } = await sharp(await photo(w, h, 9)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const inline = structuralCore(new Uint8Array(data), w, h);
    const viaWorker = await computeStructuralCore(new Uint8Array(data), w, h);
    expect(Buffer.from(viaWorker.normalisedRgb).equals(Buffer.from(inline.normalisedRgb))).toBe(true);
    expect(viaWorker.edgeVectors).toEqual(inline.edgeVectors);
    expect(viaWorker.signatureBits).toEqual(inline.signatureBits);
    expect(viaWorker.edgePixelCount).toBe(inline.edgePixelCount);
    expect(viaWorker.firstEdgePixels).toEqual(inline.firstEdgePixels);
  }, 60_000);

  test('the caller keeps its own pixel buffer intact (worker gets a copy)', async () => {
    const w = 1200, h = 900;
    const { data } = await sharp(await photo(w, h, 5)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const raw = new Uint8Array(data);
    const before = crypto.createHash('sha256').update(raw).digest('hex');
    await computeStructuralCore(raw, w, h);
    expect(raw.byteLength).toBe(w * h * 3);
    expect(crypto.createHash('sha256').update(raw).digest('hex')).toBe(before);
  }, 60_000);

  test('a worker failure falls back to inline and still returns the correct result', async () => {
    jest.resetModules();
    jest.doMock('worker_threads', () => ({
      Worker: class {
        private handlers: Record<string, (a?: unknown) => void> = {};
        constructor() { setImmediate(() => this.handlers['error']?.(new Error('simulated worker crash'))); }
        once(evt: string, cb: (a?: unknown) => void) { this.handlers[evt] = cb; }
      },
    }));
    const core = await import('../../src/services/layers/layer2.core');
    const w = 1200, h = 900;
    const { data } = await sharp(await photo(w, h, 2)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = await core.computeStructuralCore(new Uint8Array(data), w, h);
    const expected = core.structuralCore(new Uint8Array(data), w, h);
    expect(r.signatureBits).toEqual(expected.signatureBits);
    expect(Buffer.from(r.normalisedRgb).equals(Buffer.from(expected.normalisedRgb))).toBe(true);
  }, 60_000);

  test('LAYER2_WORKER=false never starts a worker', async () => {
    jest.resetModules();
    process.env['LAYER2_WORKER'] = 'false';
    const ctor = jest.fn();
    jest.doMock('worker_threads', () => ({ Worker: class { constructor() { ctor(); } once() {} } }));
    const core = await import('../../src/services/layers/layer2.core');
    const { data } = await sharp(await photo(1200, 900, 2)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    await core.computeStructuralCore(new Uint8Array(data), 1200, 900);
    expect(ctor).not.toHaveBeenCalled();
  }, 60_000);
});
