/**
 * Run a self-contained, CPU-heavy pixel function OFF the main thread.
 *
 * Several DNA layers walk every pixel in plain JS. On a 12 MP photo that is seconds of
 * synchronous work, during which the whole API (every user) stalls — and when several
 * requests queue such sections back to back, network callbacks starve for far longer.
 * A layer keeps its arithmetic in a `core` function that has NO imports and NO outer
 * variables; this helper serialises it with Function#toString() and evaluates it inside
 * a worker thread. Same code, same operation order => byte-identical output.
 *
 * Concurrency is bounded and shared by every caller, and any worker failure falls back
 * to running the function inline (correct, just not off-thread).
 */
import os from 'os';
import { Worker } from 'worker_threads';
import { logger } from './logger';

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

/** Global off switch: PIXEL_WORKERS=false runs every pixel job inline. */
export const pixelWorkersEnabled = (): boolean =>
  (process.env['PIXEL_WORKERS'] ?? 'true').toLowerCase() !== 'false';

function runInWorker<R>(core: (...a: never[]) => R, args: unknown[]): Promise<R> {
  const source = `
    const { parentPort, workerData } = require('worker_threads');
    const core = ${core.toString()};
    const r = core(...workerData.args);
    // Hand big typed arrays back without copying them.
    const transfer = [];
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r)) {
        const v = r[k];
        if (v && ArrayBuffer.isView(v) && v.buffer.byteLength > 65536) transfer.push(v.buffer);
      }
    }
    parentPort.postMessage(r, transfer);
  `;
  return new Promise<R>((resolve, reject) => {
    // workerData is structured-cloned: the caller keeps its own pixel buffer.
    const worker = new Worker(source, { eval: true, workerData: { args } });
    worker.once('message', (r: R) => resolve(r));
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`pixel worker exited with code ${code}`)); });
  });
}

/**
 * Run `core(...args)` in a worker thread (when `offload` is true and workers are enabled),
 * otherwise — or if the worker fails — inline.
 */
export async function runPixelJob<A extends unknown[], R>(
  core: (...a: A) => R,
  args: A,
  opts: { offload: boolean; label: string },
): Promise<R> {
  if (!opts.offload || !pixelWorkersEnabled()) return core(...args);
  await acquireSlot();
  try {
    return await runInWorker(core as unknown as (...a: never[]) => R, args);
  } catch (err) {
    logger.warn(`${opts.label} worker failed — computing inline`, { error: String(err) });
    return core(...args);
  } finally {
    releaseSlot();
  }
}
