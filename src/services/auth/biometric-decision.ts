/**
 * Internal biometric decision codes. Never send these strings to the Sign In UI.
 */

export const BIOMETRIC_DECISION = {
  FACE_NOT_FOUND: 'FACE_NOT_FOUND',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  LOW_QUALITY: 'LOW_QUALITY',
  BAD_POSE: 'BAD_POSE',
  PAD_FAILED: 'PAD_FAILED',
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',
  MATCH_FAILED: 'MATCH_FAILED',
  MATCH_SUCCESS: 'MATCH_SUCCESS',
  AMBIGUOUS: 'AMBIGUOUS',
  TEMPLATE_MISSING: 'TEMPLATE_MISSING',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  AUTHENTICATION_SUCCESS: 'AUTHENTICATION_SUCCESS',
} as const;

export type BiometricDecisionCode = (typeof BIOMETRIC_DECISION)[keyof typeof BIOMETRIC_DECISION];

/** Simple copy for login/register surfaces. */
export function publicBiometricMessage(code: BiometricDecisionCode): string {
  switch (code) {
    case BIOMETRIC_DECISION.FACE_NOT_FOUND:
    case BIOMETRIC_DECISION.BAD_POSE:
      return 'Look at the camera.';
    case BIOMETRIC_DECISION.MULTIPLE_FACES:
      return 'Make sure only you are in the camera.';
    case BIOMETRIC_DECISION.LOW_QUALITY:
      return 'Make sure your face is clearly visible.';
    case BIOMETRIC_DECISION.PAD_FAILED:
    case BIOMETRIC_DECISION.EMBEDDING_FAILED:
    case BIOMETRIC_DECISION.MATCH_FAILED:
    case BIOMETRIC_DECISION.AMBIGUOUS:
    case BIOMETRIC_DECISION.TEMPLATE_MISSING:
      return "We couldn't verify you. Please try again.";
    case BIOMETRIC_DECISION.MODEL_UNAVAILABLE:
      return "We couldn't verify you. Please try again.";
    case BIOMETRIC_DECISION.MATCH_SUCCESS:
    case BIOMETRIC_DECISION.AUTHENTICATION_SUCCESS:
      return '';
    default:
      return "We couldn't verify you. Please try again.";
  }
}

export function decisionFromClaimedVerify(
  reason: 'no_claim' | 'quality' | 'no_template' | 'mismatch' | 'incompatible_model',
): BiometricDecisionCode {
  if (reason === 'quality') return BIOMETRIC_DECISION.LOW_QUALITY;
  if (reason === 'no_template') return BIOMETRIC_DECISION.TEMPLATE_MISSING;
  if (reason === 'no_claim') return BIOMETRIC_DECISION.MATCH_FAILED;
  return BIOMETRIC_DECISION.MATCH_FAILED;
}
