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
  const seed = credentialId?.startsWith('sim_') || credentialId?.startsWith('dev_')
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

export interface FaceRankResult {
  best: { userId: string; shortId: string; distance: number; source?: string } | null;
  secondDistance: number;
}

/** Rank probe against all face templates (ascending distance).
 * Registration duplicate detection / explicit identify only — never login.
 */
export function rankFaceMatches(
  probe: number[],
  candidates: Array<{ userId: string; shortId: string; embedding: number[]; source?: string }>,
): FaceRankResult {
  let best: FaceRankResult['best'] = null;
  let secondDistance = Infinity;
  for (const c of candidates) {
    const d = euclideanDistance(probe, c.embedding);
    if (!best || d < best.distance) {
      if (best && best.userId !== c.userId) secondDistance = best.distance;
      best = { userId: c.userId, shortId: c.shortId, distance: d, source: c.source };
    } else if (c.userId !== best.userId && d < secondDistance) {
      secondDistance = d;
    }
  }
  return { best, secondDistance };
}

/**
 * 1:N identification uniqueness (registration / explicit identify only).
 * A unique nearest neighbor is NOT an automatic accept — login must never
 * use this. Empty second-best (Infinity) means the gallery has one user,
 * which is not sufficient to identify the probe as that user.
 */
export function isConfidentFaceMatch(
  bestDistance: number,
  secondDistance: number,
  threshold = THRESHOLDS.faceLogin,
): boolean {
  if (!Number.isFinite(bestDistance) || bestDistance >= threshold) return false;
  if (!Number.isFinite(secondDistance) || secondDistance === Infinity) return false;
  if (secondDistance < threshold) return false;
  const margin = THRESHOLDS.faceLoginMargin ?? 0.08;
  return secondDistance - bestDistance >= margin;
}

/** 1:N enroll uniqueness — any confident hit under the duplicate threshold. */
export function isDuplicateFaceEnrollment(bestDistance: number, secondDistance: number): boolean {
  return isConfidentFaceMatch(bestDistance, secondDistance, THRESHOLDS.faceDuplicate);
}

export function fuseBiometricScores(
  faceDist: number,
  voiceDist: number | null,
  fingerprintDist: number | null,
  opts: { hasVoice: boolean; hasFingerprint: boolean; secondFaceDistance?: number },
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

  const faceOk = isFaceVerified1to1(faceDist);
  const verified = faceOk;

  const overallConfidence = totalWeight > 0 ? weighted / totalWeight : 0;

  return {
    overallConfidence: Math.round(overallConfidence * 10) / 10,
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

/** Reject degenerate probes (all zeros / no variance) before comparison. */
export function isFaceProbeQualityOk(embedding: number[]): boolean {
  if (!isValidTemplate(embedding)) return false;
  let min = embedding[0]!;
  let max = embedding[0]!;
  let absSum = 0;
  for (const v of embedding) {
    if (v < min) min = v;
    if (v > max) max = v;
    absSum += Math.abs(v);
  }
  return absSum > 1e-6 && max - min > 1e-6;
}

/**
 * 1:1 verification — claimed account only.
 * Distance must be finite and strictly below threshold.
 * An empty template or missing claim is always a deny.
 */
export function isFaceVerified1to1(
  distance: number,
  threshold = THRESHOLDS.faceLogin,
): boolean {
  return Number.isFinite(distance) && distance < threshold;
}

export type ClaimedFaceVerifyResult =
  | { ok: true; claimedUserId: string; distance: number }
  | { ok: false; claimedUserId: string | null; reason: 'no_claim' | 'quality' | 'no_template' | 'mismatch' };

/**
 * Verify probe against ONE enrolled template. Never ranks a gallery.
 * On success, identity is always the claimed user — never a nearest neighbor.
 */
export function verifyClaimedFace(params: {
  claimedUserId: string | null | undefined;
  probe: number[];
  enrolled: number[] | null;
  threshold?: number;
}): ClaimedFaceVerifyResult {
  const claimedUserId = typeof params.claimedUserId === 'string' ? params.claimedUserId.trim() : '';
  if (!claimedUserId) {
    return { ok: false, claimedUserId: null, reason: 'no_claim' };
  }
  if (!isFaceProbeQualityOk(params.probe)) {
    return { ok: false, claimedUserId, reason: 'quality' };
  }
  if (!params.enrolled || !isValidTemplate(params.enrolled)) {
    return { ok: false, claimedUserId, reason: 'no_template' };
  }
  const distance = euclideanDistance(
    normalizeEmbedding(params.probe),
    normalizeEmbedding(params.enrolled),
  );
  if (!isFaceVerified1to1(distance, params.threshold ?? THRESHOLDS.faceLogin)) {
    return { ok: false, claimedUserId, reason: 'mismatch' };
  }
  return { ok: true, claimedUserId, distance };
}
