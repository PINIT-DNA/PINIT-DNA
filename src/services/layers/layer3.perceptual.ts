/**
 * PINIT-DNA — Layer 3: Perceptual Visual Hash (pHash / aHash / dHash)
 *
 * From the theoretical spec:
 *   "The system shrinks the image down to a tiny 32×32 pixel version and converts
 *    it to greyscale. It then applies the Discrete Cosine Transform — the same
 *    technique used in JPEG compression — which identifies the most visually
 *    important patterns. From these patterns it creates a 64-bit code. Two visually
 *    similar images produce similar codes; two completely different images produce
 *    different codes."
 *
 * Three hashes computed:
 *
 *   pHash64  — DCT-based (primary). Resize 32×32 → DCT → top-left 8×8 coefficients
 *              → mean threshold → 64 bits → 16 hex chars.
 *              Tolerant of: JPEG re-compression, resizing, minor brightness changes.
 *
 *   aHash64  — Average hash (fast pre-filter). Resize 8×8 → mean threshold.
 *              Very fast but less precise. Used to quickly discard non-matches.
 *
 *   dHash64  — Difference hash. Resize 9×8 → compare adjacent horizontal pixels.
 *              Robust to brightness/contrast shifts.
 *
 *   pHash256 — Extended DCT hash (16×16 coefficients → 256 bits → 64 hex chars).
 *              Higher precision for near-duplicate detection.
 *
 * Survives:  JPEG compression, resizing, minor brightness/contrast changes,
 *            format conversion (PNG → JPEG → PNG).
 * Defeated by: Heavy artistic filters, complete redrawing of image content.
 *
 * Verification threshold: Hamming distance ≤ 10/64 bits = "similar image"
 */

import sharp from 'sharp';
import { ImageInput, PerceptualLayerResult } from '../../types/dna.types';
import { logger } from '../../lib/logger';

export class PerceptualLayer {
  readonly layerNumber = 3 as const;
  readonly layerName = 'perceptual' as const;

  // Hamming distance thresholds — images within threshold are considered "matching"
  static readonly PHASH64_MATCH_THRESHOLD = 10;   // out of 64 bits
  static readonly PHASH256_MATCH_THRESHOLD = 40;  // out of 256 bits
  static readonly AHASH_MATCH_THRESHOLD = 10;
  static readonly DHASH_MATCH_THRESHOLD = 10;

