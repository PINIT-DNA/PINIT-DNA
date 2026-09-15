/**
 * Spatial Auth Phase 3C — build hierarchical investigation / overlay
 * from existing Phase 1/2/3A verification output.
 *
 * Does NOT recalculate HMAC/Merkle/HKCA. Visualization only.
 */

import type { ExactSpatialVerificationResult } from './types';
import type { BlockMapEntry } from './localization.types';
import type { FineCellEntry } from './pixel-auth/types';
import type {
  FineTamperMask,
  SpatialHierarchicalBlock,
  SpatialInvestigationRegion,
  SpatialInvestigationResult,
  SpatialInvestigationStats,
  SpatialOverlayDescriptor,
  SpatialOverlayRect,
} from './investigation.types';

const CLAIM = '8x8_cell' as const;

const CLAIM_DISCLAIMER =
  'localizationClaim=8x8_cell. Cryptographic evidence proves which 8×8 cells failed authentication. ' +
  'It does NOT prove an exact modified pixel coordinate or individual pixel cryptographic identification.';

const TRUST_NOTE =
  'Phase 1 = cryptographic block integrity. Phase 2 = block localization. ' +
  'Phase 3A = cryptographic 8×8 cell authentication. Phase 3C = visualization/investigation only. ' +
  'Client-provided localization data must never be treated as trusted server-side evidence.';

const UNTRUSTED_STATUSES = new Set([
  'INVALID_AUTH_PACKAGE',
  'INVALID_PIXEL_PACKAGE',
  'DIMENSION_MISMATCH',
  'UNSUPPORTED_VERSION',
  'ERROR',
]);

function cellOverlapsRect(
  c: { x: number; y: number; width: number; height: number },
  r: { x: number; y: number; width: number; height: number },
): boolean {
  return c.x < r.x + r.width && c.x + c.width > r.x && c.y < r.y + r.height && c.y + c.height > r.y;
}

function statusToMaskByte(status: string): number {
  if (status === 'AUTHENTIC') return 0;
  if (status === 'TAMPERED') return 1;
  return 2;
}

/** Build cell-byte-v1 mask from fine cells (no smoothing). */
export function buildFineTamperMask(params: {
  imageWidth: number;
  imageHeight: number;
  cellSize: number;
  cells: FineCellEntry[];
}): FineTamperMask {
  const cellSize = params.cellSize;
  const gridCols = Math.ceil(params.imageWidth / cellSize);
  const gridRows = Math.ceil(params.imageHeight / cellSize);
  const cellCount = gridCols * gridRows;
  const bytes = Buffer.alloc(cellCount, 2); // UNKNOWN default
  for (const c of params.cells) {
    if (c.cellId >= 0 && c.cellId < cellCount) {
      bytes[c.cellId] = statusToMaskByte(c.status);
    }
  }
  return {
    format: 'cell-byte-v1',
    encoding: { AUTHENTIC: 0, TAMPERED: 1, UNKNOWN: 2 },
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
    cellSize,
    gridCols,
    gridRows,
    cellCount,
    dataBase64: bytes.toString('base64'),
    byteLength: bytes.length,
  };
}

export function buildSpatialOverlayDescriptor(params: {
  imageWidth: number;
  imageHeight: number;
  coarseBlocks: BlockMapEntry[];
  fineCells: FineCellEntry[];
}): SpatialOverlayDescriptor {
  const coarseRects: SpatialOverlayRect[] = params.coarseBlocks
    .filter((b) => b.status === 'TAMPERED' || b.status === 'UNKNOWN')
    .map((b) => ({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      status: b.status,
      blockId: b.blockId,
    }));

  const fineRects: SpatialOverlayRect[] = params.fineCells
    .filter((c) => c.status === 'TAMPERED' || c.status === 'UNKNOWN')
    .map((c) => ({
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      status: c.status,
      cellId: c.cellId,
    }));

  return {
    format: 'spatial-overlay-rects-v1',
    visualizationOnly: true,
    imageWidth: params.imageWidth,
    imageHeight: params.imageHeight,
    localizationClaim: CLAIM,
    coarseRects,
    fineRects,
    colors: {
      AUTHENTIC: 'rgba(34,197,94,0.15)',
      TAMPERED: 'rgba(239,68,68,0.55)',
      UNKNOWN: 'rgba(148,163,184,0.40)',
    },
    note:
      'Overlay is visualization only. Coordinates are original image pixels. ' +
      'Do not interpret highlighted cells as exact single-pixel identification.',
  };
}

