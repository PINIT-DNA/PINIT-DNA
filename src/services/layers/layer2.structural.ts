/**
 * PINIT-DNA — Layer 2: Structural Fingerprint (Edge-Based Signature)
 *
 * From the theoretical spec:
 *   "Every image has a unique structural pattern of edges and boundaries — where
 *    light meets dark, where objects end and backgrounds begin. The system analyses
 *    these edge patterns row by row and creates a signature number. This signature
 *    is then hidden inside the image by making tiny 1-bit changes to pixels that
 *    sit exactly on edges, where the human eye is least sensitive to colour changes."
 *
 * What this layer does:
 *   GENERATE:
 *     1. Convert image to grayscale
 *     2. Apply Sobel edge detection (pure TS, no OpenCV needed)
 *     3. Divide image into 8×8 = 64 zones
 *     4. Compute edge density per zone → 64-bit signature (16 hex chars)
 *     5. Embed signature bits into red channel LSBs at edge pixel positions
 *     6. Return carrier image buffer (visually identical to original)
 *
 *   VERIFY:
 *     Read red channel LSBs at edge pixel positions → reconstruct signature →
 *     compare with stored signature via Hamming distance
 *
 * Survives:  Minor colour changes, brightness adjustments, mild compression.
 *            Confirmed, not assumed — tests/layers/layer2-structural-robustness.test.ts
 *            measures 0.92-1.00 similarity across JPEG q90/q60/q30, brightness,
 *            and saturation changes, all above the 0.75 threshold this layer
 *            is actually gated on (dna.verifier.ts LAYER_THRESHOLDS.structural).
 * Defeated by: Heavy cropping that removes large portions of the image
 *            (confirmed: 0.59 similarity on a real crop, same test file).
 *            Crop/rotation tolerance for duplicate detection is covered
 *            separately by the ORB feature-matching detector at upload time
 *            (duplicate-check.service.ts's _checkOrbNearDuplicate) — this
 *            layer was not extended to handle crop; a second, independent
 *            layer was added instead. See that file's header comment for why.
 */

import sharp from 'sharp';
import path from 'path';
import { ImageInput, StructuralLayerResult, EdgeVector } from '../../types/dna.types';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import { computeStructuralCore } from './layer2.core';

// Sobel kernels, the edge threshold (30) and the 8×8 zone grid (64-bit signature)
// now live with the pixel math in ./layer2.core.ts.

export class StructuralLayer {
  readonly layerNumber = 2 as const;
  readonly layerName = 'structural' as const;

