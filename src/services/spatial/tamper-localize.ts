/**
 * Spatial Auth Phase 2 — block tamper map, mask, connected regions
 *
 * Does NOT change Phase 1 HMAC/Merkle. Operates on already-verified block statuses.
 */

import { buildBlockGrid } from './block-grid';
import type {
  BlockMapEntry,
  BlockMapStatus,
  SpatialBlockLocalization,
  SpatialModificationPattern,
  SpatialModificationPatternInfo,
  SpatialTamperMask,
  SpatialTamperRegion,
  SpatialTamperStats,
} from './localization.types';

const MASK_AUTHENTIC = 0;
const MASK_TAMPERED = 1;
const MASK_UNKNOWN = 2;

export function statusToMaskByte(status: BlockMapStatus): number {
  if (status === 'AUTHENTIC') return MASK_AUTHENTIC;
  if (status === 'TAMPERED') return MASK_TAMPERED;
  return MASK_UNKNOWN;
}

export function maskByteToStatus(b: number): BlockMapStatus {
  if (b === MASK_TAMPERED) return 'TAMPERED';
  if (b === MASK_UNKNOWN) return 'UNKNOWN';
  return 'AUTHENTIC';
}

/**
 * Build full primary-scale block map from HMAC outcomes.
 * Every enrolled primary block gets AUTHENTIC or TAMPERED (or UNKNOWN if missing).
 */
export function buildPrimaryBlockMap(params: {
  imageWidth: number;
  imageHeight: number;
  primaryScale: number;
  /** blockId → whether HMAC passed (true) or failed (false). Missing → UNKNOWN */
  hmacPassedByBlockId: Map<number, boolean>;
}): BlockMapEntry[] {
  const grid = buildBlockGrid(params.imageWidth, params.imageHeight, params.primaryScale);
  return grid.map((g) => {
    let status: BlockMapStatus = 'UNKNOWN';
    if (params.hmacPassedByBlockId.has(g.blockId)) {
      status = params.hmacPassedByBlockId.get(g.blockId) ? 'AUTHENTIC' : 'TAMPERED';
    }
    return {
      blockId: g.blockId,
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      scale: g.scale,
      status,
    };
  });
}

export function computeTamperStats(
  blocks: BlockMapEntry[],
  imageWidth: number,
  imageHeight: number,
): SpatialTamperStats {
  let blocksPassed = 0;
  let blocksFailed = 0;
  let blocksUnknown = 0;
  let tamperedAreaPixels = 0;

  for (const b of blocks) {
    if (b.status === 'AUTHENTIC') blocksPassed += 1;
    else if (b.status === 'TAMPERED') {
      blocksFailed += 1;
      tamperedAreaPixels += b.width * b.height;
    } else blocksUnknown += 1;
  }

  const blocksChecked = blocks.length;
  const imageArea = Math.max(1, imageWidth * imageHeight);

  return {
    blocksChecked,
    blocksPassed,
    blocksFailed,
    blocksUnknown,
    exactPassRate: blocksChecked === 0 ? 0 : blocksPassed / blocksChecked,
    tamperedAreaPixels,
    tamperedAreaPercentage: Math.round((tamperedAreaPixels / imageArea) * 10000) / 100,
  };
}

/** Block-accurate byte mask — no blur / interpolation */
export function buildTamperMask(params: {
  blocks: BlockMapEntry[];
  imageWidth: number;
  imageHeight: number;
  primaryScale: number;
}): SpatialTamperMask {
  const scale = params.primaryScale;
  const gridCols = Math.ceil(params.imageWidth / scale);
  const gridRows = Math.ceil(params.imageHeight / scale);
  const data = Buffer.alloc(params.blocks.length, MASK_UNKNOWN);

  for (const b of params.blocks) {
    if (b.blockId >= 0 && b.blockId < data.length) {
      data[b.blockId] = statusToMaskByte(b.status);
    }
  }

  return {
    format: 'block-byte-v1',
    encoding: { AUTHENTIC: 0, TAMPERED: 1, UNKNOWN: 2 },
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
    scale,
    gridCols,
    gridRows,
    blockCount: params.blocks.length,
    dataBase64: data.toString('base64'),
    byteLength: data.length,
  };
}

/**
 * 4-connected components over TAMPERED blocks on the primary grid.
 */
