/**
 * Layer 9 — Origin.
 *
 * 2026-09-23: now derives a real signal from the file's own pixels for
 * images — a content-derived noise-residual descriptor (see
 * ai-embeddings.service.ts::extractNoiseResidual, backed by
 * python-ai/services/computer_vision/service.py::extract_noise_residual).
 * NOT camera-identification PRNU: real source-camera PRNU needs a reference
 * pattern averaged across many known photos from one physical camera, and
 * this codebase has no device-enrollment system or multi-photo-per-device
 * corpus to build that from — out of scope. What this genuinely is: a
 * real per-image sensor-noise-style fingerprint that CAN be compared
 * pairwise against another image's (compareNoiseResiduals), proven against
 * a synthetic sensor-pattern simulation in python-ai/tests/test_noise_residual.py
 * (not real camera photos — no such dataset is available here). Not wired
 * into duplicate/match scoring (weighted-dna-scoring.service.ts still only
 * uses layers 1-6) — additive and optional, same caution DNA-B corroboration
 * used before it was proven.
 *
 * Fails soft: if the Python service is unavailable, or the file isn't an
 * image, bundleHash falls back to the original session-metadata hash below
 * — non-image files and video never had a content-derived option here.
 *
 * - Normal mode: bundleHash is a hash of upload SESSION metadata (IP, user
 *   agent, country, city, filename, size, timestamp) — forensic/audit
 *   context about the upload event, not the file — now additionally folded
 *   with the noise-residual descriptor when one was extracted.
 * - "Deterministic" mode: bundleHash = SHA256("XMOD:v1|" + mediaType + "|" +
 *   contentId) — contentId already comes from elsewhere (Layer 1), so this
 *   is a re-hash of an existing ID with a type tag, not new cross-modal
 *   analysis. Its own helper (computeCrossModalDescriptor) is documented as
 *   an "interim... content-only sketch," not a finished feature. Unaffected
 *   by this change — deterministic mode's contract (same input always
 *   produces the same hash, no external calls) stays intact.
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
import { aiService } from '../ai/ai-embeddings.service';

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
      const originBundle: Record<string, unknown> = {
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

      // Deterministic mode's contract (same input -> same hash, no external
      // calls) stays exactly as it was — the content-derived descriptor
      // below only applies to normal-mode, non-deterministic identity.
      let noiseResidual: { descriptor: string; gridSize: number; method: string } | null = null;
      if (!deterministic && image.mimeType?.startsWith('image/') && image.buffer?.length) {
        try {
          noiseResidual = await aiService.extractNoiseResidual(image.buffer, image.mimeType, image.originalName);
        } catch {
          noiseResidual = null; // fails soft — falls through to metadata-only hash below
        }
        if (noiseResidual) {
          originBundle['noiseResidual'] = noiseResidual;
        }
      }

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
