/**
 * Spatial Auth Phase 2 — integration adapters (additive, non-breaking)
 * Phase 3C extends summaries with hierarchical investigation (visualization only).
 */

import type { ImageDiffResult, ChangedRegion } from '../../types/forensic-diff.types';
import type { ExactSpatialVerificationResult } from './types';
import type { SpatialBlockLocalization } from './localization.types';
import type { SpatialInvestigationResult } from './investigation.types';
import { buildSpatialInvestigation } from './investigation';

/**
 * Map Phase 2 tampered blocks into image-diff ChangedRegion shapes (additive).
 * intensity = 1 for cryptographic failure (not soft score).
 */
export function localizationToChangedRegions(
  localization: SpatialBlockLocalization,
): ChangedRegion[] {
  const scale = localization.primaryScale;
  const cols = Math.ceil(
    (localization.mask.imageWidth || 1) / scale,
  );
  return localization.tamperedBlocks.map((b) => ({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    changeIntensity: 1,
    gridRow: Math.floor(b.blockId / cols),
    gridCol: b.blockId % cols,
  }));
}

/**
 * Map Phase 3 fine tampered cells into ChangedRegion shapes (additive).
 * intensity = 1; claim remains 8×8 cell — not single-pixel proof.
 */
export function fineLocalizationToChangedRegions(
  investigation: SpatialInvestigationResult,
): ChangedRegion[] {
  if (!investigation.trusted || !investigation.overlay) return [];
  return investigation.overlay.fineRects
    .filter((r) => r.status === 'TAMPERED')
    .map((r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      changeIntensity: 1,
      gridRow: Math.floor(r.y / 8),
      gridCol: Math.floor(r.x / 8),
    }));
}

/**
 * Attach spatial localization to an existing ImageDiffResult without removing fields.
 */
export function attachSpatialLocalizationToImageDiff(
  diff: ImageDiffResult,
  verifyResult: ExactSpatialVerificationResult | null | undefined,
): ImageDiffResult & {
  spatialBlockLocalization?: SpatialBlockLocalization | null;
  spatialAuthStatus?: string;
  spatialInvestigation?: SpatialInvestigationResult | null;
} {
  if (!verifyResult) {
    return {
      ...diff,
      spatialBlockLocalization: null,
      spatialInvestigation: null,
    };
  }

  const loc = verifyResult.localization ?? null;
  const investigation =
    verifyResult.investigation ?? buildSpatialInvestigation(verifyResult);

  const enriched = {
    ...diff,
    spatialAuthStatus: verifyResult.status,
    spatialBlockLocalization: loc,
    spatialInvestigation: investigation.trusted ? investigation : investigation,
  };

  if (loc && loc.tamperedBlocks.length > 0) {
    return {
      ...enriched,
      heatmapAvailable: true,
    };
  }
  return enriched;
}

/**
 * Compact summary for tamper-analysis / investigation payloads.
 * Does NOT claim edit-operation type (crop, watermark removal, etc.).
 * Phase 3C adds hierarchical drill-down + fine mask (visualization only).
 */
