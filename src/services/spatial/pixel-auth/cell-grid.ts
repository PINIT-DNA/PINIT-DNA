/**
 * Phase 3A — 8×8 cell grid (edge cells store actual w/h)
 */

import type { PixelCellGeom } from './types';

export function buildPixelCellGrid(
  width: number,
  height: number,
  cellSize: number,
): PixelCellGeom[] {
  if (width < 1 || height < 1) throw new Error(`Invalid dims ${width}x${height}`);
  if (cellSize < 1) throw new Error(`Invalid cellSize ${cellSize}`);

  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells: PixelCellGeom[] = [];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cellSize;
      const y = cy * cellSize;
      const w = Math.min(cellSize, width - x);
      const h = Math.min(cellSize, height - y);
      const cellId = cy * cols + cx;
      cells.push({ cellId, cellX: cx, cellY: cy, x, y, width: w, height: h });
    }
  }
  return cells;
}

export function extractCellRgb(
  rgb: Buffer,
  imageWidth: number,
  imageHeight: number,
  cell: Pick<PixelCellGeom, 'x' | 'y' | 'width' | 'height'>,
): Buffer {
  const { x, y, width: cw, height: ch } = cell;
  if (x < 0 || y < 0 || x + cw > imageWidth || y + ch > imageHeight) {
    throw new Error(`Cell OOB (${x},${y},${cw},${ch}) vs ${imageWidth}x${imageHeight}`);
  }
  const out = Buffer.alloc(cw * ch * 3);
  for (let row = 0; row < ch; row++) {
    const srcOff = ((y + row) * imageWidth + x) * 3;
    const dstOff = row * cw * 3;
    rgb.copy(out, dstOff, srcOff, srcOff + cw * 3);
  }
  return out;
}
