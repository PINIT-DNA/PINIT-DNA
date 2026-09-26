/**
 * Layer 2 — pixel math, kept separate so it can run OFF the main thread.
 *
 * The Sobel edge pass walks every pixel in plain JS. On a 12 MP photo that is
 * ~3.5 s of synchronous work, during which the whole API (every user) stalls.
 * `structuralCore` is the exact same computation that used to live inline in
 * StructuralLayer.generate(); it is self-contained (no imports, no outer
 * variables) so it can be run either inline or inside a worker thread from its
 * own source text. Same code, same arithmetic order => byte-identical output —
 * the stored DNA fingerprints must not change.
 */
import os from 'os';
import { Worker } from 'worker_threads';
import { logger } from '../../lib/logger';

export interface StructuralCoreResult {
  /** 3-channel (R=G=B) normalised gradient magnitude, width*height*3 bytes. */
  normalisedRgb: Uint8Array;
  edgeVectors: Array<{ angle: number; magnitude: number }>;
  /** One bit per zone: 1 when the zone's edge density is above the global mean. */
  signatureBits: number[];
  edgePixelCount: number;
  /** Flat indices of the first edge pixels (only the first 64 are ever used). */
  firstEdgePixels: number[];
}

/**
 * MUST stay self-contained: it is serialised with Function#toString() and
 * evaluated inside a worker. Do not reference imports or module-level values.
 */
/* istanbul ignore next -- executed from its own source text inside a worker */
export function structuralCore(rawRgb: Uint8Array, width: number, height: number): StructuralCoreResult {
  const SOBEL_X = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  const SOBEL_Y = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
  const EDGE_THRESHOLD = 30;
  const GRID_SIZE = 8;
  const KEEP_FIRST_EDGE_PIXELS = 64;

  // RGB -> grayscale (Y = 0.299R + 0.587G + 0.114B)
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rawRgb[i * 3];
    const g = rawRgb[i * 3 + 1];
    const b = rawRgb[i * 3 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Sobel gradient magnitude + angle (1px border excluded)
  const gradient = new Float32Array(width * height);
  const gradientAngle = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const pixel = gray[(y + ky - 1) * width + (x + kx - 1)];
          gx += pixel * SOBEL_X[ky][kx];
          gy += pixel * SOBEL_Y[ky][kx];
        }
      }
      const mag = Math.sqrt(gx * gx + gy * gy);
      gradient[y * width + x] = mag;
      gradientAngle[y * width + x] = ((Math.atan2(gy, gx) * 180) / Math.PI + 360) % 360;
    }
  }

  // Edge pixels: only the count and the first few indices are ever needed.
  let edgePixelCount = 0;
  const firstEdgePixels: number[] = [];
  for (let i = 0; i < gradient.length; i++) {
    if (gradient[i] > EDGE_THRESHOLD) {
      if (firstEdgePixels.length < KEEP_FIRST_EDGE_PIXELS) firstEdgePixels.push(i);
      edgePixelCount++;
    }
  }

  // 64 zones, one dominant edge vector each
  const edgeVectors: Array<{ angle: number; magnitude: number }> = [];
  const zoneW = Math.floor(width / GRID_SIZE);
  const zoneH = Math.floor(height / GRID_SIZE);
  for (let zy = 0; zy < GRID_SIZE; zy++) {
    for (let zx = 0; zx < GRID_SIZE; zx++) {
      let totalMag = 0;
      let totalAngle = 0;
      let count = 0;
      for (let py = zy * zoneH; py < (zy + 1) * zoneH && py < height; py++) {
        for (let px = zx * zoneW; px < (zx + 1) * zoneW && px < width; px++) {
          const idx = py * width + px;
          if (gradient[idx] > EDGE_THRESHOLD) {
            totalMag += gradient[idx];
            totalAngle += gradientAngle[idx];
            count++;
          }
        }
      }
      const zoneArea = zoneW * zoneH;
      edgeVectors.push({
        angle: count > 0 ? totalAngle / count : 0,
        magnitude: count > 0 ? Math.min(totalMag / (zoneArea * 255), 1.0) : 0,
      });
    }
  }

  // 64-bit signature: bit = 1 when the zone density is above the global mean
  const densities = edgeVectors.map((v) => v.magnitude);
  let sum = 0;
  for (let i = 0; i < densities.length; i++) sum += densities[i];
  const meanDensity = sum / densities.length;
  const signatureBits = densities.map((d) => (d > meanDensity ? 1 : 0));

  // Edge-map normalisation (gradient -> 0..255, replicated to 3 channels)
  let maxGrad = 0;
  for (let i = 0; i < gradient.length; i++) {
    if (gradient[i] > maxGrad) maxGrad = gradient[i];
  }
  const normalisedRgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < gradient.length; i++) {
    const v = maxGrad > 0 ? Math.round((gradient[i] / maxGrad) * 255) : 0;
    normalisedRgb[i * 3] = v;
    normalisedRgb[i * 3 + 1] = v;
    normalisedRgb[i * 3 + 2] = v;
  }

  return { normalisedRgb, edgeVectors, signatureBits, edgePixelCount, firstEdgePixels };
}

// ── Worker-thread runner ─────────────────────────────────────────────────────

/** Below this many pixels the ~30 ms worker start-up costs more than it saves. */
const WORKER_MIN_PIXELS = parseInt(process.env['LAYER2_WORKER_MIN_PIXELS'] ?? '1000000', 10);
const WORKERS_ENABLED = (process.env['LAYER2_WORKER'] ?? 'true').toLowerCase() !== 'false';
const MAX_CONCURRENT_WORKERS = Math.max(1, Math.min(4, os.cpus().length - 1));

let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT_WORKERS) { active++; return; }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function releaseSlot(): void {
  active--;
  const next = waiting.shift();
  if (next) next();
}

function runInWorker(rawRgb: Uint8Array, width: number, height: number): Promise<StructuralCoreResult> {
  const source = `
    const { parentPort, workerData } = require('worker_threads');
    const core = ${structuralCore.toString()};
    const r = core(workerData.rawRgb, workerData.width, workerData.height);
    parentPort.postMessage(r, [r.normalisedRgb.buffer]);
  `;
  return new Promise<StructuralCoreResult>((resolve, reject) => {
    // workerData is structured-cloned: the caller keeps its own pixel buffer.
    const worker = new Worker(source, { eval: true, workerData: { rawRgb, width, height } });
    worker.once('message', (r: StructuralCoreResult) => resolve(r));
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`Layer 2 worker exited with code ${code}`)); });
  });
}

/**
 * Run the Layer 2 pixel math. Large images go to a worker thread so the event
 * loop stays free; small images, a disabled flag, or any worker failure run it
 * inline (same function, same result).
 */
export async function computeStructuralCore(
  rawRgb: Uint8Array,
  width: number,
  height: number,
): Promise<StructuralCoreResult> {
  if (!WORKERS_ENABLED || width * height < WORKER_MIN_PIXELS) {
    return structuralCore(rawRgb, width, height);
  }
  await acquireSlot();
  try {
    return await runInWorker(rawRgb, width, height);
  } catch (err) {
    logger.warn('Layer 2 worker failed — computing inline', { error: String(err) });
    return structuralCore(rawRgb, width, height);
  } finally {
    releaseSlot();
  }
}