function buildHierarchicalBlocks(params: {
  blocks: BlockMapEntry[];
  fineCells: FineCellEntry[] | null;
  cellSize: number;
  /** When true, only TAMPERED/UNKNOWN blocks get nested fine maps (smaller payload) */
  nestFineOnlyForNonAuthentic?: boolean;
}): SpatialHierarchicalBlock[] {
  const fine = params.fineCells;
  const nestOnlyNonAuth = params.nestFineOnlyForNonAuthentic !== false;

  return params.blocks.map((b) => {
    const shouldNest =
      fine != null && (!nestOnlyNonAuth || b.status !== 'AUTHENTIC');

    if (!shouldNest) {
      return {
        blockId: b.blockId,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        status: b.status,
        scale: b.scale,
        fineLocalization: null,
      };
    }

    const cells = fine!.filter((c) => cellOverlapsRect(c, b));
    const tamperedCells = cells.filter((c) => c.status === 'TAMPERED');
    const gridCols = Math.max(1, Math.ceil(b.width / params.cellSize));
    const gridRows = Math.max(1, Math.ceil(b.height / params.cellSize));

    return {
      blockId: b.blockId,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      status: b.status,
      scale: b.scale,
      fineLocalization: {
        cellSize: params.cellSize,
        localizationClaim: CLAIM,
        cells,
        tamperedCells,
        gridCols,
        gridRows,
      },
    };
  });
}

function enrichRegions(params: {
  phase2Regions: Array<{
    regionId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    blocks: number;
    blockIds: number[];
  }>;
  blocksById: Map<number, BlockMapEntry>;
  fineCells: FineCellEntry[] | null;
  imageWidth: number;
  imageHeight: number;
}): SpatialInvestigationRegion[] {
  const area = Math.max(1, params.imageWidth * params.imageHeight);
  return params.phase2Regions.map((r) => {
    const blockRects = r.blockIds
      .map((id) => params.blocksById.get(id))
      .filter((b): b is BlockMapEntry => !!b);

    let cellIds: number[] = [];
    let affectedAreaPixels = 0;
    if (params.fineCells) {
      const tampered = params.fineCells.filter((c) => {
        if (c.status !== 'TAMPERED') return false;
        return blockRects.some((b) => cellOverlapsRect(c, b));
      });
      cellIds = tampered.map((c) => c.cellId).sort((a, b) => a - b);
      affectedAreaPixels = tampered.reduce((s, c) => s + c.width * c.height, 0);
    } else {
      // Fall back to Phase-2 block area when fine layer absent
      affectedAreaPixels = blockRects.reduce((s, b) => s + b.width * b.height, 0);
    }

    return {
      regionId: r.regionId,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      tampered64x64Blocks: r.blocks,
      blockIds: [...r.blockIds],
      tampered8x8Cells: cellIds.length,
      cellIds,
      affectedAreaPixels,
      affectedAreaPercentage: Math.round((affectedAreaPixels / area) * 10000) / 100,
    };
  });
}

function emptyUntrusted(
  status: string,
  reason: string,
  started: number,
): SpatialInvestigationResult {
  return {
    derivedEvidenceOnly: true,
    visualizationOnly: true,
    trusted: false,
    localizationClaim: CLAIM,
    claimDisclaimer: CLAIM_DISCLAIMER,
    trustNote: TRUST_NOTE,
    verificationStatus: status,
    multiScale: {
      availableScales: [64, 8],
      overviewScale: 64,
      fineScale: 8,
      futureScalesReserved: [4],
    },
    stats: null,
    overviewBlocks: [],
    hierarchicalBlocks: [],
    regions: [],
    pattern: null,
    fineMask: null,
    overlay: null,
    unavailableReason: reason,
    investigationMs: Date.now() - started,
  };
}

/**
 * Consume ExactSpatialVerificationResult → investigation payload.
 * Never reinterprets authentication; trusts only server-built localization fields.
 */
