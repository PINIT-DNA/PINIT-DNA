/**
 * Layer 4's per-pixel colour-histogram loop used to run on the main thread: over a second
 * of frozen event loop for a 12 MP photo (and, when several requests queued it back to back,
 * network callbacks starved for far longer). It now runs in a worker thread for large
 * images. Stored DNA fingerprints must NOT change, so this pins the exact outputs the
 * previous inline implementation produced (golden values captured from the old code before
 * the refactor) and proves the worker path, the inline path and the failure fallback agree.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals';
import sharp from 'sharp';
import crypto from 'crypto';

import { SemanticLayer } from '../../src/services/layers/layer4.semantic';
import { semanticCore, computeSemanticCore } from '../../src/services/layers/layer4.core';

const sha = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);

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

const solid = (w: number, h: number, c: { r: number; g: number; b: number }, alpha?: number) =>
  sharp({ create: { width: w, height: h, channels: alpha === undefined ? 3 : 4, background: alpha === undefined ? c : { ...c, alpha } } }).png().toBuffer();

// [name, image factory, fingerprint, rgb-hist sha, hsv-hist sha, dominant-colours sha]
// Captured from the ORIGINAL inline implementation (git HEAD before this change).
const GOLDEN: Array<[string, () => Promise<Buffer>, string, string, string, string]> = [
  ['300x200#1 (inline path)', () => photo(300, 200, 1), '4d364d366936', 'd4f75e150df6ff4be1ea507e', 'e39d5bc96195f3e9eb0ae126', '77bac1c14cfa6e25c3f74e02'],
  ['1200x900#2 (worker path)', () => photo(1200, 900, 2), '4d354d356935', '4a505350362f6150450c5c22', 'b92e14eca553c1337d84bfce', 'a8f03e8564f898f54c71318e'],
  ['1601x1003#3 (worker, odd size)', () => photo(1601, 1003, 3), '693569354d35', '4d975ec778df4d133aa6faf3', 'b24d1657cb277c6762f338c8', '1f8ddde409319cfc463b95ad'],
  ['1000x1000#4 (exactly at threshold)', () => photo(1000, 1000, 4), '4d354d366935', '23dc0122f87815de89a16031', '074a7f13eb3c7e1976906413', '73d254587021b79ff0ab6232'],
  ['solid 1000x1000', () => solid(1000, 1000, { r: 40, g: 90, b: 200 }), '20ff40ffc0ff', '389316cbb4755c68a6cd855d', 'c0ad163cffe6963a383ea53d', '8ff0e0923bf03e6c0bd9f2a6'],
  ['alpha 1200x1000', () => solid(1200, 1000, { r: 200, g: 30, b: 60 }, 0.5), 'c0ff04ff20ff', '80a91780ad611adb26c5824d', 'f37057a40a0212cb66111a2d', 'f324bc2e8d461d13b0ffa69a'],
  ['mostly grey 1100x1000', async () => sharp({ create: { width: 1100, height: 1000, channels: 3, background: { r: 128, g: 128, b: 128 } } }).composite([{ input: await photo(500, 500, 9), left: 50, top: 50 }]).png().toBuffer(), '8cd18cd18cd1', '3b41e2c8d3a164074d6c44d1', 'cf06a3b5adb5a60a258d16e5', '20c8712155dcadbdcdf4218c'],
];

afterEach(() => {
  jest.resetModules();
  jest.dontMock('worker_threads');
  delete process.env['LAYER4_WORKER'];
  delete process.env['PIXEL_WORKERS'];
});

describe('Layer 4 output is unchanged by the worker refactor', () => {
  test.each(GOLDEN)('%s matches the original implementation exactly', async (_name, make, fp, rgb, hsv, dom) => {
    const buf = await make();
    const r = await new SemanticLayer().generate({
      filePath: '', originalName: 'g.png', mimeType: 'image/png', sizeBytes: buf.length, buffer: buf,
    } as never);
    expect(r.success).toBe(true);
    const d = r.data as unknown as Record<string, unknown>;
    expect(d['colorFingerprint']).toBe(fp);
    expect(sha([d['histogramR'], d['histogramG'], d['histogramB']])).toBe(rgb);
    expect(sha([d['histogramH'], d['histogramS']])).toBe(hsv);
    expect(sha(d['dominantColors'])).toBe(dom);
  }, 60_000);
});

describe('worker vs inline', () => {
  const raw = async (w: number, h: number, seed: number) =>
    new Uint8Array((await sharp(await photo(w, h, seed)).removeAlpha().raw().toBuffer()));

  test('a large image gives identical results through the worker and inline, including Map order', async () => {
    const data = await raw(1400, 1000, 9);
    const inline = semanticCore(data);
    const viaWorker = await computeSemanticCore(data, 1400 * 1000);
    expect(viaWorker.histR).toEqual(inline.histR);
    expect(viaWorker.histG).toEqual(inline.histG);
    expect(viaWorker.histB).toEqual(inline.histB);
    expect(viaWorker.histH).toEqual(inline.histH);
    expect(viaWorker.histS).toEqual(inline.histS);
    expect(viaWorker.colorEntries).toEqual(inline.colorEntries); // same entries in the same order
  }, 60_000);

  test('the caller keeps its own pixel buffer intact (worker gets a copy)', async () => {
    const data = await raw(1200, 900, 5);
    const before = crypto.createHash('sha256').update(data).digest('hex');
    await computeSemanticCore(data, 1200 * 900);
    expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(before);
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
    const core = await import('../../src/services/layers/layer4.core');
    const data = await raw(1200, 900, 2);
    const r = await core.computeSemanticCore(data, 1200 * 900);
    const expected = core.semanticCore(data);
    expect(r.histR).toEqual(expected.histR);
    expect(r.colorEntries).toEqual(expected.colorEntries);
  }, 60_000);

  test.each([['LAYER4_WORKER', 'false'], ['PIXEL_WORKERS', 'false']])('%s=%s never starts a worker', async (name, value) => {
    jest.resetModules();
    process.env[name] = value;
    const ctor = jest.fn();
    jest.doMock('worker_threads', () => ({ Worker: class { constructor() { ctor(); } once() { /* never used */ } } }));
    const core = await import('../../src/services/layers/layer4.core');
    await core.computeSemanticCore(await raw(1200, 900, 2), 1200 * 900);
    expect(ctor).not.toHaveBeenCalled();
  }, 60_000);
});