export function spatialLocalizationForTamperAnalysis(
  verifyResult: ExactSpatialVerificationResult | null | undefined,
): Record<string, unknown> | null {
  if (!verifyResult) return null;

  const investigation =
    verifyResult.investigation ?? buildSpatialInvestigation(verifyResult);

  if (!verifyResult.localization) {
    return {
      available: false,
      reason: verifyResult.status,
      derivedEvidenceOnly: true,
      visualizationOnly: true,
      localizationClaim: '8x8_cell',
      investigation: {
        trusted: false,
        overlay: null,
        fineMask: null,
        unavailableReason: investigation.unavailableReason,
      },
      note: 'Tamper map not trusted when package invalid or dimensions mismatch.',
    };
  }

  const loc = verifyResult.localization;
  const fine = verifyResult.fineLocalization;

  return {
    available: true,
    derivedEvidenceOnly: true,
    visualizationOnly: true,
    verificationMode: 'EXACT',
    status: verifyResult.status,
    primaryScale: loc.primaryScale,
    localizationClaim: '8x8_cell',
    claimDisclaimer: investigation.claimDisclaimer,
    stats: investigation.stats ?? loc.stats,
    regionCount: loc.regions.length,
    regions: investigation.regions.length > 0 ? investigation.regions : loc.regions,
    pattern: loc.pattern,
    mask: {
      format: loc.mask.format,
      byteLength: loc.mask.byteLength,
      gridCols: loc.mask.gridCols,
      gridRows: loc.mask.gridRows,
      dataBase64: loc.mask.dataBase64,
    },
    fineMask: investigation.fineMask
      ? {
          format: investigation.fineMask.format,
          byteLength: investigation.fineMask.byteLength,
          gridCols: investigation.fineMask.gridCols,
          gridRows: investigation.fineMask.gridRows,
          cellSize: investigation.fineMask.cellSize,
          dataBase64: investigation.fineMask.dataBase64,
        }
      : null,
    tamperedBlocks: loc.tamperedBlocks,
    hierarchicalBlocks: investigation.hierarchicalBlocks.filter(
      (b) => b.status === 'TAMPERED' || b.status === 'UNKNOWN',
    ),
    overlay: investigation.overlay,
    multiScale: investigation.multiScale,
    fineLocalizationSummary: fine
      ? {
          localizationClaim: fine.localizationClaim,
          cellSize: fine.cellSize,
          cellsFailed: fine.stats.cellsFailed,
          cellsPassed: fine.stats.cellsPassed,
          tamperedAreaPercentage: fine.stats.tamperedAreaPercentage,
          regionCount: fine.regions.length,
        }
      : null,
    trustNote:
      'Tamper map is derived from HMAC block / HKCA cell authentication. ' +
      'Phase 3C visualization is not an independent trust source.',
  };
}

/** Compact hierarchy summary for Investigate JSON (4×4 / 2×2 / 1×1). */
export function spatialHierarchySummaryForInvestigate(
  verifyResult: ExactSpatialVerificationResult | null | undefined,
): Record<string, unknown> | null {
  if (!verifyResult) return null;
  const q4 = verifyResult.quad4Localization;
  const q2 = verifyResult.quad2Localization;
  const p1 = verifyResult.pixel1Localization;
  return {
    productionClaim: '8x8_cell',
    status: verifyResult.status,
    matched: verifyResult.matched,
    tampered: verifyResult.tampered,
    blocksFailed: verifyResult.blocksFailed,
    blocksPassed: verifyResult.blocksPassed,
    fine8x8: verifyResult.fineLocalization
      ? {
          localizationClaim: verifyResult.fineLocalization.localizationClaim,
          cellsFailed: verifyResult.fineLocalization.stats.cellsFailed,
          cellsPassed: verifyResult.fineLocalization.stats.cellsPassed,
          tamperedAreaPercentage: verifyResult.fineLocalization.stats.tamperedAreaPercentage,
        }
      : null,
    quad4: q4
      ? {
          trusted: q4.trusted,
          localizationUnit: q4.localizationUnit,
          productionClaim: q4.productionClaim,
          cellsFailed: q4.stats.cellsFailed,
          cellsPassed: q4.stats.cellsPassed,
          unavailableReason: q4.unavailableReason ?? null,
          tamperedRects: q4.tamperedCells.slice(0, 500).map((c) => ({
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            status: c.status,
            cellId: c.cellId,
          })),
        }
      : null,
    quad2: q2
      ? {
          trusted: q2.trusted,
          localizationUnit: q2.localizationUnit,
          productionClaim: q2.productionClaim,
          cellsFailed: q2.stats.cellsFailed,
          cellsPassed: q2.stats.cellsPassed,
          unavailableReason: q2.unavailableReason ?? null,
          tamperedRects: q2.tamperedCells.slice(0, 500).map((c) => ({
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            status: c.status,
            cellId: c.cellId,
          })),
        }
      : null,
    pixel1: p1
      ? {
          trusted: p1.trusted,
          localizationClaim: p1.localizationClaim,
          productionClaim: p1.productionClaim,
          pixelsFailed: p1.stats.pixelsFailed,
          pixelsPassed: p1.stats.pixelsPassed,
          unavailableReason: p1.unavailableReason ?? null,
          tamperedPixels: p1.tamperedPixels.slice(0, 256).map((p) => ({
            x: p.x,
            y: p.y,
            width: 1,
            height: 1,
            status: p.status,
          })),
        }
      : null,
    verificationMs: verifyResult.verificationMs,
    quad4VerificationMs: verifyResult.quad4VerificationMs,
    quad2VerificationMs: verifyResult.quad2VerificationMs,
    pixel1VerificationMs: verifyResult.pixel1VerificationMs,
  };
}

