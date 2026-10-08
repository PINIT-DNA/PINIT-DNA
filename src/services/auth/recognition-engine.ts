/**
 * Recognition engines. Production weights are not loaded here.
 * Licensed ArcFace-family embed returns MODEL_UNAVAILABLE until legal + files exist.
 */
import { config } from '../../config';
import { BIOMETRIC_DECISION, type BiometricDecisionCode } from './biometric-decision';
import {
  FACE_API_V1,
  LICENSED_ARCFACE,
  type AlignedFaceCrop,
  type RecognitionEngineId,
  type VersionedEmbedding,
} from './biometric-pipeline.contract';

export function activeRecognitionEngineId(): RecognitionEngineId {
  const raw = config.biometric.recognitionEngine;
  if (raw === 'arcface-family-licensed') return 'arcface-family-licensed';
  return 'face-api-v1';
}

export function activeEngineMeta(): typeof FACE_API_V1 | typeof LICENSED_ARCFACE {
  return activeRecognitionEngineId() === 'arcface-family-licensed' ? LICENSED_ARCFACE : FACE_API_V1;
}

/**
 * Server-side embedding from an aligned crop.
 * face-api-v1 does not run on the server today — callers must not treat a
 * client vector as a future ArcFace template.
 */
export async function embedAlignedFaceCrop(
  _crop: AlignedFaceCrop,
): Promise<{ ok: true; embedding: VersionedEmbedding } | { ok: false; code: BiometricDecisionCode }> {
  const engine = activeRecognitionEngineId();
  if (engine === 'arcface-family-licensed') {
    return { ok: false, code: BIOMETRIC_DECISION.MODEL_UNAVAILABLE };
  }
  return { ok: false, code: BIOMETRIC_DECISION.MODEL_UNAVAILABLE };
}

export function acceptClientFaceApiEmbedding(values: number[]): VersionedEmbedding | null {
  if (!Array.isArray(values) || values.length !== FACE_API_V1.dimension) return null;
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return {
    algorithm: FACE_API_V1.algorithm,
    modelVersion: FACE_API_V1.modelVersion,
    dimension: FACE_API_V1.dimension,
    values,
  };
}

/**
 * Temporary matcher entry. Login and registration call only this.
 * face-api-v1 accepts the client 128-d vector. A licensed engine returns
 * MODEL_UNAVAILABLE until its weights are installed — the steps do not change.
 */
export function acceptProbeForActiveEngine(values: number[]): VersionedEmbedding | null {
  if (activeRecognitionEngineId() !== 'face-api-v1') return null;
  return acceptClientFaceApiEmbedding(values);
}
