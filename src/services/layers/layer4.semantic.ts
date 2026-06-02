/**
 * PINIT-DNA — Layer 4: Semantic Color Fingerprint (RGB Histogram Descriptor)
 *
 * From the theoretical spec:
 *   "The system divides all possible colours into 8 groups (bins) and counts
 *    how many pixels fall into each group for the red, green, and blue channels
 *    separately. This creates a compact 24-number description of the image's
 *    colour personality — whether it is warm or cool, bright or dark, colourful
 *    or muted."
 *
 * What this layer computes:
 *   - 256-bin histograms for R, G, B (stored in DB for detailed analysis)
 *   - 8-bin compressed histograms for R, G, B (spec-defined fingerprint)
 *   - HSV hue and saturation histograms (additional discriminators)
 *   - Top 5 dominant colours (quantized colour counting)
 *   - Compact 12-hex-char colour fingerprint from the 8-bin summaries
 *
 * Survives:  Pixel-level noise, minor colour shifts, format conversion,
 *            light JPEG compression.
 * Defeated by: Complete replacement of image content, radical colour inversions
 *              (e.g., negative filter).
 *
 * Verification: Histogram intersection similarity on 8-bin compressed histograms.
 *   intersection(h1, h2) = sum(min(h1[i], h2[i])) / sum(h1[i])
 *   Final score = average across R, G, B channels.
 */

import sharp from 'sharp';
import { ImageInput, SemanticLayerResult, DominantColor } from '../../types/dna.types';
import { logger } from '../../lib/logger';

// Number of bins as specified in the PDF ("8 groups")
const SPEC_BINS = 8;
// Full histogram resolution stored in DB
const FULL_BINS = 256;
// Bin width: 256 / 8 = 32 values per bin
const BIN_WIDTH = FULL_BINS / SPEC_BINS;

export class SemanticLayer {
  readonly layerNumber = 4 as const;
  readonly layerName = 'semantic' as const;