/**
 * Merge Mode A spatial verify into an existing tamper-analysis section (additive).
 * Updates severity when cryptographic blocks/cells fail.
 */
export function mergeSpatialVerifyIntoTamperAnalysis<T extends Record<string, unknown>>(
  tamperAnalysis: T,
  verifyResult: ExactSpatialVerificationResult | null | undefined,
): T & {
  spatialAuthInvestigation?: Record<string, unknown> | null;
  spatialAuthBlockLocalization?: Record<string, unknown> | null;
  spatialHierarchy?: Record<string, unknown> | null;
} {
  if (!verifyResult) {
    return {
      ...tamperAnalysis,
      spatialAuthInvestigation: null,
      spatialAuthBlockLocalization: null,
      spatialHierarchy: null,
    };
  }

  const investigation =
    verifyResult.investigation ?? buildSpatialInvestigation(verifyResult);
  const blockLoc = spatialLocalizationForTamperAnalysis(verifyResult);
  const hierarchy = spatialHierarchySummaryForInvestigate(verifyResult);

  const failedBlocks = verifyResult.blocksFailed ?? 0;
  const failedCells = verifyResult.fineLocalization?.stats.cellsFailed ?? 0;
  const cryptoTampered = verifyResult.tampered === true || failedBlocks > 0 || failedCells > 0;

  let next: T & Record<string, unknown> = {
    ...tamperAnalysis,
    spatialAuthInvestigation: investigation as unknown as Record<string, unknown>,
    spatialAuthBlockLocalization: blockLoc,
    spatialHierarchy: hierarchy,
  };

  if (cryptoTampered) {
    const prevScore = typeof next['overallTamperScore'] === 'number'
      ? (next['overallTamperScore'] as number)
      : 10;
    const spatialScore = Math.min(
      95,
      Math.max(35, Math.round((failedBlocks > 0 ? 40 : 0) + Math.min(55, failedCells))),
    );
    next = {
      ...next,
      overallTamperScore: Math.max(prevScore, spatialScore),
      primaryVector:
        next['primaryVector'] === 'NONE' || !next['primaryVector']
          ? 'SPATIAL_BLOCK_TAMPER'
          : next['primaryVector'],
      description: [
        typeof next['description'] === 'string' ? next['description'] : null,
        `Spatial auth: ${failedBlocks} tampered 64×64 block(s)`
          + (failedCells ? `, ${failedCells} tampered 8×8 cell(s)` : '')
          + ' (claim 8x8_cell).',
      ].filter(Boolean).join(' · '),
    };

    const changes = Array.isArray(next['changesVsOriginal'])
      ? [...(next['changesVsOriginal'] as Array<Record<string, unknown>>)]
      : [];
    if (!changes.some((c) => c['type'] === 'Spatial Block Tamper')) {
      changes.unshift({
        type: 'Spatial Block Tamper',
        detected: true,
        confidence: 95,
        detail:
          `${failedBlocks} cryptographic 64×64 block(s) failed`
          + (failedCells ? `; ${failedCells} 8×8 cell(s) failed` : '')
          + '. Localization claim remains 8x8_cell.',
        where: 'Spatial auth Mode A (HMAC / HKCA)',
      });
      next = { ...next, changesVsOriginal: changes };
    }
  }

  return next as T & {
    spatialAuthInvestigation?: Record<string, unknown> | null;
    spatialAuthBlockLocalization?: Record<string, unknown> | null;
    spatialHierarchy?: Record<string, unknown> | null;
  };
}