  /**
   * Generate the structural fingerprint and embed it into the image.
   *
   * @param image        - The uploaded image
   * @param dnaRecordId  - Used to name the carrier file on disk
   */
  async generate(image: ImageInput, dnaRecordId?: string): Promise<StructuralLayerResult> {
    const start = Date.now();
    logger.debug('Layer 2 — generating structural fingerprint', { file: image.originalName });

    try {
      // ── Step 1: Decode image to raw RGB pixels ─────────────────────────────
      const { data: rawRgb, info } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;

      // ── Steps 2-6 (grayscale, Sobel, edge zones, 64-bit signature) ─────────
      // The per-pixel JS math is in layer2.core.ts and runs in a worker thread
      // for large images, so it no longer blocks the event loop (every other
      // request used to stall for seconds on a big photo). Same code, so the
      // fingerprint is byte-identical.
      const core = await computeStructuralCore(rawRgb, width, height);
      const edgeVectors: EdgeVector[] = core.edgeVectors;
      const signatureBits = core.signatureBits;
      const edgePixelCount = core.edgePixelCount;
      const edgeSignature64 = this.bitsToHex(signatureBits); // 16 hex chars

      // ── Step 7: Create edge map thumbnail (128×128 grayscale PNG → base64) ─
      const edgeMapBuffer = await this.buildEdgeMapThumbnail(core.normalisedRgb, width, height);
      const edgeMapB64 = edgeMapBuffer.toString('base64');

      // ── Step 8: Embed signature into red channel LSBs at edge positions ───
      // This is the steganographic embedding described in the spec:
      // "making tiny 1-bit changes to pixels that sit exactly on edges"
      let carrierPath: string | null = null;

      if (edgePixelCount >= signatureBits.length && dnaRecordId) {
        const carrierRgb = Buffer.from(rawRgb); // copy

        for (let i = 0; i < signatureBits.length; i++) {
          const pixelIdx = core.firstEdgePixels[i];
          const redByteIdx = pixelIdx * 3; // R channel in RGB buffer
          // Set LSB of red channel to the signature bit
          carrierRgb[redByteIdx] = (carrierRgb[redByteIdx] & 0xfe) | signatureBits[i];
        }

        // Write carrier image to disk (absolute path required on Windows)
        carrierPath = path.resolve(
          config.upload.tempDir,
          `carrier_l2_${dnaRecordId}.png`
        );
        await sharp(carrierRgb, { raw: { width, height, channels: 3 } })
          .png()
          .toFile(carrierPath);

        logger.debug('Layer 2 — signature embedded in carrier image', {
          bitsEmbedded: signatureBits.length,
          edgePixelsAvailable: edgePixelCount,
          carrierPath,
        });
      }

      const result: StructuralLayerResult = {
        layer: 2,
        name: this.layerName,
        success: true,
        processingMs: Date.now() - start,
        data: {
          edgeMapB64,
          edgeVectors,
          edgeSignature64,
          algorithm: 'sobel',
        },
      };

      logger.debug('Layer 2 — complete', {
        edgePixelCount,
        edgeSignature64,
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 2 — failed', { error: err });
      return {
        layer: 2,
        name: this.layerName,
        success: false,
        processingMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
        data: {
          edgeMapB64: '',
          edgeVectors: [],
          edgeSignature64: '',
          algorithm: 'sobel',
        },
      };
    }
  }

  /**
   * Verify a probe image against a stored structural fingerprint.
   *
   * Re-runs Sobel on the probe image, extracts the same 64-bit signature,
   * then computes Hamming distance against the stored signature.
   *
   * From spec §5.3: "System reads red channel LSBs at edge locations.
   * Does the structural signature match?"
   *
   * @returns similarity 0.0–1.0 (1.0 = identical structure)
   */
  async verifyFromImage(
    probeImage: ImageInput,
    stored: { edgeSignature64: string }
  ): Promise<number> {
    const probeResult = await this.generate(probeImage);
    if (!probeResult.success) return 0;
    return this.verify(probeResult.data, stored);
  }

  /**
   * Compare two edge signatures using Hamming distance.
   * similarity = 1 - (hammingDistance / 64)
   */
  verify(
    probe: StructuralLayerResult['data'],
    stored: { edgeSignature64: string }
  ): number {
    if (!probe.edgeSignature64 || !stored.edgeSignature64) return 0;
    if (probe.edgeSignature64.length !== stored.edgeSignature64.length) return 0;

    const hammingDist = this.hexHammingDistance(
      probe.edgeSignature64,
      stored.edgeSignature64
    );

    // 64 total bits — normalize to 0.0–1.0
    const similarity = 1 - hammingDist / 64;

    logger.debug('Layer 2 — verify', {
      probeSignature: probe.edgeSignature64,
      storedSignature: stored.edgeSignature64,
      hammingDist,
      similarity,
    });

    return Math.max(0, similarity);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build a 128×128 edge map thumbnail as a PNG buffer.
   * Bright pixels = strong edges; dark pixels = no edges.
   */
  private async buildEdgeMapThumbnail(
    normalisedRgb: Uint8Array,
    width: number,
    height: number
  ): Promise<Buffer> {
    const THUMB = 128;
    // The gradient -> 0..255 RGB normalisation is done in layer2.core.ts (off the
    // main thread); only the cheap resize + PNG encode remain here.
    return sharp(Buffer.from(normalisedRgb.buffer, normalisedRgb.byteOffset, normalisedRgb.byteLength), {
      raw: { width, height, channels: 3 },
    })
      .resize(THUMB, THUMB)
      .png()
      .toBuffer();
  }

  /** Pack an array of bits (0/1) into a hex string */
  private bitsToHex(bits: number[]): string {
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      const nibble =
        (bits[i] ?? 0) * 8 +
        (bits[i + 1] ?? 0) * 4 +
        (bits[i + 2] ?? 0) * 2 +
        (bits[i + 3] ?? 0);
      hex += nibble.toString(16);
    }
    return hex;
  }

  /** Count differing bits between two hex strings (Hamming distance) */
  private hexHammingDistance(a: string, b: string): number {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      // Count set bits in the 4-bit nibble
      dist += this.popcount4(xor);
    }
    return dist;
  }

  /** Count set bits in a 4-bit value (0–15) */
  private popcount4(n: number): number {
    return ((n >> 3) & 1) + ((n >> 2) & 1) + ((n >> 1) & 1) + (n & 1);
  }
}
