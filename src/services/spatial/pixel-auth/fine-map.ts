/**
 * Phase 3A — fine 8×8 tamper map from cell HMAC results (derived evidence)
 */

import { buildPixelCellGrid } from './cell-grid';
import type {
  FineBlockLocalization,
  FineCellEntry,
  FineCellStatus,
  FineTamperRegion,
  FineLocalizationStats,
} from './types';

export function buildFineCellMap(params: {
  imageWidth: number;
  imageHeight: number;
  cellSize: number;
  hmacPassedByCellId: Map<number, boolean>;
}): FineCellEntry[] {
  const grid = buildPixelCellGrid(params.imageWidth, params.imageHeight, params.cellSize);
  return grid.map((g) => {
    let status: FineCellStatus = 'UNKNOWN';
    if (params.hmacPassedByCellId.has(g.cellId)) {
      status = params.hmacPassedByCellId.get(g.cellId) ? 'AUTHENTIC' : 'TAMPERED';
    }
    return {
      cellId: g.cellId,
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      status,
    };
  });
}

export function computeFineStats(
  cells: FineCellEntry[],
  imageWidth: number,
  imageHeight: number,
  cellSize: number,
): FineLocalizationStats {
  let cellsPassed = 0;
  let cellsFailed = 0;
  let cellsUnknown = 0;
  let tamperedAreaPixels = 0;
  for (const c of cells) {
    if (c.status === 'AUTHENTIC') cellsPassed += 1;
    else if (c.status === 'TAMPERED') {
      cellsFailed += 1;
      tamperedAreaPixels += c.width * c.height;
    } else cellsUnknown += 1;
  }
  const cellsChecked = cells.length;
  const area = Math.max(1, imageWidth * imageHeight);
  return {
    cellsChecked,
    cellsPassed,
    cellsFailed,
    cellsUnknown,
    exactPassRate: cellsChecked === 0 ? 0 : cellsPassed / cellsChecked,
    localizationUnitPx: cellSize,
    tamperedAreaPixels,
    tamperedAreaPercentage: Math.round((tamperedAreaPixels / area) * 10000) / 100,
  };
}

/** 4-connected components over TAMPERED 8×8 cells */
export function findConnectedFineRegions(params: {
  cells: FineCellEntry[];
  cellSize: number;
  imageWidth: number;
  imageHeight: number;
}): FineTamperRegion[] {
  const cols = Math.ceil(params.imageWidth / params.cellSize);
  const rows = Math.ceil(params.imageHeight / params.cellSize);
  const byId = new Map(params.cells.map((c) => [c.cellId, c]));
  const visited = new Set<number>();
  const regions: FineTamperRegion[] = [];

  const neighbors = (id: number): number[] => {
    const col = id % cols;
    const row = Math.floor(id / cols);
    const out: number[] = [];
    for (const [r, c] of [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ] as const) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      out.push(r * cols + c);
    }
    return out;
  };

  let regionId = 1;
  for (const cell of params.cells) {
    if (cell.status !== 'TAMPERED' || visited.has(cell.cellId)) continue;
    const queue = [cell.cellId];
    visited.add(cell.cellId);
    const memberIds: number[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      memberIds.push(id);
      for (const n of neighbors(id)) {
        if (visited.has(n)) continue;
        const nb = byId.get(n);
        if (!nb || nb.status !== 'TAMPERED') continue;
        visited.add(n);
        queue.push(n);
      }
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of memberIds) {
      const m = byId.get(id)!;
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.width);
      maxY = Math.max(maxY, m.y + m.height);
    }
    regions.push({
      regionId: regionId++,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      cells: memberIds.length,
      cellIds: memberIds.sort((a, b) => a - b),
    });
  }
  return regions;
}

export function buildFineLocalization(params: {
  imageWidth: number;
  imageHeight: number;
  cellSize: number;
  algorithmVersion: string;
  scheme: string;
  tagBytes: number;
  hmacPassedByCellId: Map<number, boolean>;
  drillDown?: boolean;
  parentBlockIds?: number[];
  /** If set, only include these cellIds in the map output (still full stats optional) */
  restrictToCellIds?: Set<number>;
}): FineBlockLocalization {
  const started = Date.now();
  let cells = buildFineCellMap(params);
  if (params.restrictToCellIds) {
    cells = cells.filter((c) => params.restrictToCellIds!.has(c.cellId));
  }
  const stats = computeFineStats(cells, params.imageWidth, params.imageHeight, params.cellSize);
  const regions = findConnectedFineRegions({
    cells,
    cellSize: params.cellSize,
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
  });
  const tamperedCells = cells.filter((c) => c.status === 'TAMPERED');

  return {
    derivedEvidenceOnly: true,
    algorithmVersion: params.algorithmVersion,
    scheme: params.scheme,
    cellSize: params.cellSize,
    tagBytes: params.tagBytes,
    localizationClaim: '8x8_cell',
    cells,
    tamperedCells,
    stats,
    regions,
    drillDown: params.drillDown === true,
    parentBlockIds: params.parentBlockIds,
    verificationMs: Date.now() - started,
  };
}

/** Cell ids overlapping a rectangle (e.g. Phase-2 failed 64×64 block) */
export function cellIdsOverlappingRect(params: {
  imageWidth: number;
  imageHeight: number;
  cellSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}): number[] {
  const grid = buildPixelCellGrid(params.imageWidth, params.imageHeight, params.cellSize);
  const x1 = params.x + params.width;
  const y1 = params.y + params.height;
  return grid
    .filter((c) => c.x < x1 && c.x + c.width > params.x && c.y < y1 && c.y + c.height > params.y)
    .map((c) => c.cellId);
}
