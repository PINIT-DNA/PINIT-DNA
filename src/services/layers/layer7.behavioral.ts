/**
 * Layer 7 — Behavioral / Local-patch identity slot.
 *
 * Milestone B Step 1: when DNA_DETERMINISTIC_MODE is ON, behaviorHash is a
 * content-only digest (EDS L7 interim). Upload/session fields remain in the
 * row for Evidence/provenance but do NOT enter the identity fingerprint.
 */

import crypto from 'crypto';
import { ImageInput } from '../../types/dna.types';
import { BehavioralLayerResult } from '../../types/dna.types';
import {
  computeLocalPatchIdentityDigest,
  isDnaDeterministicModeEnabled,
} from '../dna/deterministic-identity';
import {
  logIdentityLayerCompleted,
  logIdentityLayerStarted,
} from '../dna/identity-generation-logger';

export class BehavioralLayer {
  async generate(
    image: ImageInput,
    dnaRecordId: string,
    uploadStartMs: number,
    userAgent?: string,
    sessionToken?: string,
    /** L1 + L3 for deterministic identity */
    identityCtx?: { contentId: string; perceptualPrimary: string },
  ): Promise<BehavioralLayerResult> {
    const start = Date.now();
    const deterministic = isDnaDeterministicModeEnabled();
    logIdentityLayerStarted(7, 'behavioral', { deterministic });

    try {
      const uploadMs = Math.max(0, Date.now() - uploadStartMs);

      const hashedSession = sessionToken
        ? crypto.createHash('sha256').update(sessionToken).digest('hex').slice(0, 16)
        : undefined;

      let behaviorHash: string;
      if (deterministic && identityCtx?.contentId) {
        behaviorHash = computeLocalPatchIdentityDigest(
          identityCtx.contentId,
          identityCtx.perceptualPrimary ?? '',
        );
      } else {
        // Legacy non-deterministic bundle (rollback path)
        const bundle = {
          dnaRecordId,
          filename: image.originalName,
          sizeBytes: image.sizeBytes,
          mimeType: image.mimeType,
          uploadMs,
          userAgent: userAgent ?? 'unknown',
          sessionToken: sessionToken ?? 'unknown',
          ts: new Date().toISOString(),
        };
        behaviorHash = crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
      }

      const result: BehavioralLayerResult = {
        layer: 7,
        name: 'behavioral',
        success: true,
        processingMs: Date.now() - start,
        data: {
          behaviorHash,
          uploadMs,
          sessionToken: hashedSession,
          userAgent: userAgent ?? null,
        },
      };

      logIdentityLayerCompleted({
        layer: 7,
        name: 'behavioral',
        durationMs: result.processingMs,
        fingerprintLength: behaviorHash.length,
        success: true,
        deterministic,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logIdentityLayerCompleted({
        layer: 7,
        name: 'behavioral',
        durationMs: Date.now() - start,
        fingerprintLength: 0,
        success: false,
        deterministic,
      });
      return {
        layer: 7,
        name: 'behavioral',
        success: false,
        processingMs: Date.now() - start,
        error: message,
        data: { behaviorHash: '', uploadMs: 0, sessionToken: undefined, userAgent: null },
      };
    }
  }
}
