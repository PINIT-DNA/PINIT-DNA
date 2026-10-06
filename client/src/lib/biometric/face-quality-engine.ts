/**
 * Face quality gate. Thresholds are the only numbers that decide a frame.
 * This does not match identity and it does not decide liveness.
 */
export type QualityReason =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'FACE_TOO_LARGE'
  | 'OFF_CENTER'
  | 'LOW_LIGHT'
  | 'TOO_BRIGHT'
  | 'BLUR'
  | 'BAD_POSE'
  | 'OCCLUDED';

export const FACE_QUALITY_THRESHOLDS = {
  minBoxRatio: 0.04,
  maxBoxRatio: 0.72,
  maxCenterOffsetX: 0.34,
  maxCenterOffsetY: 0.38,
  minBrightness: 28,
  maxBrightness: 235,
  minSharpness: 8,
  maxAbsYaw: 0.55,
  maxAbsPitch: 0.55,
  minEyeAspect: 0.05,
};

export interface FaceQualityInput {
  faceCount: number;
  boxRatio: number;
  centerOffsetX: number;
  centerOffsetY: number;
  brightness: number;
  sharpness: number | null;
  yaw: number;
  pitch: number;
  eyesVisible: boolean;
}

export interface FaceQualityResult {
  passed: boolean;
  reasons: QualityReason[];
}

export function evaluateFaceQuality(
  input: FaceQualityInput,
  limits = FACE_QUALITY_THRESHOLDS,
): FaceQualityResult {
  const reasons: QualityReason[] = [];
  if (input.faceCount < 1) reasons.push('NO_FACE');
  if (input.faceCount > 1) reasons.push('MULTIPLE_FACES');
  if (input.faceCount === 1) {
    if (input.boxRatio < limits.minBoxRatio) reasons.push('FACE_TOO_SMALL');
    if (input.boxRatio > limits.maxBoxRatio) reasons.push('FACE_TOO_LARGE');
    if (input.centerOffsetX > limits.maxCenterOffsetX || input.centerOffsetY > limits.maxCenterOffsetY) {
      reasons.push('OFF_CENTER');
    }
    if (input.brightness < limits.minBrightness) reasons.push('LOW_LIGHT');
    if (input.brightness > limits.maxBrightness) reasons.push('TOO_BRIGHT');
    if (input.sharpness != null && input.sharpness < limits.minSharpness) reasons.push('BLUR');
    if (Math.abs(input.yaw) > limits.maxAbsYaw || Math.abs(input.pitch) > limits.maxAbsPitch) reasons.push('BAD_POSE');
    if (!input.eyesVisible) reasons.push('OCCLUDED');
  }
  return { passed: reasons.length === 0, reasons };
}

export function qualityUserMessage(reasons: QualityReason[]): string {
  const reason = reasons[0];
  switch (reason) {
    case 'LOW_LIGHT':
      return 'Move to a brighter area.';
    case 'TOO_BRIGHT':
      return 'The light is too strong. Turn slightly away from it.';
    case 'FACE_TOO_SMALL':
      return 'Move a little closer.';
    case 'FACE_TOO_LARGE':
      return 'Move a little farther back.';
    case 'OFF_CENTER':
      return 'Center your face.';
    case 'MULTIPLE_FACES':
      return 'Make sure only one person is visible.';
    case 'NO_FACE':
      return 'Look at the camera.';
    case 'BLUR':
      return 'Hold still for a moment.';
    case 'BAD_POSE':
      return 'Look straight at the camera.';
    case 'OCCLUDED':
      return 'Keep your eyes visible and look at the camera.';
    default:
      return 'Look at the camera.';
  }
}
