/**
 * Scanner async helpers — timeouts + stage timing (investigation capture only).
 */

const SLOW_STAGE_MS = 2000;

export class ScannerStageTimeoutError extends Error {
  constructor(stage: string, ms: number) {
    super(`${stage} timed out after ${ms}ms`);
    this.name = 'ScannerStageTimeoutError';
  }
}

export async function withScannerTimeout<T>(
  promise: Promise<T>,
  ms: number,
  stage: string,
): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new ScannerStageTimeoutError(stage, ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export async function runTimedStage<T>(
  stage: string,
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  console.time(`[Scanner] ${stage}`);
  const started = performance.now();
  try {
    const result = await withScannerTimeout(fn(), timeoutMs, stage);
    const elapsed = performance.now() - started;
    if (elapsed > SLOW_STAGE_MS) {
      console.warn(`[Scanner] SLOW stage ${stage}: ${Math.round(elapsed)}ms`);
    }
    return result;
  } finally {
    console.timeEnd(`[Scanner] ${stage}`);
  }
}

export function runTimedStageSync<T>(stage: string, fn: () => T): T {
  console.time(`[Scanner] ${stage}`);
  const started = performance.now();
  try {
    const result = fn();
    const elapsed = performance.now() - started;
    if (elapsed > SLOW_STAGE_MS) {
      console.warn(`[Scanner] SLOW sync stage ${stage}: ${Math.round(elapsed)}ms`);
    }
    return result;
  } finally {
    console.timeEnd(`[Scanner] ${stage}`);
  }
}

export async function createImageBitmapWithTimeout(
  source: Blob | ImageBitmapSource,
  ms = 12_000,
): Promise<ImageBitmap> {
  return withScannerTimeout(createImageBitmap(source), ms, 'createImageBitmap');
}

export async function canvasToBlobWithTimeout(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
  ms = 10_000,
): Promise<Blob | null> {
  const blobPromise = new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
  return withScannerTimeout(blobPromise, ms, 'canvas.toBlob');
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
