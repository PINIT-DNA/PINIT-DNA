/**
 * Layer 4 — the per-pixel colour-histogram pass, kept separate so it can run OFF the
 * main thread.
 *
 * On a 12 MP photo the loop below (RGB + HSV histograms and a quantised colour Map, one
 * iteration per pixel) is over a second of synchronous work, blocking the whole API. It
 * is the exact computation that used to live inline in SemanticLayer.generate(); it is
 * self-contained (no imports, no outer variables) so it can run inline or inside a worker
 * from its own source text. Same code, same arithmetic order => byte-identical output —
 * stored DNA fingerprints must not change.
 */
import { runPixelJob } from '../../lib/pixel-worker';

export interface SemanticCoreResult {
  histR: number[];
  histG: number[];
  histB: number[];
  histH: number[];
  histS: number[];
  /** Quantised colour counts in the Map's insertion order (order matters for sort ties). */
  colorEntries: Array<[number, number]>;
}

/**
 * MUST stay self-contained: it is serialised with Function#toString() and evaluated inside
 * a worker. Do not reference imports or module-level values.
 */
/* istanbul ignore next -- executed from its own source text inside a worker */
export function semanticCore(raw: Uint8Array): SemanticCoreResult {
  const FULL_BINS = 256;
  const histR = new Array<number>(FULL_BINS).fill(0);
  const histG = new Array<number>(FULL_BINS).fill(0);
  const histB = new Array<number>(FULL_BINS).fill(0);
  const histH = new Array<number>(360).fill(0);
  const histS = new Array<number>(100).fill(0);
  const colorMap = new Map<number, number>();

  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];

    histR[r]++;
    histG[g]++;
    histB[b]++;

    // RGB -> HSV (identical arithmetic to SemanticLayer.rgbToHsv; only h and s are used)
    const rN = r / 255;
    const gN = g / 255;
    const bN = b / 255;
    const max = Math.max(rN, gN, bN);
    const min = Math.min(rN, gN, bN);
    const delta = max - min;
    let h = 0;
    if (delta > 0) {
      if (max === rN) h = 60 * (((gN - bN) / delta) % 6);
      else if (max === gN) h = 60 * ((bN - rN) / delta + 2);
      else h = 60 * ((rN - gN) / delta + 4);
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : delta / max;
    const hOut = Math.floor(h) % 360;
    const sOut = Math.floor(s * 99);

    histH[Math.floor(hOut)]++;
    histS[Math.min(99, Math.floor(sOut))]++;

    // Quantise to 4 bits per channel for dominant colours
    const quantKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    colorMap.set(quantKey, (colorMap.get(quantKey) ?? 0) + 1);
  }

  return { histR, histG, histB, histH, histS, colorEntries: Array.from(colorMap.entries()) };
}

/** Below this many pixels the ~30 ms worker start-up costs more than it saves. */
const WORKER_MIN_PIXELS = parseInt(process.env['LAYER4_WORKER_MIN_PIXELS'] ?? '1000000', 10);
const LAYER4_WORKER_ENABLED = (process.env['LAYER4_WORKER'] ?? 'true').toLowerCase() !== 'false';

/**
 * Run the Layer 4 pixel pass. Large images go to a worker thread so the event loop stays
 * free; small images, LAYER4_WORKER=false, or any worker failure run it inline.
 */
export async function computeSemanticCore(raw: Uint8Array, totalPixels: number): Promise<SemanticCoreResult> {
  return runPixelJob(semanticCore, [raw], {
    offload: LAYER4_WORKER_ENABLED && totalPixels >= WORKER_MIN_PIXELS,
    label: 'Layer 4',
  });
}
