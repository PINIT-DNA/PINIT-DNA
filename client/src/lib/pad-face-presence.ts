/**
 * Pure PAD face-presence state — temporary detector misses must not abort capture.
 * Used by runPadCapture; unit-tested without webcam / face-api.
 */

export const FACE_LOSS_RECOVERY_MS = 2000;

export type PadFacePresenceOutcome =
  | 'process_face'
  | 'continue' // brief miss — keep looping, no sample
  | 'face_lost' // continuous miss exceeded recovery window (had prior detections)
  | 'multiple_faces';

export function evaluatePadFacePresence(params: {
  faceCount: number;
  /** When continuous zero-face streak started; null if face currently present */
  faceLostSince: number | null;
  now: number;
  /** Successful face samples already collected in this capture */
  samplesCollected: number;
  recoveryMs?: number;
}): { faceLostSince: number | null; outcome: PadFacePresenceOutcome } {
  const recoveryMs = params.recoveryMs ?? FACE_LOSS_RECOVERY_MS;

  if (params.faceCount > 1) {
    return { faceLostSince: params.faceLostSince, outcome: 'multiple_faces' };
  }

  if (params.faceCount === 1) {
    return { faceLostSince: null, outcome: 'process_face' };
  }

  // faceCount === 0 — do not early-abort when no samples yet; overall PAD timeout owns that.
  const since = params.faceLostSince ?? params.now;
  if (params.samplesCollected > 0 && params.now - since >= recoveryMs) {
    return { faceLostSince: since, outcome: 'face_lost' };
  }
  return { faceLostSince: since, outcome: 'continue' };
}