export function findConnectedTamperRegions(params: {
  blocks: BlockMapEntry[];
  primaryScale: number;
  imageWidth: number;
  imageHeight: number;
}): SpatialTamperRegion[] {
  const scale = params.primaryScale;
  const cols = Math.ceil(params.imageWidth / scale);
  const rows = Math.ceil(params.imageHeight / scale);
  const byId = new Map(params.blocks.map((b) => [b.blockId, b]));
  const visited = new Set<number>();
  const regions: SpatialTamperRegion[] = [];

  const neighbors = (blockId: number): number[] => {
    const col = blockId % cols;
    const row = Math.floor(blockId / cols);
    const out: number[] = [];
    const cand = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];
    for (const [r, c] of cand) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      out.push(r * cols + c);
    }
    return out;
  };

  let regionId = 1;
  for (const b of params.blocks) {
    if (b.status !== 'TAMPERED' || visited.has(b.blockId)) continue;

    const queue = [b.blockId];
    visited.add(b.blockId);
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
      blocks: memberIds.length,
      blockIds: memberIds.sort((a, c) => a - c),
    });
  }

  return regions;
}

export function classifyModificationPattern(
  stats: SpatialTamperStats,
  regions: SpatialTamperRegion[],
): SpatialModificationPatternInfo {
  if (stats.blocksFailed === 0) {
    return {
      pattern: 'NONE',
      regionCount: 0,
      summary: 'No localized modification regions detected.',
    };
  }

  const failRatio = stats.blocksChecked === 0 ? 0 : stats.blocksFailed / stats.blocksChecked;
  let pattern: SpatialModificationPattern;

  if (failRatio >= 0.8) {
    pattern = 'GLOBAL_MODIFICATION';
  } else if (regions.length >= 2) {
    pattern = 'MULTIPLE_LOCAL_MODIFICATIONS';
  } else if (regions.length === 1 && (regions[0]!.blocks / Math.max(1, stats.blocksChecked) >= 0.25 || failRatio >= 0.25)) {
    pattern = 'LARGE_MODIFICATION';
  } else {
    pattern = 'LOCAL_MODIFICATION';
  }

  const summaries: Record<SpatialModificationPattern, string> = {
    NONE: 'No localized modification regions detected.',
    LOCAL_MODIFICATION: `${regions.length} localized modification region detected.`,
    MULTIPLE_LOCAL_MODIFICATIONS: `${regions.length} separated modification regions detected.`,
    LARGE_MODIFICATION: `1 large modification region detected (${regions[0]?.blocks ?? 0} blocks).`,
    GLOBAL_MODIFICATION: `Global modification pattern — ${stats.blocksFailed}/${stats.blocksChecked} blocks failed authentication.`,
  };

  return {
    pattern,
    regionCount: regions.length,
    summary: summaries[pattern],
  };
}

/** ASCII grid for debugging (SAFE/TAMPER/UNK) — presentation only */
export function buildGridPreview(params: {
  blocks: BlockMapEntry[];
  primaryScale: number;
  imageWidth: number;
  imageHeight: number;
}): string {
  const cols = Math.ceil(params.imageWidth / params.primaryScale);
  const byId = new Map(params.blocks.map((b) => [b.blockId, b]));
  const lines: string[] = [];
  const rows = Math.ceil(params.imageHeight / params.primaryScale);
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c;
      const b = byId.get(id);
      if (!b) cells.push('????');
      else if (b.status === 'AUTHENTIC') cells.push('SAFE');
      else if (b.status === 'TAMPERED') cells.push('TAMPER');
      else cells.push('UNK');
    }
    lines.push(cells.join(' '));
  }
  return lines.join('\n');
}

/**
 * Build full Phase 2 localization from a completed primary-scale HMAC map.
 * Returns null when caller should not trust a map (invalid package / mismatch).
 */
export function buildSpatialBlockLocalization(params: {
  imageWidth: number;
  imageHeight: number;
  primaryScale: number;
  hmacPassedByBlockId: Map<number, boolean>;
  includeGridPreview?: boolean;
}): SpatialBlockLocalization {
  const t0 = Date.now();
  const blocks = buildPrimaryBlockMap(params);
  const mask = buildTamperMask({
    blocks,
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
    primaryScale: params.primaryScale,
  });
  const maskGenerationMs = Date.now() - t0;

  const t1 = Date.now();
  const regions = findConnectedTamperRegions({
    blocks,
    primaryScale: params.primaryScale,
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
  });
  const stats = computeTamperStats(blocks, params.imageWidth, params.imageHeight);
  const pattern = classifyModificationPattern(stats, regions);
  const regionAnalysisMs = Date.now() - t1;

  const tamperedBlocks = blocks.filter((b) => b.status === 'TAMPERED');

  return {
    derivedEvidenceOnly: true,
    primaryScale: params.primaryScale,
    blocks,
    tamperedBlocks,
    stats,
    regions,
    pattern,
    mask,
    gridPreview: params.includeGridPreview
      ? buildGridPreview({
          blocks,
          primaryScale: params.primaryScale,
          imageWidth: params.imageWidth,
          imageHeight: params.imageHeight,
        })
      : undefined,
    maskGenerationMs,
    regionAnalysisMs,
  };
}
