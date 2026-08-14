/**
 * Face embedding capture for the HOID round-camera wizard.
 */
import * as faceapi from 'face-api.js';

let modelsReady: Promise<void> | null = null;

export function preloadFaceModels(): void {
  void ensureFaceModels();
}

export async function ensureFaceModels(): Promise<void> {
  if (!modelsReady) {
    modelsReady = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]).then(() => undefined);
  }
  await modelsReady;
}

function normalize(values: Float32Array | number[]): number[] {
  const out = new Float32Array(128);
  let norm = 0;
  for (let i = 0; i < 128; i++) norm += values[i]! * values[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 128; i++) out[i] = values[i]! / norm;
  return Array.from(out);
}

export type FaceCaptureMode = 'register' | 'login';

async function waitForVideoFrames(video: HTMLVideoElement, maxMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (video.readyState >= 2 && video.videoWidth >= 160 && video.videoHeight >= 120) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Camera not ready. Allow camera access and try again.');
}

/** Fast face capture — register averages more frames; rejects 0 or 2+ faces. */
export async function captureFaceEmbeddingFromVideo(
  video: HTMLVideoElement,
  onProgress?: (pct: number) => void,
  opts: { samples?: number; timeoutMs?: number; mode?: FaceCaptureMode } = {},
): Promise<number[]> {
  await ensureFaceModels();
  await waitForVideoFrames(video);

  const mode = opts.mode ?? 'login';
  const need = opts.samples ?? (mode === 'register' ? 3 : 2);
  const timeoutMs = opts.timeoutMs ?? (mode === 'register' ? 20000 : 14000);
  const samples: Float32Array[] = [];
  const started = Date.now();
  const scoreThreshold = mode === 'register' ? 0.32 : 0.38;
  const detector = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold });

  onProgress?.(8);

  while (samples.length < need) {
    if (Date.now() - started > timeoutMs) {
      if (samples.length >= (mode === 'register' ? 2 : 1)) break;
      throw new Error('Face not detected. Face the camera in good light, then tap Start Face Scan again.');
    }

    const all = await faceapi
      .detectAllFaces(video, detector)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (all.length > 1) {
      throw new Error('Only one face is allowed. Make sure nobody else is in the camera frame.');
    }

    if (all.length === 1 && all[0]) {
      samples.push(all[0].descriptor);
      onProgress?.(Math.min(92, 15 + samples.length * (75 / need)));
      if (samples.length < need) await new Promise((r) => setTimeout(r, 60));
    } else {
      onProgress?.(Math.min(12, 5 + (Date.now() - started) / 500));
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const avg = new Float32Array(128);
  for (const s of samples) {
    for (let i = 0; i < 128; i++) avg[i] += s[i]! / samples.length;
  }
  onProgress?.(100);
  return normalize(avg);
}
