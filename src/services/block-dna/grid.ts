import { buildPixelCellGrid, extractCellRgb } from '../spatial/pixel-auth/cell-grid';
import type { PixelCellGeom } from '../spatial/pixel-auth/types';

export { buildPixelCellGrid, extractCellRgb };

export function gridShape(width: number, height: number, blockSize: number): { cols: number; rows: number } {
  return {
    cols: Math.ceil(width / blockSize),
    rows: Math.ceil(height / blockSize),
  };
}

export function enumerateBlocks(width: number, height: number, blockSize: number): PixelCellGeom[] {
  return buildPixelCellGrid(width, height, blockSize);
}