export function buildSpatialInvestigation(
  verifyResult: ExactSpatialVerificationResult,
): SpatialInvestigationResult {
  const started = Date.now();
  const status = verifyResult.status;

  // Invalid / mismatch / error → no trusted fine map or overlay
  if (UNTRUSTED_STATUSES.has(status) || !verifyResult.localization) {
    const reason =
      verifyResult.detail
      || (!verifyResult.localization
        ? `No trusted Phase-2 localization (status=${status}).`
        : `Verification status ${status} — fine map / overlay not trusted.`);
    return emptyUntrusted(status, reason, started);
  }

  // Pixel layer explicitly invalid → block map may exist, but fine map/overlay must not be trusted as 8×8
  const pixelStatus = verifyResult.pixelLayer?.status;
  const fineTrusted =
    !!verifyResult.fineLocalization &&
    pixelStatus !== 'INVALID_PIXEL_PACKAGE' &&
    pixelStatus !== 'UNSUPPORTED_VERSION' &&
    pixelStatus !== 'ERROR' &&
    verifyResult.fineLocalization.localizationClaim === '8x8_cell';

  const loc = verifyResult.localization;
  const fine = fineTrusted ? verifyResult.fineLocalization! : null;
  const cellSize = fine?.cellSize ?? 8;
  const imageWidth = verifyResult.width;
  const imageHeight = verifyResult.height;
  const totalPixels = imageWidth * imageHeight;

  const fineCells = fine?.cells ?? null;
  const hierarchicalBlocks = buildHierarchicalBlocks({
    blocks: loc.blocks,
    fineCells,
    cellSize,
    nestFineOnlyForNonAuthentic: true,
  });

  // Ensure every TAMPERED block has fine nest when fine trusted
  for (const hb of hierarchicalBlocks) {
    if (fine && hb.status === 'TAMPERED' && !hb.fineLocalization) {
      const cells = fine.cells.filter((c) => cellOverlapsRect(c, hb));
      hb.fineLocalization = {
        cellSize,
        localizationClaim: CLAIM,
        cells,
        tamperedCells: cells.filter((c) => c.status === 'TAMPERED'),
        gridCols: Math.max(1, Math.ceil(hb.width / cellSize)),
        gridRows: Math.max(1, Math.ceil(hb.height / cellSize)),
      };
    }
  }

  const blocksById = new Map(loc.blocks.map((b) => [b.blockId, b]));
  const regions = enrichRegions({
    phase2Regions: loc.regions,
    blocksById,
    fineCells: fine?.tamperedCells ?? fineCells,
    imageWidth,
    imageHeight,
  });

  const tampered8x8 = fine?.stats.cellsFailed ?? 0;
  const tamperedAreaPixels = fine
    ? fine.stats.tamperedAreaPixels
    : loc.stats.tamperedAreaPixels;
  const tamperedAreaPercentage = fine
    ? fine.stats.tamperedAreaPercentage
    : loc.stats.tamperedAreaPercentage;

  let largestRegion: SpatialInvestigationStats['largestRegion'] = null;
  if (regions.length > 0) {
    const sorted = [...regions].sort((a, b) => b.affectedAreaPixels - a.affectedAreaPixels);
    const top = sorted[0]!;
    largestRegion = {
      regionId: top.regionId,
      width: top.width,
      height: top.height,
      blocks: top.tampered64x64Blocks,
      cells: top.tampered8x8Cells,
      areaPixels: top.affectedAreaPixels,
    };
  }

  const stats: SpatialInvestigationStats = {
    imageWidth,
    imageHeight,
    totalPixels,
    total64x64Blocks: loc.stats.blocksChecked,
    tampered64x64Blocks: loc.stats.blocksFailed,
    total8x8Cells: fine?.stats.cellsChecked ?? 0,
    tampered8x8Cells: tampered8x8,
    tamperedAreaPixels,
    tamperedAreaPercentage,
    numberOfRegions: regions.length,
    largestRegion,
    localizationClaim: CLAIM,
  };

  const fineMask =
    fine != null
      ? buildFineTamperMask({
          imageWidth,
          imageHeight,
          cellSize,
          cells: fine.cells,
        })
      : null;

  // Overlay: fine rects only when fine trusted; coarse always from Phase 2 when localization trusted
  let trustedOverlay: SpatialOverlayDescriptor | null = buildSpatialOverlayDescriptor({
    imageWidth,
    imageHeight,
    coarseBlocks: loc.blocks,
    fineCells: fineTrusted && fine ? fine.cells : [],
  });

  if (verifyResult.status === 'MATCH' && loc.tamperedBlocks.length === 0 && tampered8x8 === 0) {
    trustedOverlay = {
      ...trustedOverlay,
      coarseRects: [],
      fineRects: [],
      note:
        'No tampered blocks or cells. Overlay empty. localizationClaim remains 8x8_cell for API consistency.',
    };
  }

  return {
    derivedEvidenceOnly: true,
    visualizationOnly: true,
    trusted: true,
    localizationClaim: CLAIM,
    claimDisclaimer: CLAIM_DISCLAIMER,
    trustNote: TRUST_NOTE,
    verificationStatus: status,
    multiScale: {
      availableScales: [64, 8],
      overviewScale: loc.primaryScale,
      fineScale: cellSize,
      futureScalesReserved: [4],
    },
    stats,
    overviewBlocks: loc.blocks,
    hierarchicalBlocks,
    regions,
    pattern: loc.pattern,
    fineMask: fineTrusted ? fineMask : null,
    overlay: trustedOverlay,
    unavailableReason: fineTrusted
      ? undefined
      : 'Fine 8×8 layer unavailable or untrusted; coarse Phase-2 overview may still be present.',
    investigationMs: Date.now() - started,
  };
}

/**
 * Drill into one hierarchical block — returns nested fine grid for UI.
 * Pure filter over already-built investigation (no crypto).
 */
export function drillDownBlock(
  investigation: SpatialInvestigationResult,
  blockId: number,
): SpatialHierarchicalBlock | null {
  if (!investigation.trusted) return null;
  return investigation.hierarchicalBlocks.find((b) => b.blockId === blockId) ?? null;
}
