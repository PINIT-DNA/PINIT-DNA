/**
 * Layer 9 — Origin / Cross-modal descriptor slot.
 *
 * Milestone B Step 1: when DNA_DETERMINISTIC_MODE is ON, bundleHash is content-only
 * (EDS L9 interim). Session/IP/time may remain in originBundle for Evidence but
 * are excluded from the identity hash.
 */

import crypto from 'crypto';
import { ImageInput } from '../../types/dna.types';
import { OriginLayerResult } from '../../types/dna.types';
import {
  computeCrossModalDescriptor,
  isDnaDeterministicModeEnabled,
} from '../dna/deterministic-identity';
import {
  logIdentityLayerCompleted,
  logIdentityLayerStarted,
} from '../dna/identity-generation-logger';

export class OriginLayer {
  async generate(
    image: ImageInput,
    dnaRecordId: string,
    ctx?: { ip?: string; userAgent?: string; country?: string; city?: string },
    identityCtx?: { contentId: string },
  ): Promise<OriginLayerResult> {
    const start = Date.now();
    const deterministic = isDnaDeterministicModeEnabled();
    logIdentityLayerStarted(9, 'origin', { deterministic });

    try {
      const originBundle = {
        dnaRecordId,
        ip: ctx?.ip ?? 'unknown',
        userAgent: ctx?.userAgent ?? 'unknown',
        country: ctx?.country ?? 'unknown',
        city: ctx?.city ?? 'unknown',
        filename: image.originalName,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        timestamp: new Date().toISOString(),
      };

      const bundleHash = deterministic && identityCtx?.contentId
        ? computeCrossModalDescriptor(identityCtx.contentId, image.mimeType || 'IMAGE')
        : crypto.createHash('sha256').update(JSON.stringify(originBundle)).digest('hex');

      const result: OriginLayerResult = {
        layer: 9,
        name: 'origin',
        success: true,
        processingMs: Date.now() - start,
        data: { originBundle, bundleHash },
      };

      logIdentityLayerCompleted({
        layer: 9,
        name: 'origin',
        durationMs: result.processingMs,
        fingerprintLength: bundleHash.length,
        success: true,
        deterministic,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logIdentityLayerCompleted({
        layer: 9,
        name: 'origin',
        durationMs: Date.now() - start,
        fingerprintLength: 0,
        success: false,
        deterministic,
      });
      return {
        layer: 9,
        name: 'origin',
        success: false,
        processingMs: Date.now() - start,
        error: message,
        data: { originBundle: {}, bundleHash: '' },
      };
    }
  }
}
