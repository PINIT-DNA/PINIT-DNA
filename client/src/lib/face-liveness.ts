/**
 * Client capture for web PAD.
 * Embedding is computed only after a live challenge session with one face
 * and measurable motion. The server re-evaluates evidence and is authoritative.
 */
import * as faceapi from 'face-api.js';
import { ensureFaceModels, waitForVideoFrames, logFaceTiming } from './face-capture';
import { analyzeAndCorrectLighting, enhanceFaceImageContrast, type LightingStatus } from './face-image-processing';
import { requestFaceChallenge, type FacePadEvidence } from './face-api-client';
import { enrollFaceHint } from './enroll-face-quality';
import { evaluatePadFacePresence, FACE_LOSS_RECOVERY_MS } from './pad-face-presence';

const PATCH = 24;
const MIN_SAMPLES = 10;
const SAMPLE_EVERY_MS = 110;
const YAW = 0.14;
const PITCH = 0.10;

export const PAD_HINTS: Record<string, string> = {
  yaw_left: 'Turn a little left, then look at the camera',
  yaw_right: 'Turn a little right, then look at the camera',
  pitch_down: 'Look down slightly, then look at the camera',
};

function captureStopped(signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  return false;
}

function throwIfCaptureStopped(signal?: AbortSignal): void {
  if (!captureStopped(signal)) return;
  const err = new Error('CAPTURE_ABORTED');
  err.name = 'AbortError';
  throw err;
}

function meanPoint(pts: faceapi.Point[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = pts.length || 1;
  return { x: x / n, y: y / n };
}

function headPose(landmarks: faceapi.FaceLandmarks68): { yaw: number; pitch: number } {
  const left = meanPoint(landmarks.getLeftEye());
  const right = meanPoint(landmarks.getRightEye());
  const nosePts = landmarks.getNose();
  const nose = nosePts[Math.min(3, nosePts.length - 1)] ?? nosePts[0]!;
  const iod = Math.hypot(right.x - left.x, right.y - left.y) || 1;
  const midX = (left.x + right.x) / 2;
  const midY = (left.y + right.y) / 2;
  return {
    yaw: (nose.x - midX) / iod,
    pitch: (nose.y - midY) / iod,
  };
}

/**
 * Video is unmirrored (raw camera feed, no CSS flip) — turning the head to the
 * subject's own left shifts the nose toward larger x (screen-right) in that feed,
 * the same reason your right hand appears on the left side of an unmirrored call.
 */
function poseHit(action: string, yaw: number, pitch: number): boolean {
  if (action === 'yaw_left') return yaw >= YAW;
  if (action === 'yaw_right') return yaw <= -YAW;
  return pitch >= PITCH;
}

function extractPatch(video: HTMLVideoElement, box: faceapi.Box): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = PATCH;
  canvas.height = PATCH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pad = Math.max(box.width, box.height) * 0.15;
  const sx = Math.max(0, box.x - pad);
  const sy = Math.max(0, box.y - pad);
  const sw = Math.min(video.videoWidth - sx, box.width + pad * 2);
  const sh = Math.min(video.videoHeight - sy, box.height + pad * 2);
  if (sw < 8 || sh < 8) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PATCH, PATCH);
  const img = ctx.getImageData(0, 0, PATCH, PATCH);
  const gray = new Uint8Array(PATCH * PATCH);
  let brightness = 0;
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    const g = Math.round(0.299 * img.data[o]! + 0.587 * img.data[o + 1]! + 0.114 * img.data[o + 2]!);
    gray[i] = g;
    brightness += g;
  }
  brightness /= gray.length;
  let binary = '';
  for (let i = 0; i < gray.length; i++) binary += String.fromCharCode(gray[i]!);
  return JSON.stringify({ b64: btoa(binary), brightness });
}

