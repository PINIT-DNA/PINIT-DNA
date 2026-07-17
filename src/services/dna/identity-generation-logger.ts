/**
 * DNA identity generation logging (Milestone B Step 1).
 * Logs start/complete/duration/hash length/storage — never secrets or PII payloads.
 */

import { logger } from '../../lib/logger';

export function logIdentityLayerStarted(layer: number, name: string, extra?: Record<string, unknown>): void {
  logger.debug('[DNA Identity] layer started', { layer, name, ...extra });
}

export function logIdentityLayerCompleted(input: {
  layer: number;
  name: string;
  durationMs: number;
  fingerprintLength: number;
  success: boolean;
  deterministic: boolean;
  storageSuccess?: boolean;
}): void {
  logger.debug('[DNA Identity] layer completed', {
    layer: input.layer,
    name: input.name,
    durationMs: input.durationMs,
    fingerprintLength: input.fingerprintLength,
    success: input.success,
    deterministic: input.deterministic,
    storageSuccess: input.storageSuccess,
  });
}
