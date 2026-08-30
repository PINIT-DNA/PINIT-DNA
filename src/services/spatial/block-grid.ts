/**
 * Spatial Auth Phase 1 — configurable block grid
 *
 * Edge blocks record actual width/height when image dims are not
 * exact multiples of the block scale.
 */

import type { SpatialBlockGeom } from './types';

export function buildBlockGrid(
  width: number,
  height: number,
  scale: number,
): SpatialBlockGeom[] {
  if (width < 1 || height < 1) {
    throw new Error(`Invalid image dimensions: ${width}x${height}`);
  }
  if (scale < 1) {
    throw new Error(`Invalid block scale: ${scale}`);
  }

  const cols = Math.ceil(width / scale);
  const rows = Math.ceil(height / scale);
  const blocks: SpatialBlockGeom[] = [];

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x = bx * scale;
      const y = by * scale;
      const w = Math.min(scale, width - x);
      const h = Math.min(scale, height - y);
      const blockId = by * cols + bx;
      blocks.push({ blockId, scale, x, y, width: w, height: h });
    }
  }

  return blocks;
}

/** Extract RGB (3-channel) pixels for a block rectangle from a full-image RGB buffer */
export function extractBlockRgb(
  rgb: Buffer,
  imageWidth: number,
  imageHeight: number,
  block: Pick<SpatialBlockGeom, 'x' | 'y' | 'width' | 'height'>,
): Buffer {
  const { x, y, width: bw, height: bh } = block;
  if (x < 0 || y < 0 || x + bw > imageWidth || y + bh > imageHeight) {
    throw new Error(
      `Block out of bounds: (${x},${y},${bw},${bh}) vs ${imageWidth}x${imageHeight}`,
    );
  }
  const out = Buffer.alloc(bw * bh * 3);
  for (let row = 0; row < bh; row++) {
    const srcOff = ((y + row) * imageWidth + x) * 3;
    const dstOff = row * bw * 3;
    rgb.copy(out, dstOff, srcOff, srcOff + bw * 3);
  }
  return out;
}