function patchMotion(patches: string[]): number {
  const decoded = patches.map((p) => {
    try {
      return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  });
  let sum = 0;
  let n = 0;
  for (let i = 1; i < decoded.length; i++) {
    const a = decoded[i - 1];
    const b = decoded[i];
    if (!a || !b || a.length !== b.length) continue;
    let d = 0;
    for (let k = 0; k < a.length; k++) d += Math.abs(a[k]! - b[k]!);
    sum += d / a.length / 255;
    n++;
  }
  return n ? sum / n : 0;
}

function normalizeDescriptor(values: Float32Array): number[] {
  const out = new Array(128).fill(0);
  let norm = 0;
  for (let i = 0; i < 128; i++) norm += values[i]! * values[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 128; i++) out[i] = values[i]! / norm;
  return out;
}

export interface PadCaptureResult {
  embedding: number[];
  padEvidence: FacePadEvidence;
  lighting: { status: LightingStatus; average: number };
}

function videoFrameCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, video.videoWidth);
  canvas.height = Math.max(1, video.videoHeight);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function detectFacesForPad(
  video: HTMLVideoElement,
  detector: faceapi.TinyFaceDetectorOptions,
  onLighting?: (status: LightingStatus, average: number) => void,
) {
  const meter = videoFrameCanvas(video);
  const lighting = analyzeAndCorrectLighting(meter);
  onLighting?.(lighting.status, lighting.average);

  // Descriptors must come from the live video — same path as enrollment.
  // Histogram stretch is only a finder for dark/backlit frames.
  let all = await faceapi.detectAllFaces(video, detector).withFaceLandmarks().withFaceDescriptors();
  if (all.length > 0) return all;

  if (lighting.status !== 'OPTIMAL') {
    enhanceFaceImageContrast(meter);
    const boostedBoxes = await faceapi.detectAllFaces(meter, detector);
    if (boostedBoxes.length > 0) {
      all = await faceapi.detectAllFaces(video, detector).withFaceLandmarks().withFaceDescriptors();
      if (all.length > 0) return all;
    }
  }

  const loose = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.08 });
  return faceapi.detectAllFaces(video, loose).withFaceLandmarks().withFaceDescriptors();
}