  async generate(image: ImageInput): Promise<PerceptualLayerResult> {
    const start = Date.now();
    logger.debug('Layer 3 — generating perceptual hash', { file: image.originalName });

    try {
      const [pHash64, pHash256, aHash64, dHash64] = await Promise.all([
        this.computePHash64(image.buffer),
        this.computePHash256(image.buffer),
        this.computeAHash64(image.buffer),
        this.computeDHash64(image.buffer),
      ]);

      const result: PerceptualLayerResult = {
        layer: 3,
        name: this.layerName,
        success: true,
        processingMs: Date.now() - start,
        data: { pHash64, pHash256, aHash64, dHash64 },
      };

      logger.debug('Layer 3 — complete', {
        pHash64,
        aHash64,
        dHash64,
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 3 — failed', { error: err });
      return {
        layer: 3,
        name: this.layerName,
        success: false,
        processingMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
        data: { pHash64: '', pHash256: '', aHash64: '', dHash64: '' },
      };
    }
  }

  /**
   * Compute all perceptual hashes for a raw buffer (used by duplicate detection).
   */
  async computeFingerprints(buffer: Buffer): Promise<PerceptualLayerResult['data']> {
    const [pHash64, pHash256, aHash64, dHash64] = await Promise.all([
      this.computePHash64(buffer),
      this.computePHash256(buffer),
      this.computeAHash64(buffer),
      this.computeDHash64(buffer),
    ]);
    return { pHash64, pHash256, aHash64, dHash64 };
  }

  /**
   * Verify a probe image against stored perceptual hashes.
   *
   * From spec §5.3: "System computes the perceptual hash of the suspected image.
   * Does it match within an acceptable similarity threshold?"
   *
   * Weighted combination:
   *   pHash64  60% — most discriminative
   *   aHash64  20%
   *   dHash64  20%
   *
   * @returns similarity 0.0–1.0
   */
  verify(
    probe: PerceptualLayerResult['data'],
    stored: { pHash64: string; aHash64: string; dHash64: string }
  ): number {
    if (!probe.pHash64 || !stored.pHash64) return 0;

    const pScore = this.hammingSimilarity(probe.pHash64, stored.pHash64, 64);
    const aScore = this.hammingSimilarity(probe.aHash64, stored.aHash64, 64);
    const dScore = this.hammingSimilarity(probe.dHash64, stored.dHash64, 64);

    const weighted = pScore * 0.6 + aScore * 0.2 + dScore * 0.2;

    logger.debug('Layer 3 — verify', {
      pScore: pScore.toFixed(3),
      aScore: aScore.toFixed(3),
      dScore: dScore.toFixed(3),
      weighted: weighted.toFixed(3),
    });

    return weighted;
  }

  // ── pHash64 — DCT-based perceptual hash ───────────────────────────────────

  /**
   * pHash64 algorithm (per the spec):
   * 1. Resize image to 32×32 greyscale
   * 2. Apply 2D DCT
   * 3. Take top-left 8×8 DCT coefficients (low frequencies), skip DC at [0,0]
   * 4. Compute mean of the 63 remaining AC coefficients
   * 5. Each bit = coefficient > mean ? 1 : 0
   * 6. Pack 64 bits (using all 8×8 including DC for alignment) → 16 hex chars
   */
  private async computePHash64(buffer: Buffer): Promise<string> {
    const SIZE = 32;
    const HASH_SIZE = 8;

    const pixels = await this.toGrayscalePixels(buffer, SIZE, SIZE);
    const dct = this.dct2d(pixels, SIZE);

    // Extract top-left 8×8 block of DCT coefficients
    const block: number[] = [];
    for (let y = 0; y < HASH_SIZE; y++) {
      for (let x = 0; x < HASH_SIZE; x++) {
        block.push(dct[y * SIZE + x]);
      }
    }

    // Mean of AC coefficients (exclude DC at index 0)
    const acCoeffs = block.slice(1);
    const mean = acCoeffs.reduce((a, b) => a + b, 0) / acCoeffs.length;

    // Each bit: coefficient > mean → 1, else 0
    const bits = block.map((v) => (v > mean ? 1 : 0));
    return this.bitsToHex(bits);
  }

  /**
   * pHash256: same algorithm on 64×64 → 16×16 DCT block → 256 bits → 64 hex chars
   */
  private async computePHash256(buffer: Buffer): Promise<string> {
    const SIZE = 64;
    const HASH_SIZE = 16;

    const pixels = await this.toGrayscalePixels(buffer, SIZE, SIZE);
    const dct = this.dct2d(pixels, SIZE);

    const block: number[] = [];
    for (let y = 0; y < HASH_SIZE; y++) {
      for (let x = 0; x < HASH_SIZE; x++) {
        block.push(dct[y * SIZE + x]);
      }
    }

    const acCoeffs = block.slice(1);
    const mean = acCoeffs.reduce((a, b) => a + b, 0) / acCoeffs.length;
    const bits = block.map((v) => (v > mean ? 1 : 0));
    return this.bitsToHex(bits);
  }

  // ── aHash64 — Average hash ─────────────────────────────────────────────────

  /**
   * aHash64:
   * 1. Resize to 8×8 greyscale → 64 pixel values
   * 2. Compute mean of all 64 pixels
   * 3. Each bit = pixel > mean ? 1 : 0
   * 4. Pack 64 bits → 16 hex chars
   */
  private async computeAHash64(buffer: Buffer): Promise<string> {
    const pixels = await this.toGrayscalePixels(buffer, 8, 8);
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const bits = pixels.map((p) => (p > mean ? 1 : 0));
    return this.bitsToHex(bits);
  }

  // ── dHash64 — Difference hash ──────────────────────────────────────────────

  /**
   * dHash64:
   * 1. Resize to 9×8 greyscale (9 wide, 8 tall) → 72 pixel values
   * 2. For each of 8 rows, compare 8 adjacent pixel pairs left-to-right
   * 3. Each bit = pixel[x] > pixel[x+1] ? 1 : 0
   * 4. Result: 8 rows × 8 comparisons = 64 bits → 16 hex chars
   */
  private async computeDHash64(buffer: Buffer): Promise<string> {
    const pixels = await this.toGrayscalePixels(buffer, 9, 8);
    const bits: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        bits.push(pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0);
      }
    }
    return this.bitsToHex(bits);
  }

  // ── 2D DCT (Discrete Cosine Transform) ────────────────────────────────────

  /**
   * 2D DCT-II computed as two passes of 1D DCT (rows then columns).
   * Standard formula: DCT-II used in JPEG compression.
   */
  private dct2d(pixels: number[], size: number): number[] {
    // Row-wise 1D DCT
    const rowDct = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      const row = Array.from({ length: size }, (_, x) => pixels[y * size + x]);
      const dctRow = this.dct1d(row);
      for (let x = 0; x < size; x++) {
        rowDct[y * size + x] = dctRow[x];
      }
    }

    // Column-wise 1D DCT on the row-transformed data
    const result = new Float64Array(size * size);
    for (let x = 0; x < size; x++) {
      const col = Array.from({ length: size }, (_, y) => rowDct[y * size + x]);
      const dctCol = this.dct1d(col);
      for (let y = 0; y < size; y++) {
        result[y * size + x] = dctCol[y];
      }
    }

    return Array.from(result);
  }

  /**
   * 1D DCT-II.
   * F(k) = sum_{n=0}^{N-1} f(n) * cos(PI/N * (n + 0.5) * k)
   */
  private dct1d(signal: number[]): number[] {
    const N = signal.length;
    const result = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
      }
      result[k] = sum;
    }
    return Array.from(result);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Resize image to w×h and extract greyscale pixel array */
  private async toGrayscalePixels(
    buffer: Buffer,
    w: number,
    h: number
  ): Promise<number[]> {
    const raw = await sharp(buffer)
      .resize(w, h, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    return Array.from(raw);
  }

  /** Pack array of bits (0/1) into a lowercase hex string */
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

  /**
   * Compute normalised Hamming similarity between two hex strings.
   * similarity = 1 - (hammingDistance / totalBits)
   */
  private hammingSimilarity(a: string, b: string, totalBits: number): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      dist += this.popcount4(xor);
    }
    return Math.max(0, 1 - dist / totalBits);
  }

  /** Count set bits in a 4-bit value (0–15) */
  private popcount4(n: number): number {
    return ((n >> 3) & 1) + ((n >> 2) & 1) + ((n >> 1) & 1) + (n & 1);
  }
}
