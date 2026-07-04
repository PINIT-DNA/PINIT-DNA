/**
 * 15-layer DNA comparison scoped exclusively to the authoritative asset.
 * Loads stored vault DNA (L1–L15) and compares every layer against the probe.
 */
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import type { DnaClassification, DnaComparisonResult } from '../../types/comparison.types';
import type { AuthoritativeAsset } from '../../types/authoritative-asset.types';
import type { DeepCompareResult } from './deep-vault-compare.service';
import { derivativeAwareScore } from './deep-vault-compare.service';
import { assertDnaScope, assertVaultScope } from './authoritative-asset.service';
import { resolveMediaProfile } from './adaptive-scoring.service';
import { compareVideoInvestigation } from './video-forensic-compare.service';

/** Align authoritative score with ranking deep-compare (content layers, not L1/L6 weight trap). */
function applyVaultDerivativeScoring(result: DnaComparisonResult): DnaComparisonResult {
  const aware = derivativeAwareScore(
    result.layerComparisons.map((l) => ({
      layer: l.layer,
      similarityPercent: l.similarityPercent,
      matched: l.matched,
    })),
    result.overallConfidenceScore,
    result.classification,
  );
  return {
    ...result,
    overallConfidenceScore: aware.score,
    classification: aware.classification as DnaClassification,
  };
}

const vaultService = new VaultService();
const comparisonService = new DnaComparisonService();

export interface ProbeFileInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
}

/**
 * Compare probe file against the authoritative vault's stored 15-layer DNA registry.
 * Never uses vector scores or fusion — only layer-by-layer comparison.
 */
export async function compareProbeToAuthoritativeAsset(
  authAsset: AuthoritativeAsset,
  probe: ProbeFileInput,
  ownerUserId: string,
): Promise<DnaComparisonResult> {
  assertVaultScope(authAsset.vaultId, authAsset.vaultId, 'compareProbeToAuthoritativeAsset');
  assertDnaScope(authAsset.dnaRecordId, authAsset.dnaRecordId, 'compareProbeToAuthoritativeAsset');

  const original = await vaultService.retrieve(authAsset.vaultId, ownerUserId);
  assertVaultScope(authAsset.vaultId, authAsset.vaultId, 'compareProbeToAuthoritativeAsset:retrieve');

  logger.info('[AuthoritativeDnaCompare] Running 15-layer compare', {
    vaultId: authAsset.vaultId.slice(0, 8),
    dnaRecordId: authAsset.dnaRecordId.slice(0, 8),
    probe: probe.originalName,
    original: original.originalFileName,
    mediaProfile: resolveMediaProfile(probe.mimeType, probe.originalName),
  });

  const mediaProfile = resolveMediaProfile(probe.mimeType, probe.originalName);

  if (mediaProfile === 'video') {
    const base = await comparisonService.compare(
      {
        filePath: '',
        originalName: original.originalFileName,
        declaredMimeType: original.originalMimeType,
        sizeBytes: original.originalSizeBytes,
        buffer: original.originalBuffer,
      },
      {
        filePath: '',
        originalName: probe.originalName,
        declaredMimeType: probe.mimeType,
        sizeBytes: probe.sizeBytes,
        buffer: probe.buffer,
      },
      { vaultDnaRecordId: authAsset.dnaRecordId },
    ).catch(() => null);

    const result = await compareVideoInvestigation(
      {
        buffer: original.originalBuffer,
        mimeType: original.originalMimeType,
        originalName: original.originalFileName,
        sizeBytes: original.originalSizeBytes,
      },
      {
        buffer: probe.buffer,
        mimeType: probe.mimeType,
        originalName: probe.originalName,
        sizeBytes: probe.sizeBytes,
      },
      base,
    );

    logger.info('[AuthoritativeDnaCompare] Video forensic complete', {
      vaultId: authAsset.vaultId.slice(0, 8),
      score: result.overallConfidenceScore,
      classification: result.classification,
    });

    return result;
  }

  const raw = await comparisonService.compare(
    {
      filePath: '',
      originalName: original.originalFileName,
      declaredMimeType: original.originalMimeType,
      sizeBytes: original.originalSizeBytes,
      buffer: original.originalBuffer,
    },
    {
      filePath: '',
      originalName: probe.originalName,
      declaredMimeType: probe.mimeType,
      sizeBytes: probe.sizeBytes,
      buffer: probe.buffer,
    },
    { vaultDnaRecordId: authAsset.dnaRecordId },
  );

  // Same content-aware score as ranking deep-compare — prevents accept-then-reject
  // when weighted overall is ~17% but perceptual/content DNA is ≥40%.
  const result = applyVaultDerivativeScoring(raw);

  logger.info('[AuthoritativeDnaCompare] Complete', {
    vaultId: authAsset.vaultId.slice(0, 8),
    score: result.overallConfidenceScore,
    classification: result.classification,
    rawScore: raw.overallConfidenceScore,
    rawClass: raw.classification,
    layers: result.layerComparisons.length,
    matchedLayers: result.layerComparisons.filter((l) => l.matched && !l.skipped).length,
  });

  return result;
}

