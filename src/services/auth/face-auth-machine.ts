/**
 * Face-first authentication. The recognition engine is replaceable.
 * These steps are not.
 *
 * capture → pad → match → session
 *
 * A passkey is not a step. A session is created only after match succeeds.
 */

export const FACE_AUTH_STEPS = ['capture', 'pad', 'match', 'session'] as const;

/** Full sign-in order. A session exists only after PASSIVE_PAD is LIVE and the match passes. */
export const BIOMETRIC_AUTH_STATES = [
  'IDLE',
  'CAMERA_REQUEST',
  'CAMERA_READY',
  'FACE_DETECTED',
  'SINGLE_FACE_VALID',
  'QUALITY_CHECK',
  'PASSIVE_PAD',
  'FACE_ALIGNMENT',
  'EMBEDDING',
  'MATCH_1TO1',
  'AUTHENTICATED',
  'CREATE_SESSION',
] as const;

export type FaceAuthStep = (typeof FACE_AUTH_STEPS)[number];

export function nextFaceAuthStep(current: FaceAuthStep): FaceAuthStep | null {
  const index = FACE_AUTH_STEPS.indexOf(current);
  if (index < 0 || index >= FACE_AUTH_STEPS.length - 1) return null;
  return FACE_AUTH_STEPS[index + 1] ?? null;
}

/** Session is legal only when liveness and the matcher have both passed. */
export function mayIssueSession(padLive: boolean, matched: boolean): boolean {
  return padLive === true && matched === true;
}
