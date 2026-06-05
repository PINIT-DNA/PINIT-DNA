/**
 * PINIT-DNA — Image Diff Service
 *
 * Pixel-level image comparison using Sharp.
 * Detects: crop, resize, compression changes, pixel differences, changed regions.
 * Returns changed region grid for client-side heatmap rendering.
 */

import sharp from 'sharp';
import { logger } from '../../lib/logger';
import type { ImageDiffResult, ChangedRegion } from '../../types/forensic-diff.types';

const IMAGE_TYPES = ['image/jpeg','image/png','image/webp','image/tiff','image/bmp','image/gif'];

export class ImageDiffService {
  async diff(bufferA: Buffer, bufferB: Buffer, mimeType: string): Promise<ImageDiffResult> {
    const unsupported: ImageDiffResult = {
      supported: false, dimensionsMatch: false,
      widthA: 0, heightA: 0, widthB: 0, heightB: 0,
      resizeDetected: false, cropDetected: false, compressionChanged: false,
      pixelDifferencePercent: 0, changedRegions: [], changedRegionPercent: 0,
      gridSize: 8, visualDescription: 'Not an image file', heatmapAvailable: false,
    };

    if (!IMAGE_TYPES.includes(mimeType)) return unsupported;

    try {
      // ── Load both images ────────────────────────────────────────────────────
      const [metaA, metaB] = await Promise.all([
        sharp(bufferA).metadata(),
        sharp(bufferB).metadata(),
      ]);

      const widthA  = metaA.width  ?? 0;
      const heightA = metaA.height ?? 0;
      const widthB  = metaB.width  ?? 0;
      const heightB = metaB.height ?? 0;

      const dimensionsMatch = widthA === widthB && heightA === heightB;
      const resizeDetected  = !dimensionsMatch;

      // Crop detection: same aspect ratio but different size
      const ratioA = widthA > 0 ? heightA / widthA : 0;
      const ratioB = widthB > 0 ? heightB / widthB : 0;
      const cropDetected = resizeDetected && Math.abs(ratioA - ratioB) > 0.05;

      // Compression detection: same dimensions but significant size difference
      const compressionChanged = dimensionsMatch && (
        Math.abs(bufferA.length - bufferB.length) / Math.max(bufferA.length, 1) > 0.10
      );

      // ── Resize both to comparison size for pixel diff ────────────────────
      const COMP_W = 256;
      const COMP_H = 256;
      const GRID   = 8;   // 8×8 grid = 64 cells

      const [rawA, rawB] = await Promise.all([
        sharp(bufferA).resize(COMP_W, COMP_H, { fit: 'fill' }).raw().toBuffer(),
        sharp(bufferB).resize(COMP_W, COMP_H, { fit: 'fill' }).raw().toBuffer(),
      ]);

      // ── Pixel difference analysis ────────────────────────────────────────
      const channels = 3; // RGB
      let differentPixels = 0;
      const totalPixels = COMP_W * COMP_H;

      // Grid-based changed regions
      const cellW = COMP_W / GRID;
      const cellH = COMP_H / GRID;
      const gridDiff = Array.from({ length: GRID }, () => new Array(GRID).fill(0));

      for (let y = 0; y < COMP_H; y++) {
        for (let x = 0; x < COMP_W; x++) {
          const idx = (y * COMP_W + x) * channels;
          const rDiff = Math.abs(rawA[idx]   - rawB[idx]);
          const gDiff = Math.abs(rawA[idx+1] - rawB[idx+1]);
          const bDiff = Math.abs(rawA[idx+2] - rawB[idx+2]);
          const pixelDiff = (rDiff + gDiff + bDiff) / (3 * 255);

          if (pixelDiff > 0.05) {
            differentPixels++;
            const row = Math.min(Math.floor(y / cellH), GRID - 1);
            const col = Math.min(Math.floor(x / cellW), GRID - 1);
            gridDiff[row][col] += pixelDiff;
          }
        }
      }

      const pixelDifferencePercent = Math.round((differentPixels / totalPixels) * 10000) / 100;
      const cellArea = cellW * cellH;

      // Convert grid to changed regions
      const changedRegions: ChangedRegion[] = [];
      let changedCells = 0;

      for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
          const intensity = Math.min(gridDiff[row][col] / cellArea, 1.0);
          if (intensity > 0.02) {
            changedCells++;
            // Scale coordinates back to original image size
            const scaleX = widthA / COMP_W;
            const scaleY = heightA / COMP_H;
            changedRegions.push({
              x:               Math.round(col * cellW * scaleX),
              y:               Math.round(row * cellH * scaleY),
              width:           Math.round(cellW * scaleX),
              height:          Math.round(cellH * scaleY),
              changeIntensity: Math.round(intensity * 1000) / 1000,
              gridRow:         row,
              gridCol:         col,
            });
          }
        }
      }

      const changedRegionPercent = Math.round((changedCells / (GRID * GRID)) * 10000) / 100;

      // ── Visual description ────────────────────────────────────────────────
      let desc = '';
      if (pixelDifferencePercent < 0.1)  desc = 'Images are virtually identical — no visible differences';
      else if (pixelDifferencePercent < 2)  desc = `Very minor differences detected (${pixelDifferencePercent}% pixels changed)`;
      else if (pixelDifferencePercent < 10) desc = `Moderate differences (${pixelDifferencePercent}% pixels changed, ${changedCells} of ${GRID*GRID} regions affected)`;
      else if (pixelDifferencePercent < 30) desc = `Significant differences (${pixelDifferencePercent}% pixels changed, ${changedRegionPercent}% of image area)`;
      else                                   desc = `Major differences (${pixelDifferencePercent}% pixels changed across entire image)`;

      if (resizeDetected)     desc += `. Dimensions changed: ${widthA}×${heightA} → ${widthB}×${heightB}`;
      if (cropDetected)       desc += '. Aspect ratio changed — possible crop operation';
      if (compressionChanged) desc += `. Compression changed (${Math.round(bufferA.length/1024)}KB → ${Math.round(bufferB.length/1024)}KB)`;

      // Sort regions by intensity (most changed first)
      changedRegions.sort((a, b) => b.changeIntensity - a.changeIntensity);

      return {
        supported:              true,
        dimensionsMatch,
        widthA, heightA, widthB, heightB,
        resizeDetected,
        cropDetected,
        compressionChanged,
        pixelDifferencePercent,
        changedRegions:         changedRegions.slice(0, 32), // top 32 regions
        changedRegionPercent,
        gridSize:               GRID,
        visualDescription:      desc,
        heatmapAvailable:       changedRegions.length > 0,
      };
    } catch (err) {
      logger.error('Image diff failed', { error: String(err) });
      return { ...unsupported, supported: false, error: String(err) } as ImageDiffResult;
    }
  }
}