  async generate(image: ImageInput): Promise<SemanticLayerResult> {
    const start = Date.now();
    logger.debug('Layer 4 — generating semantic color fingerprint', {
      file: image.originalName,
    });

    try {
      // ── Step 1: Extract raw RGB pixels ────────────────────────────────────
      const { data: raw, info } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const totalPixels = info.width * info.height;

      // ── Step 2: Build 256-bin RGB histograms ──────────────────────────────
      const histR = new Array<number>(FULL_BINS).fill(0);
      const histG = new Array<number>(FULL_BINS).fill(0);
      const histB = new Array<number>(FULL_BINS).fill(0);

      // ── Step 3: Build HSV histograms + dominant colour tracking ───────────
      const histH = new Array<number>(360).fill(0);
      const histS = new Array<number>(100).fill(0);

      // Quantized colour map for dominant colour extraction (4 bits per channel)
      const colorMap = new Map<number, number>();

      for (let i = 0; i < raw.length; i += 3) {
        const r = raw[i];
        const g = raw[i + 1];
        const b = raw[i + 2];

        histR[r]++;
        histG[g]++;
        histB[b]++;

        // RGB → HSV conversion
        const { h, s } = this.rgbToHsv(r, g, b);
        histH[Math.floor(h)]++;
        histS[Math.min(99, Math.floor(s))]++;

        // Quantize to 4-bit colour (16 levels per channel) for dominant colours
        const quantKey =
          ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        colorMap.set(quantKey, (colorMap.get(quantKey) ?? 0) + 1);
      }

      // ── Step 4: Compress to 8-bin histograms (per spec) ───────────────────
      // Each bin sums 32 consecutive full-resolution bins
      const hist8R = this.compressTo8Bins(histR);
      const hist8G = this.compressTo8Bins(histG);
      const hist8B = this.compressTo8Bins(histB);

      // ── Step 5: Top 5 dominant colours ────────────────────────────────────
      const dominantColors = this.extractDominantColors(colorMap, totalPixels);

      // ── Step 6: Compact colour fingerprint (12 hex chars = 6 bytes) ───────
      // 2 bytes per channel describing the 8-bin distribution:
      //   Byte 1: (dominant_bin << 5) | (second_bin << 2) | spread_flag
      //   Byte 2: normalised dominant bin fraction (0–255)
      const colorFingerprint =
        this.channelFingerprint(hist8R) +
        this.channelFingerprint(hist8G) +
        this.channelFingerprint(hist8B);

      const result: SemanticLayerResult = {
        layer: 4,
        name: this.layerName,
        success: true,
        processingMs: Date.now() - start,
        data: {
          histogramR: histR,
          histogramG: histG,
          histogramB: histB,
          histogramH: histH,
          histogramS: histS,
          dominantColors,
          colorFingerprint,
        },
      };

      logger.debug('Layer 4 — complete', {
        totalPixels,
        dominantColorCount: dominantColors.length,
        colorFingerprint,
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 4 — failed', { error: err });
      return {
        layer: 4,
        name: this.layerName,
        success: false,
        processingMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
        data: {
          histogramR: [],
          histogramG: [],
          histogramB: [],
          histogramH: [],
          histogramS: [],
          dominantColors: [],
          colorFingerprint: '',
        },
      };
    }
  }

  /**
   * Verify semantic colour fingerprint using histogram intersection.
   *
   * From spec §5.3: "System computes the colour histogram descriptor.
   * Does it match the original descriptor?"
   *
   * Histogram intersection: sum(min(h1[i], h2[i])) / sum(h1[i])
   * Average across R, G, B channels.
   *
   * Uses 8-bin compressed histograms (spec definition), derived from the
   * stored full 256-bin histograms.
   *
   * @returns similarity 0.0–1.0
   */
  verify(
    probe: SemanticLayerResult['data'],
    stored: {
      histogramR: number[];
      histogramG: number[];
      histogramB: number[];
      colorFingerprint: string;
    }
  ): number {
    if (
      !probe.histogramR?.length ||
      !stored.histogramR?.length
    ) return 0;

    // Compress both to 8 bins for comparison
    const probeR = this.compressTo8Bins(probe.histogramR);
    const probeG = this.compressTo8Bins(probe.histogramG);
    const probeB = this.compressTo8Bins(probe.histogramB);

    const storedR = this.compressTo8Bins(stored.histogramR);
    const storedG = this.compressTo8Bins(stored.histogramG);
    const storedB = this.compressTo8Bins(stored.histogramB);

    const rScore = this.histogramIntersection(probeR, storedR);
    const gScore = this.histogramIntersection(probeG, storedG);
    const bScore = this.histogramIntersection(probeB, storedB);

    const score = (rScore + gScore + bScore) / 3;

    logger.debug('Layer 4 — verify', {
      rScore: rScore.toFixed(3),
      gScore: gScore.toFixed(3),
      bScore: bScore.toFixed(3),
      score: score.toFixed(3),
    });

    return score;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Compress a 256-bin histogram down to 8 bins by summing groups of 32.
   * This is the spec's "8 groups" representation.
   */
  private compressTo8Bins(hist256: number[]): number[] {
    const bins = new Array<number>(SPEC_BINS).fill(0);
    for (let i = 0; i < FULL_BINS; i++) {
      bins[Math.floor(i / BIN_WIDTH)] += hist256[i] ?? 0;
    }
    return bins;
  }

  /**
   * Histogram intersection similarity between two normalised histograms.
   * Returns 0.0–1.0 where 1.0 = identical distributions.
   */
  private histogramIntersection(h1: number[], h2: number[]): number {
    const total1 = h1.reduce((a, b) => a + b, 0);
    if (total1 === 0) return 0;
    let intersection = 0;
    for (let i = 0; i < h1.length; i++) {
      intersection += Math.min(h1[i], h2[i] ?? 0);
    }
    return intersection / total1;
  }

  /**
   * Build a 4-hex-char (2-byte) summary of a single channel's 8-bin histogram.
   * Used to form the 12-char colorFingerprint (3 channels × 4 chars).
   *
   *   Byte 1: (dominant_bin_index << 5) | (second_bin_index << 2) | spread
   *   Byte 2: normalised dominant bin fraction 0–255
   */
  private channelFingerprint(hist8: number[]): string {
    const total = hist8.reduce((a, b) => a + b, 0);
    if (total === 0) return '0000';

    // Sort bin indices by count descending
    const sorted = hist8
      .map((count, idx) => ({ idx, count }))
      .sort((a, b) => b.count - a.count);

    const domBin = sorted[0].idx;       // 0–7 (3 bits)
    const secBin = sorted[1]?.idx ?? 0; // 0–7 (3 bits)

    // Spread: 1 if the top two bins together hold < 70% of pixels (spread out)
    const topTwoFraction = (sorted[0].count + (sorted[1]?.count ?? 0)) / total;
    const spread = topTwoFraction < 0.7 ? 1 : 0;

    const byte1 = ((domBin & 0x7) << 5) | ((secBin & 0x7) << 2) | (spread & 0x3);
    const byte2 = Math.round((sorted[0].count / total) * 255);

    return byte1.toString(16).padStart(2, '0') + byte2.toString(16).padStart(2, '0');
  }

  /**
   * Extract top 5 dominant colours from a quantized colour frequency map.
   * Colour map keys are 12-bit values: (r>>4)<<8 | (g>>4)<<4 | (b>>4)
   */
  private extractDominantColors(
    colorMap: Map<number, number>,
    totalPixels: number
  ): DominantColor[] {
    return Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const r = ((key >> 8) & 0xf) * 17; // 4-bit → 8-bit: multiply by 17
        const g = ((key >> 4) & 0xf) * 17;
        const b = (key & 0xf) * 17;
        return {
          hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
          coverage: count / totalPixels,
        };
      });
  }

  /**
   * Convert RGB (0–255 each) to HSV.
   * Returns h in 0–359, s in 0–99, v in 0–99.
   */
  private rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const rN = r / 255;
    const gN = g / 255;
    const bN = b / 255;

    const max = Math.max(rN, gN, bN);
    const min = Math.min(rN, gN, bN);
    const delta = max - min;

    let h = 0;
    if (delta > 0) {
      if (max === rN) h = 60 * (((gN - bN) / delta) % 6);
      else if (max === gN) h = 60 * ((bN - rN) / delta + 2);
      else h = 60 * ((rN - gN) / delta + 4);
      if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : delta / max;
    const v = max;

    return {
      h: Math.floor(h) % 360,
      s: Math.floor(s * 99),
      v: Math.floor(v * 99),
    };
  }
}
