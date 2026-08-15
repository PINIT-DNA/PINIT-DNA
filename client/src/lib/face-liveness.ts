/**
 * Client capture for web PAD.
 * Embedding is computed only after a live challenge session with one face
 * and measurable motion. The server re-evaluates evidence and is authoritative.
 */
import * as faceapi from 'face-api.js';
import { ensureFaceModels, waitForVideoFrames } from './face-capture';
import { requestFaceChallenge, type FacePadEvidence } from './face-api-client';
import { evaluatePadFacePresence, FACE_LOSS_RECOVERY_MS } from './pad-face-presence';

const PATCH = 24;
const MIN_SAMPLES = 10;
const SAMPLE_EVERY_MS = 110;
const YAW = 0.14;
const PITCH = 0.10;

export const PAD_HINTS: Record<string, string> = {
  yaw_left: 'Turn your head left, then face the camera',
  yaw_right: 'Turn your head right, then face the camera',
  pitch_down: 'Look down, then look back at the camera',
};

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

function poseHit(action: string, yaw: number, pitch: number): boolean {
  if (action === 'yaw_left') return yaw <= -YAW;
  if (action === 'yaw_right') return yaw >= YAW;
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
}

export async function runPadCapture(
  video: HTMLVideoElement,
  opts: {
    onProgress?: (pct: number) => void;
    onHint?: (hint: string) => void;
    timeoutMs?: number;
  } = {},
): Promise<PadCaptureResult> {
  await ensureFaceModels();
  await waitForVideoFrames(video);
  const challenge = await requestFaceChallenge();
  const actions = challenge.actions;
  const timeoutMs = opts.timeoutMs ?? 28000;
  const started = Date.now();
  const detector = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.38 });

  const samples: FacePadEvidence['samples'] = [];
  const patches: string[] = [];
  const descriptors: Float32Array[] = [];
  let actionIdx = 0;
  /** Continuous zero-face streak start; cleared when one face is reacquired. */
  let faceLostSince: number | null = null;
  opts.onHint?.(PAD_HINTS[actions[0]!] ?? 'Follow the on-screen motion');
  opts.onProgress?.(6);

  while (Date.now() - started < timeoutMs) {
    const all = await faceapi.detectAllFaces(video, detector).withFaceLandmarks().withFaceDescriptors();
    const presence = evaluatePadFacePresence({
      faceCount: all.length,
      faceLostSince,
      now: Date.now(),
      samplesCollected: samples.length,
      recoveryMs: FACE_LOSS_RECOVERY_MS,
    });
    faceLostSince = presence.faceLostSince;

    if (presence.outcome === 'multiple_faces') {
      throw new Error('Only one face is allowed. Make sure nobody else is in the camera frame.');
    }
    if (presence.outcome === 'face_lost') {
      throw new Error('Face lost during verification. Center your face and try again.');
    }
    if (presence.outcome === 'continue') {
      await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
      continue;
    }

    // presence.outcome === 'process_face'
    const det = all[0];
    if (!det) {
      await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
      continue;
    }
    const box = det.detection.box;
    const pose = headPose(det.landmarks);
    const packed = extractPatch(video, box);
    if (!packed) {
      await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
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

    const current = actions[actionIdx];
    if (current && poseHit(current, pose.yaw, pose.pitch)) {
      actionIdx += 1;
      const next = actions[actionIdx];
      opts.onHint?.(next ? (PAD_HINTS[next] ?? 'Hold still…') : 'Hold still — finishing liveness');
    }

    const pct = Math.min(88, 8 + samples.length * 4 + actionIdx * 18);
    opts.onProgress?.(pct);

    const duration = samples[samples.length - 1]!.t - samples[0]!.t;
    if (actionIdx >= actions.length && samples.length >= MIN_SAMPLES && duration >= 1800) {
      break;
    }

    await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
  }

  if (samples.length === 0) {
    throw new Error('No face detected. Face the camera in good light and retry.');
  }
  if (actionIdx < actions.length || samples.length < MIN_SAMPLES) {
    throw new Error('Liveness was inconclusive. Follow the head-motion prompts and retry.');
  }

  const motion = patchMotion(patches);
  if (motion <= 0.012) {
    throw new Error('Liveness check failed. Use a live camera — printed photos and screens are not accepted.');
  }
  if (motion < 0.028) {
    throw new Error('Liveness was inconclusive. Move naturally through the prompts in good light, then retry.');
  }

  const last = descriptors.slice(-3);
  if (!last.length) throw new Error('Face capture failed. Retry.');
  const avg = new Float32Array(128);
  for (const d of last) {
    for (let i = 0; i < 128; i++) avg[i] += d[i]! / last.length;
  }

  opts.onProgress?.(100);
  return {
    embedding: normalizeDescriptor(avg),
    padEvidence: {
      challengeToken: challenge.token,
      samples,
      patches,
    },
  };
}
