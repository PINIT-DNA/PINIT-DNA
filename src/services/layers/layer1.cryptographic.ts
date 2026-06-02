/**
 * PINIT-DNA — Layer 1: SHA-256 Cryptographic Hash
 *
 * From the theoretical spec:
 *   "The system reads every single pixel in the image and feeds all those numbers
 *    into SHA-256. This formula always produces the same 64-character code for the
 *    same input. If even one pixel changes, the entire code changes completely."
 *
 * Two hashes are stored:
 *   sha256Hash      — SHA-256 of the raw file bytes (exact file identity)
 *   normalizedHash  — SHA-256 of raw pixel values extracted by sharp (strips EXIF,
 *                     survives re-saves of identical content)
 *
 * Survives:  Nothing — any pixel change produces a completely different hash.
 * Purpose:   Proves whether a given image is the EXACT untouched original.
 *            Like a wax seal — it breaks on any tampering but proves integrity instantly.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { ImageInput, CryptoLayerResult } from '../../types/dna.types';
import { logger } from '../../lib/logger';

export class CryptographicLayer {
  readonly layerNumber = 1 as const;
  readonly layerName = 'cryptographic' as const;

  /**
   * Generate SHA-256 fingerprints for the given image.
   *
   * sha256Hash:     SHA-256 of the raw uploaded file bytes.
   *                 Changes if the file is re-saved, re-encoded, or metadata is edited.
   *
   * normalizedHash: SHA-256 of the decoded pixel values (R,G,B per pixel, row by row).
   *                 Does NOT change when EXIF is stripped or the file is losslessly
   *                 re-saved — only changes if actual pixel content changes.
   *                 This is the "true" content fingerprint described in the spec.
   */
  async generate(image: ImageInput): Promise<CryptoLayerResult> {
    const start = Date.now();
    logger.debug('Layer 1 — generating cryptographic hash', { file: image.originalName });

    try {
      // ── Hash 1: Raw file bytes ─────────────────────────────────────────────
      // SHA-256 of the exact uploaded bytes — changes on any re-encode
      const sha256Hash = crypto
        .createHash('sha256')
        .update(image.buffer)
        .digest('hex');

      // ── Hash 2: Pixel-level content hash ──────────────────────────────────
      // Extract raw RGB pixel values using sharp (strips all EXIF/metadata)
      // This reads every pixel R,G,B value in left-to-right, top-to-bottom order
      // and hashes that byte sequence — matching the spec's definition exactly.
      const { data: pixelBytes } = await sharp(image.buffer)
        .removeAlpha()   // normalise to 3-channel RGB
        .raw()           // extract raw pixel bytes (no encoding)
        .toBuffer({ resolveWithObject: true });

      const normalizedHash = crypto
        .createHash('sha256')
        .update(pixelBytes)
        .digest('hex');

      const result: CryptoLayerResult = {
        layer: 1,
        name: this.layerName,
        success: true,
        processingMs: Date.now() - start,
        data: {
          sha256Hash,
          normalizedHash,
          blake3Hash: null, // reserved for future implementation
        },
      };

      logger.debug('Layer 1 — complete', {
        sha256Hash: sha256Hash.substring(0, 16) + '...',
        normalizedHash: normalizedHash.substring(0, 16) + '...',
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 1 — failed', { error: err });
      return {
        layer: 1,
        name: this.layerName,
        success: false,
        processingMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
        data: {
          sha256Hash: '',
          normalizedHash: '',
          blake3Hash: null,
        },
      };
    }
  }

  /**
   * Verify a probe image against a stored CryptoLayer record.
   *
   * Verification logic (from spec §5.3, step 17):
   *   "If image appears unmodified, SHA-256 is recomputed. Does it match exactly?"
   *
   * We check normalizedHash first (pixel content match) — this is the meaningful
   * check because it ignores metadata differences. Then fall back to sha256Hash
   * for exact file match (stricter).
   *
   * Score:
   *   1.0 — normalizedHash matches (pixel content is identical)
   *   0.5 — normalizedHash differs but sha256Hash matches (impossible in practice,
   *          included for completeness)
   *   0.0 — neither hash matches
   */
  verify(
    probe: CryptoLayerResult['data'],
    stored: { sha256Hash: string; normalizedHash: string }
  ): number {
    // Primary check: pixel content hash (survives EXIF strip)
    if (probe.normalizedHash && probe.normalizedHash === stored.normalizedHash) {
      logger.debug('Layer 1 — verify PASSED (normalizedHash match)');
      return 1.0;
    }

    // Secondary check: exact file hash
    if (probe.sha256Hash && probe.sha256Hash === stored.sha256Hash) {
      logger.debug('Layer 1 — verify PASSED (sha256Hash match)');
      return 1.0;
    }

    logger.debug('Layer 1 — verify FAILED (no hash match)');
    return 0.0;
  }
}