export async function runPadCapture(
  video: HTMLVideoElement,
  opts: {
    onProgress?: (pct: number) => void;
    onHint?: (hint: string) => void;
    timeoutMs?: number;
    /** Login glance (~1s). Enrollment keeps the full pose challenge. */
    mode?: 'enroll' | 'verify';
    onLighting?: (status: LightingStatus, average: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<PadCaptureResult> {
  const captureStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const verify = opts.mode === 'verify';
  const minSamples = verify ? 6 : MIN_SAMPLES;
  const minDurationMs = verify ? 700 : 1800;
  const sampleEvery = verify ? 55 : SAMPLE_EVERY_MS;
  const minMotion = 0.028;
  const timeoutMs = opts.timeoutMs ?? (verify ? 12000 : 28000);
  const inputSize = 416;
  const scoreThreshold = verify ? 0.14 : 0.22;

  const [, challenge] = await Promise.all([
    ensureFaceModels(),
    requestFaceChallenge({ mode: verify ? 'passive' : 'active' }),
  ]);
  await waitForVideoFrames(video);
  const actions = challenge.actions;
  const started = Date.now();
  const detector = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });

  const samples: FacePadEvidence['samples'] = [];
  const patches: string[] = [];
  const descriptors: Float32Array[] = [];
  let actionIdx = 0;
  /** Continuous zero-face streak start; cleared when one face is reacquired. */
  let faceLostSince: number | null = null;
  opts.onHint?.(
    verify
      ? 'Look at the camera — we’ll verify your identity.'
      : (PAD_HINTS[actions[0]!] ?? 'Look at the camera'),
  );
  opts.onProgress?.(6);

  let lightingStatus: LightingStatus = 'OPTIMAL';
  let lightingAverage = 128;
  const reportLighting = (status: LightingStatus, average: number) => {
    lightingStatus = status;
    lightingAverage = average;
    opts.onLighting?.(status, average);
  };

  while (Date.now() - started < timeoutMs) {
    throwIfCaptureStopped(opts.signal);
    const all = await detectFacesForPad(video, detector, reportLighting);
    const presence = evaluatePadFacePresence({
      faceCount: all.length,
      faceLostSince,
      now: Date.now(),
      samplesCollected: samples.length,
      recoveryMs: FACE_LOSS_RECOVERY_MS,
    });
    faceLostSince = presence.faceLostSince;

    if (presence.outcome === 'multiple_faces') {
      throw new Error('Only one person should be in the camera.');
    }
    if (presence.outcome === 'face_lost') {
      throw new Error('Stay in the oval and look at the camera.');
    }
    if (presence.outcome === 'continue') {
      await new Promise((r) => setTimeout(r, sampleEvery));
      continue;
    }

    // presence.outcome === 'process_face'
    const det = all[0];
    if (!det) {
      await new Promise((r) => setTimeout(r, sampleEvery));
      continue;
    }
    const box = det.detection.box;
    const pose = headPose(det.landmarks);
    if (!verify) {
      const enrollHint = enrollFaceHint({
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        video: { width: video.videoWidth, height: video.videoHeight },
        leftEye: det.landmarks.getLeftEye(),
        rightEye: det.landmarks.getRightEye(),
        jaw: det.landmarks.getJawOutline(),
      });
      if (enrollHint) opts.onHint?.(enrollHint);
    }
    const packed = extractPatch(video, box);
    if (!packed) {
      await new Promise((r) => setTimeout(r, sampleEvery));
      continue;
    }
    const parsed = JSON.parse(packed) as { b64: string; brightness: number };
    const frameArea = Math.max(1, video.videoWidth * video.videoHeight);
    samples.push({
      t: Date.now() - started,
      yaw: pose.yaw,
      pitch: pose.pitch,
      faceCount: 1,
      boxRatio: (box.width * box.height) / frameArea,
      brightness: parsed.brightness,
    });
    patches.push(parsed.b64);
    descriptors.push(det.descriptor);

    if (!verify) {
      const current = actions[actionIdx];
      if (current && poseHit(current, pose.yaw, pose.pitch)) {
        actionIdx += 1;
        const next = actions[actionIdx];
        opts.onHint?.(next ? (PAD_HINTS[next] ?? 'Hold still') : 'Hold still');
      }
    }

    const pct = verify
      ? Math.min(88, 12 + samples.length * 12)
      : Math.min(88, 8 + samples.length * 4 + actionIdx * 18);
    opts.onProgress?.(pct);

    const duration = samples[samples.length - 1]!.t - samples[0]!.t;
    const posesDone = verify || actionIdx >= actions.length;
    if (posesDone && samples.length >= minSamples && duration >= minDurationMs) {
      break;
    }

    await new Promise((r) => setTimeout(r, sampleEvery));
  }

  if (samples.length === 0) {
    throw new Error('Look at the camera in good light and try again.');
  }
  if ((!verify && actionIdx < actions.length) || samples.length < minSamples) {
    throw new Error('Look at the camera and follow the on-screen prompts, then try again.');
  }

  const motion = patchMotion(patches);
  if (motion <= 0.012) {
    throw new Error('Use a live camera. Photos and screens cannot be used.');
  }
  if (!verify && motion < minMotion) {
    throw new Error('Move naturally with the prompts in good light, then try again.');
  }

  const last = descriptors.slice(verify ? -3 : -6);
  if (!last.length) throw new Error('Could not capture your face. Try again.');
  const avg = new Float32Array(128);
  for (const d of last) {
    for (let i = 0; i < 128; i++) avg[i] += d[i]! / last.length;
  }

  opts.onProgress?.(100);
  const captureEnded = typeof performance !== 'undefined' ? performance.now() : Date.now();
  logFaceTiming('pad_capture', captureEnded - captureStarted, { mode: verify ? 'verify' : 'enroll', samples: samples.length });
  return {
    embedding: normalizeDescriptor(avg),
    padEvidence: {
      challengeToken: challenge.token,
      samples,
      patches,
    },
    lighting: { status: lightingStatus, average: lightingAverage },
  };
}

/** Enrollment: one full face, both eyes open, iris area visible. */
export async function waitForFaceFramed(
  video: HTMLVideoElement,
  opts: { onHint?: (hint: string) => void; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  await ensureFaceModels();
  await waitForVideoFrames(video);
  const timeoutMs = opts.timeoutMs ?? 32000;
  const started = Date.now();
  const detector = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.12 });
  let stableSince: number | null = null;

  while (Date.now() - started < timeoutMs) {
    throwIfCaptureStopped(opts.signal);
    const all = await faceapi.detectAllFaces(video, detector).withFaceLandmarks();
    if (all.length > 1) {
      stableSince = null;
      opts.onHint?.('Only one person in the frame');
    } else if (all.length === 1) {
      const det = all[0]!;
      const box = det.detection.box;
      const hint = enrollFaceHint({
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        video: { width: video.videoWidth, height: video.videoHeight },
        leftEye: det.landmarks.getLeftEye(),
        rightEye: det.landmarks.getRightEye(),
        jaw: det.landmarks.getJawOutline(),
      });
      if (hint) {
        stableSince = null;
        opts.onHint?.(hint);
      } else {
        opts.onHint?.('Hold still');
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 900) return;
      }
    } else {
      stableSince = null;
      opts.onHint?.('Look at the camera');
    }
    await new Promise((r) => setTimeout(r, 180));
  }
  throw new Error('Look at the camera with your full face in the oval and try again.');
}
