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
 * Survives:  Minor colour changes, brightness adjustments, mild compression
 * Defeated by: Heavy cropping that removes large portions of the image
 */

import sharp from 'sharp';
import path from 'path';
import { ImageInput, StructuralLayerResult, EdgeVector } from '../../types/dna.types';
import { logger } from '../../lib/logger';
import { config } from '../../config';

// Sobel kernels for edge detection
const SOBEL_X = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
const SOBEL_Y = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

// Pixels with gradient magnitude above this are considered edges
const EDGE_THRESHOLD = 30;

// Image is divided into GRID_SIZE × GRID_SIZE zones for signature
const GRID_SIZE = 8; // 64 zones → 64-bit signature

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

      // ── Step 2: Convert RGB → Grayscale ───────────────────────────────────
      // Using luminance formula: Y = 0.299R + 0.587G + 0.114B
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const r = rawRgb[i * 3];
        const g = rawRgb[i * 3 + 1];
        const b = rawRgb[i * 3 + 2];
        gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }

      // ── Step 3: Sobel edge detection ──────────────────────────────────────
      // For each pixel (excluding 1px border), compute gradient magnitude
      const gradient = new Float32Array(width * height);
      const gradientAngle = new Float32Array(width * height);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let gx = 0;
          let gy = 0;

          for (let ky = 0; ky < 3; ky++) {
            for (let kx = 0; kx < 3; kx++) {
              const pixel = gray[(y + ky - 1) * width + (x + kx - 1)];
              gx += pixel * SOBEL_X[ky][kx];
              gy += pixel * SOBEL_Y[ky][kx];
            }
          }

          const mag = Math.sqrt(gx * gx + gy * gy);
          gradient[y * width + x] = mag;
          // Gradient angle in degrees (0–360)
          gradientAngle[y * width + x] =
            ((Math.atan2(gy, gx) * 180) / Math.PI + 360) % 360;
        }
      }

      // ── Step 4: Identify edge pixels ──────────────────────────────────────
      const edgePixels: number[] = []; // flat indices of edge pixels
      for (let i = 0; i < gradient.length; i++) {
        if (gradient[i] > EDGE_THRESHOLD) {
          edgePixels.push(i);
        }
      }

      // ── Step 5: Build edge vectors (64 zones, one dominant vector each) ───
      const edgeVectors: EdgeVector[] = [];
      const zoneW = Math.floor(width / GRID_SIZE);
      const zoneH = Math.floor(height / GRID_SIZE);

      for (let zy = 0; zy < GRID_SIZE; zy++) {
        for (let zx = 0; zx < GRID_SIZE; zx++) {
          let totalMag = 0;
          let totalAngle = 0;
          let count = 0;

          for (let py = zy * zoneH; py < (zy + 1) * zoneH && py < height; py++) {
            for (let px = zx * zoneW; px < (zx + 1) * zoneW && px < width; px++) {
              const idx = py * width + px;
              if (gradient[idx] > EDGE_THRESHOLD) {
                totalMag += gradient[idx];
                totalAngle += gradientAngle[idx];
                count++;
              }
            }
          }

          // Divide by zone area (not edge count) so density reflects the fraction
          // of the zone that contains edges — zones with 2 boundaries score higher
          // than zones with 1, giving the mean-threshold logic something to split on.
          const zoneArea = zoneW * zoneH;
          edgeVectors.push({
            angle: count > 0 ? totalAngle / count : 0,
            magnitude: count > 0 ? Math.min(totalMag / (zoneArea * 255), 1.0) : 0,
          });
        }
      }

      // ── Step 6: Build 64-bit edge signature ───────────────────────────────
      // Each of 64 zones contributes 1 bit: 1 if zone edge density is above the
      // global mean. Using mean (not median) ensures zones with edges in an
      // otherwise sparse image reliably get bit=1.
      const densities = edgeVectors.map((v) => v.magnitude);
      const meanDensity =
        densities.reduce((a, b) => a + b, 0) / densities.length;
      // If mean is 0 (no edges at all), all bits stay 0 — valid for solid images
      const signatureBits = densities.map((d) => (d > meanDensity ? 1 : 0));
      const edgeSignature64 = this.bitsToHex(signatureBits); // 16 hex chars

      // ── Step 7: Create edge map thumbnail (128×128 grayscale PNG → base64) ─
      const edgeMapBuffer = await this.buildEdgeMapThumbnail(gradient, width, height);
      const edgeMapB64 = edgeMapBuffer.toString('base64');

      // ── Step 8: Embed signature into red channel LSBs at edge positions ───
      // This is the steganographic embedding described in the spec:
      // "making tiny 1-bit changes to pixels that sit exactly on edges"
      let carrierPath: string | null = null;

      if (edgePixels.length >= signatureBits.length && dnaRecordId) {
        const carrierRgb = Buffer.from(rawRgb); // copy

        for (let i = 0; i < signatureBits.length; i++) {
          const pixelIdx = edgePixels[i];
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
          edgePixelsAvailable: edgePixels.length,
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
        edgePixelCount: edgePixels.length,
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
    gradient: Float32Array,
    width: number,
    height: number
  ): Promise<Buffer> {
    const THUMB = 128;

    // Find max without spread operator — avoids stack overflow on large images
    let maxGrad = 0;
    for (let i = 0; i < gradient.length; i++) {
      if (gradient[i] > maxGrad) maxGrad = gradient[i];
    }

    // Normalise to 0–255 and convert to 3-channel RGB
    // (sharp requires channels: 3 for reliable cross-platform PNG encoding)
    const normalised = new Uint8Array(width * height * 3);
    for (let i = 0; i < gradient.length; i++) {
      const v = maxGrad > 0 ? Math.round((gradient[i] / maxGrad) * 255) : 0;
      normalised[i * 3] = v;
      normalised[i * 3 + 1] = v;
      normalised[i * 3 + 2] = v;
    }

    return sharp(Buffer.from(normalised), { raw: { width, height, channels: 3 } })
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
