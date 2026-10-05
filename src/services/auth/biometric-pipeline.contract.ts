/**
 * Stable biometric pipeline contract (Phase 2).
 *
 * Camera → detect → quality/landmarks → PAD → align → server embed →
 * encrypted versioned template → 1:1 (known/claimed identity) → session.
 *
 * Authoritative identity embedding is server-side once a commercially licensed
 * recognition engine is enabled. Until then the live engine remains face-api-v1
 * (client 128-d), tagged as untrusted-for-future-replacement.
 *
 * 1:N identify is not part of this Sign In contract.
 */

import { BIOMETRIC_DECISION, type BiometricDecisionCode } from './biometric-decision';

export const FACE_API_V1 = {
  algorithm: 'face-api-v1',
  algorithmVersion: '1',
  modelVersion: 'face-api-tiny-v1',
  dimension: 128,
  templateVersion: '1',
} as const;

/** Licensed ArcFace-family ONNX — not loaded until legal approval + weights. */
export const LICENSED_ARCFACE = {
  algorithm: 'arcface-family-licensed',
  algorithmVersion: '1',
  modelVersion: 'unset',
  dimension: 512,
  templateVersion: '1',
} as const;

export type RecognitionEngineId = 'face-api-v1' | 'arcface-family-licensed';

export interface FaceQualityInput {
  faceCount: number;
  poseOk: boolean;
  qualityOk: boolean;
}

export function qualityDecision(input: FaceQualityInput): BiometricDecisionCode | null {
  if (input.faceCount < 1) return BIOMETRIC_DECISION.FACE_NOT_FOUND;
  if (input.faceCount > 1) return BIOMETRIC_DECISION.MULTIPLE_FACES;
  if (!input.qualityOk) return BIOMETRIC_DECISION.LOW_QUALITY;
  if (!input.poseOk) return BIOMETRIC_DECISION.BAD_POSE;
  return null;
}

export interface AlignedFaceCrop {
  mime: 'image/jpeg';
  bytes: Buffer;
  width: number;
  height: number;
}

export interface VersionedEmbedding {
  algorithm: string;
  modelVersion: string;
  dimension: number;
  values: number[];
}

export function embeddingsComparable(a: Pick<VersionedEmbedding, 'algorithm' | 'dimension' | 'modelVersion'>, b: typeof a): boolean {
  return a.algorithm === b.algorithm && a.dimension === b.dimension && a.modelVersion === b.modelVersion;
}

export type SignInIdentityMode = 'known_browser_1to1' | 'claimed_1to1';

export const SIGN_IN_V1 = {
  knownBrowser: 'known_browser_1to1' as const,
  unknownBrowser: 'claimed_1to1' as const,
  identifyInNormalSignIn: false,
};
