/**
 * Passive presentation-attack interface.
 * The temporary engine is a still-photo screen. It is not production anti-spoofing.
 * UNKNOWN is never treated as LIVE.
 */
export type PassivePadVerdict = 'LIVE' | 'SPOOF' | 'UNKNOWN' | 'ERROR';

export interface PassivePadResult {
  verdict: PassivePadVerdict;
  reasons: string[];
  /** False until a licensed passive PAD model is installed. */
  productionGrade: false;
  engineId: 'passive-heuristic-v1';
}

const STATIC_MOTION = 0.012;

export function decidePassiveHeuristic(input: {
  motion: number;
  sampleCount: number;
  durationMs: number;
  qualityPassed: boolean;
}): PassivePadResult {
  const base = { productionGrade: false as const, engineId: 'passive-heuristic-v1' as const };
  if (!input.qualityPassed) {
    return { ...base, verdict: 'UNKNOWN', reasons: ['quality_not_passed'] };
  }
  if (input.sampleCount < 4 || input.durationMs < 500) {
    return { ...base, verdict: 'UNKNOWN', reasons: ['insufficient_observation'] };
  }
  if (!Number.isFinite(input.motion)) {
    return { ...base, verdict: 'ERROR', reasons: ['motion_unreadable'] };
  }
  if (input.motion <= STATIC_MOTION) {
    return { ...base, verdict: 'SPOOF', reasons: ['static_presentation'] };
  }
  return { ...base, verdict: 'LIVE', reasons: ['natural_presence'] };
}

export function padUserMessage(verdict: PassivePadVerdict): string {
  if (verdict === 'SPOOF') return 'Use a live camera. A photo or a screen cannot sign in.';
  if (verdict === 'UNKNOWN') return 'Hold still and look at the camera.';
  if (verdict === 'ERROR') return 'The camera check failed. Try again.';
  return '';
}