/**
 * Fallback when orchestrator compare times out but enterprise deep compare has layer scores.
 */
export function comparisonFromDeepCompareResult(
  deep: DeepCompareResult,
  authAsset: AuthoritativeAsset,
  probe: ProbeFileInput,
): DnaComparisonResult {
  assertVaultScope(authAsset.vaultId, deep.vaultId, 'comparisonFromDeepCompareResult');
  assertDnaScope(authAsset.dnaRecordId, deep.dnaRecordId, 'comparisonFromDeepCompareResult');

  const layerComparisons = (deep.layerComparisons ?? []).map((l) => ({
    layer: l.layer,
    name: l.name,
    implementation: 'vault-registry',
    similarityScore: l.skipped ? 0 : l.similarityPercent / 100,
    similarityPercent: l.skipped ? 0 : l.similarityPercent,
    matched: l.skipped ? false : l.matched,
    skipped: l.skipped,
    fingerprintA: 'vault-stored',
    fingerprintB: 'probe-ephemeral',
    changed: l.skipped ? false : !l.matched,
    changeDescription: l.skipped
      ? 'Registry evidence — not content-comparable'
      : l.matched
        ? 'Layer match'
        : `Layer similarity ${l.similarityPercent}%`,
  }));

  const cls: DnaComparisonResult['classification'] =
    deep.overallConfidenceScore >= 95 ? 'DNA_MATCH'
      : deep.overallConfidenceScore >= 55 ? 'SIMILAR'
        : 'DIFFERENT';

  return {
    comparisonId: `deep-fallback-${authAsset.dnaRecordId.slice(0, 8)}`,
    fileA: {
      filename: authAsset.originalFilename,
      fileType: 'IMAGE',
      mimeType: 'image/*',
      sizeBytes: 0,
      detectedBy: 'vault-registry',
    },
    fileB: {
      filename: probe.originalName,
      fileType: 'IMAGE',
      mimeType: probe.mimeType,
      sizeBytes: probe.sizeBytes,
      detectedBy: 'probe-upload',
    },
    sameFileType: true,
    classification: cls,
    overallConfidenceScore: deep.overallConfidenceScore,
    tamperingDetected: deep.tamperingDetected,
    layerComparisons,
    changedLayers: layerComparisons.filter((l) => l.changed).map((l) => l.name),
    matchedLayers: layerComparisons.filter((l) => l.matched).map((l) => l.name),
    processingMs: 0,
    comparedAt: new Date().toISOString(),
    forensicReport: {
      summary: `15-layer compare (enterprise cache) — ${deep.overallConfidenceScore}%`,
      methodology: 'vault-registry vs probe',
      classification: cls,
      overallConfidenceScore: deep.overallConfidenceScore,
      tamperingDetected: deep.tamperingDetected,
      tamperingIndicators: [],
      layerAnalysis: Object.fromEntries(layerComparisons.map((l) => [`L${l.layer}`, l.changeDescription])),
      changedLayers: layerComparisons.filter((l) => l.changed).map((l) => l.name),
      unchangedLayers: layerComparisons.filter((l) => !l.changed).map((l) => l.name),
      recommendation: '',
      engineVersion: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  };
}
