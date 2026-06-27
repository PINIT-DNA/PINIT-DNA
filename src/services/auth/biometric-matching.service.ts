/**
 * Enterprise biometric matching — distance, confidence, fusion scoring.
 */
import crypto from 'crypto';
import { config } from '../../config';

export const THRESHOLDS = config.biometric.thresholds;

export function normalizeEmbedding(embedding: number[]): number[] {
  let norm = 0;
  for (const v of embedding) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return embedding.map((v) => v / norm);
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
}

export function distanceToConfidence(distance: number, threshold: number): number {
  if (!Number.isFinite(distance) || distance >= threshold) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - distance / threshold) * 100)));
}

/** Derive a 128-d fingerprint template from WebAuthn credential or device hash. */
export function deriveFingerprintTemplate(credentialId?: string | null, deviceFingerprint?: string | null): number[] {
  const seed = credentialId?.startsWith('sim_')
    ? `device:${deviceFingerprint ?? 'web'}`
    : (credentialId ?? `device:${deviceFingerprint ?? 'unknown'}`);
  const hash = crypto.createHash('sha256').update(seed).digest();
  const out = new Array(128).fill(0);
  for (let i = 0; i < 128; i++) out[i] = (hash[i % 32]! / 127.5) - 1;
  return normalizeEmbedding(out);
}

export interface ModalityScores {
  face: number;
  voice: number;
  fingerprint: number;
  faceDistance: number;
  voiceDistance: number;
  fingerprintDistance: number;
}

export interface FusionResult {
  overallConfidence: number;
  verified: boolean;
  scores: ModalityScores;
}

export function fuseBiometricScores(
  faceDist: number,
  voiceDist: number | null,
  fingerprintDist: number | null,
  opts: { hasVoice: boolean; hasFingerprint: boolean },
): FusionResult {
  const w = THRESHOLDS.weights;
  const faceConf = distanceToConfidence(faceDist, THRESHOLDS.faceLogin);
  const voiceConf = opts.hasVoice && voiceDist !== null
    ? distanceToConfidence(voiceDist, THRESHOLDS.voiceLogin)
    : 0;
  const fpConf = opts.hasFingerprint && fingerprintDist !== null
    ? distanceToConfidence(fingerprintDist, THRESHOLDS.fingerprintLogin)
    : 0;

  let totalWeight = w.face;
  let weighted = faceConf * w.face;

  if (opts.hasVoice && voiceDist !== null) {
    totalWeight += w.voice;
    weighted += voiceConf * w.voice;
  }
  if (opts.hasFingerprint && fingerprintDist !== null) {
    totalWeight += w.fingerprint;
    weighted += fpConf * w.fingerprint;
  }

  // Face-primary authentication — Face is the primary lock.
  const faceOk = faceDist < THRESHOLDS.faceLogin;
  const verified = faceOk;

  const overallConfidence = totalWeight > 0 ? weighted / totalWeight : 0;

  return {    overallConfidence: Math.round(overallConfidence * 10) / 10,
    verified,
    scores: {
      face: faceConf,
      voice: voiceConf,
      fingerprint: fpConf,
      faceDistance: faceDist,
      voiceDistance: voiceDist ?? Infinity,
      fingerprintDistance: fingerprintDist ?? Infinity,
    },
  };
}

export function isValidTemplate(arr: unknown, dim = 128): arr is number[] {
  return Array.isArray(arr) && arr.length === dim && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
}
