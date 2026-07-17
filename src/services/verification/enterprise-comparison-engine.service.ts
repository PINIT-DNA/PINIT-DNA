/**
 * Enterprise 15-Layer Comparison Engine (Milestone E).
 *
 * Consumes Stored Enterprise DNA Package vs Probe DNA Package only.
 * No vault regeneration. No DB writes. Domain scores stay independent.
 *
 * EDS module semantics (authoritative):
 * Identity L1–L10 · Ownership L12/L14/L15 · Evidence L11/L13
 * Trust domain = package integrity / subject-bind confidence (independent).
 *
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../lib/logger';
import {
  DNA_COMPARISON_VERSION,
  DNA_ALGORITHM_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_SCHEMA_VERSION,
} from '../../config/dna-versions';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';
import { DNA_MODULE_REGISTRY_EDS, DNA_ENGINE_ROLE } from '../../config/dna-suite';
import type { EnterpriseDnaPackage } from '../../types/enterprise-dna-package.types';
import type { EphemeralFingerprint } from './ephemeral-fingerprinter';
import type {
  EnterpriseCompareLayerInput,
  EnterpriseComparePackageInput,
  EnterpriseComparisonReport,
  EnterpriseDomainScores,
  EnterpriseLayerCompareResult,
  EnterpriseLayerCompareStatus,
  EnterpriseScoreDomain,
  EnterpriseCompareMode,
  EnterpriseVersionValidation,
} from '../../types/enterprise-comparison.types';

const LAYER_FLAG: Record<number, typeof ENTERPRISE_FEATURE_FLAG[keyof typeof ENTERPRISE_FEATURE_FLAG] | null> = {
  11: ENTERPRISE_FEATURE_FLAG.ENABLE_LAYER11_COMPARE,
  12: ENTERPRISE_FEATURE_FLAG.ENABLE_LAYER12_COMPARE,
  13: ENTERPRISE_FEATURE_FLAG.ENABLE_LAYER13_COMPARE,
  14: ENTERPRISE_FEATURE_FLAG.ENABLE_LAYER14_COMPARE,
  15: ENTERPRISE_FEATURE_FLAG.ENABLE_LAYER15_COMPARE,
};

/** Product-facing labels (Milestone E STEP 2) mapped onto EDS module slots. */
const LAYER_PRODUCT_LABEL: Record<number, string> = {
  1: 'Cryptographic',
  2: 'Structural',
  3: 'Perceptual',
  4: 'Semantic',
  5: 'Metadata',
  6: 'Identity Seal',
  7: 'OCR / Local Patch',
  8: 'Video / Content Family',
  9: 'Audio / Cross-Modal',
  10: 'Screen Recording / Lineage',
  11: 'Transformation History',
  12: 'Ownership Mark',
  13: 'Certificate / Custody',
  14: 'Watermark / Commitment',
  15: 'Trust / Subject Bind',
};

function hammingSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dist = 0;
  const bits = len * 4;
  for (let i = 0; i < len; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  const lengthPenalty = len / Math.max(a.length, b.length);
  return Math.max(0, (1 - dist / bits) * lengthPenalty);
}

function domainForLayer(layerId: number): EnterpriseScoreDomain {
  if (layerId === 15) return 'trust';
  const mod = DNA_MODULE_REGISTRY_EDS.find((m) => m.id === layerId);
  if (mod?.engineRole === DNA_ENGINE_ROLE.OWNERSHIP) return 'ownership';
  if (mod?.engineRole === DNA_ENGINE_ROLE.EVIDENCE) return 'evidence';
  // L5 is Identity under EDS; product STEP 2 treats metadata as evidence-only signal.
  if (layerId === 5) return 'evidence';
  return 'identity';
}

function modeForLayer(layerId: number): EnterpriseCompareMode {
  if ([12, 14].includes(layerId)) return 'OWNERSHIP';
  if ([1, 6, 8, 10, 13, 15].includes(layerId)) return 'EXACT';
  if ([5, 11].includes(layerId)) return 'EVIDENCE';
  return 'SIMILARITY';
}

function statusFromScore(
  score01: number,
  mode: EnterpriseCompareMode,
): EnterpriseLayerCompareStatus {
  if (mode === 'EXACT' || mode === 'OWNERSHIP') {
    if (score01 >= 1) return 'MATCH';
    if (score01 >= 0.85) return 'PARTIAL';
    return 'MISMATCH';
  }
  if (score01 >= 0.92) return 'MATCH';
  if (score01 >= 0.55) return 'PARTIAL';
  return 'MISMATCH';
}

export function packageFromEnterpriseDna(
  pkg: EnterpriseDnaPackage,
): EnterpriseComparePackageInput {
  return {
    dnaId: pkg.dnaId,
    mediaType: pkg.mediaType,
    contentId: pkg.contentId,
    dnaSchemaVersion: pkg.dnaSchemaVersion,
    dnaAlgorithmVersion: pkg.dnaAlgorithmVersion,
    fingerprintVersion: pkg.fingerprintVersion,
    generatorVersion: pkg.generatorVersion,
    comparisonVersion: pkg.comparisonVersion,
    layers: pkg.layers.map((l) => ({
      layerNumber: l.layerNumber,
      layerName: l.layerName,
      fingerprint: l.fingerprint ?? '',
      fingerprintAlgorithm: l.fingerprintAlgorithm,
      fingerprintVersion: l.fingerprintVersion,
      present: !!(l.fingerprint && l.validationStatus !== 'MISSING'),
    })),
  };
}

/** Build an ephemeral probe package for compare — never persisted. */
export function packageFromEphemeralFingerprint(
  fp: EphemeralFingerprint,
  dnaId = `probe:${fp.filename}`,
): EnterpriseComparePackageInput {
  const byLayer = new Map(fp.layers.map((l) => [l.layer, l]));
  const layers: EnterpriseCompareLayerInput[] = [];
  for (let n = 1; n <= 15; n++) {
    const row = byLayer.get(n);
    const reg = DNA_LAYER_REGISTRY[n];
    layers.push({
      layerNumber: n,
      layerName: LAYER_PRODUCT_LABEL[n] ?? reg?.name ?? `L${n}`,
      fingerprint: row?.fingerprint ?? '',
      fingerprintAlgorithm: row?.implementation,
      fingerprintVersion: DNA_FINGERPRINT_VERSION,
      present: !!(row?.success && row.fingerprint),
    });
  }
  return {
    dnaId,
    mediaType: fp.fileType,
    dnaSchemaVersion: DNA_SCHEMA_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    fingerprintVersion: DNA_FINGERPRINT_VERSION,
    generatorVersion: DNA_COMPARISON_VERSION,
    comparisonVersion: DNA_COMPARISON_VERSION,
    layers,
  };
}

export function validateCompareVersions(
  stored: EnterpriseComparePackageInput,
  probe: EnterpriseComparePackageInput,
): EnterpriseVersionValidation {
  const reasons: string[] = [];
  if (stored.dnaSchemaVersion && probe.dnaSchemaVersion
    && stored.dnaSchemaVersion !== probe.dnaSchemaVersion) {
    reasons.push(`schema_version_mismatch:${stored.dnaSchemaVersion}!=${probe.dnaSchemaVersion}`);
  }
  if (stored.dnaAlgorithmVersion && probe.dnaAlgorithmVersion
    && stored.dnaAlgorithmVersion !== probe.dnaAlgorithmVersion) {
    reasons.push(`algorithm_version_mismatch:${stored.dnaAlgorithmVersion}!=${probe.dnaAlgorithmVersion}`);
  }
  if (stored.fingerprintVersion && probe.fingerprintVersion
    && stored.fingerprintVersion !== probe.fingerprintVersion) {
    reasons.push(`fingerprint_version_mismatch:${stored.fingerprintVersion}!=${probe.fingerprintVersion}`);
  }
  // Cross-suite compare is allowed with adapter (hamming) — warn but do not abort.
  return {
    ok: reasons.length === 0,
    reasons,
    storedSchemaVersion: stored.dnaSchemaVersion,
    probeSchemaVersion: probe.dnaSchemaVersion,
    storedAlgorithmVersion: stored.dnaAlgorithmVersion,
    probeAlgorithmVersion: probe.dnaAlgorithmVersion,
    storedFingerprintVersion: stored.fingerprintVersion,
    probeFingerprintVersion: probe.fingerprintVersion,
  };
}

function layerInput(
  pkg: EnterpriseComparePackageInput,
  n: number,
): EnterpriseCompareLayerInput | undefined {
  return pkg.layers.find((l) => l.layerNumber === n);
}

/** Single-layer compare() — unified interface for all 15 modules. */
export function compareEnterpriseLayer(
  layerId: number,
  stored: EnterpriseComparePackageInput,
  probe: EnterpriseComparePackageInput,
): EnterpriseLayerCompareResult {
  const started = Date.now();
  const domain = domainForLayer(layerId);
  const mode = modeForLayer(layerId);
  const label = LAYER_PRODUCT_LABEL[layerId] ?? `L${layerId}`;
  const a = layerInput(stored, layerId);
  const b = layerInput(probe, layerId);

  logger.info('[EnterpriseCompare] layer started', { layerId, layerName: label, domain, mode });

  const flag = LAYER_FLAG[layerId];
  if (flag && !isEnterpriseFeatureEnabled(flag)) {
    const result: EnterpriseLayerCompareResult = {
      layerId,
      layerName: label,
      domain,
      mode,
      score: 0,
      confidence: 0,
      status: 'NOT_PRESENT',
      reason: `feature_flag_off:${flag}`,
      evidence: 'Layer compare disabled by feature flag',
      executionTimeMs: Date.now() - started,
      algorithmId: a?.fingerprintAlgorithm ?? b?.fingerprintAlgorithm,
      fingerprintVersion: a?.fingerprintVersion ?? b?.fingerprintVersion,
    };
    logger.info('[EnterpriseCompare] layer finished', {
      layerId, status: result.status, score: result.score, durationMs: result.executionTimeMs,
    });
    return result;
  }

  try {
    if (!a?.present && !b?.present) {
      const result: EnterpriseLayerCompareResult = {
        layerId, layerName: label, domain, mode,
        score: 0, confidence: 0, status: 'NOT_PRESENT',
        reason: 'both_sides_absent',
        evidence: 'Fingerprint missing on stored and probe packages',
        executionTimeMs: Date.now() - started,
      };
      logger.info('[EnterpriseCompare] layer finished', {
        layerId, status: result.status, score: result.score, durationMs: result.executionTimeMs,
      });
      return result;
    }
    if (!a?.present) {
      const result: EnterpriseLayerCompareResult = {
        layerId, layerName: label, domain, mode,
        score: 0, confidence: 40, status: 'NOT_PRESENT',
        reason: 'stored_absent',
        evidence: 'Stored package layer not present',
        executionTimeMs: Date.now() - started,
        algorithmId: b?.fingerprintAlgorithm,
      };
      logger.info('[EnterpriseCompare] layer finished', {
        layerId, status: result.status, score: result.score, durationMs: result.executionTimeMs,
      });
      return result;
    }
    if (!b?.present) {
      // Stripped metadata / removed watermark / missing probe signal
      const result: EnterpriseLayerCompareResult = {
        layerId, layerName: label, domain, mode,
        score: 0, confidence: 70, status: 'NOT_PRESENT',
        reason: 'probe_absent',
        evidence: 'Probe package layer not present (stripped or unsupported)',
        executionTimeMs: Date.now() - started,
        algorithmId: a.fingerprintAlgorithm,
        fingerprintVersion: a.fingerprintVersion,
      };
      logger.info('[EnterpriseCompare] layer finished', {
        layerId, status: result.status, score: result.score, durationMs: result.executionTimeMs,
      });
      return result;
    }

    let score01: number;
    if (mode === 'EXACT' || mode === 'OWNERSHIP' || layerId === 5) {
      score01 = a.fingerprint === b.fingerprint ? 1 : 0;
      // L1 also accepts contentId equality
      if (layerId === 1 && score01 < 1 && stored.contentId && b.fingerprint === stored.contentId) {
        score01 = 1;
      }
    } else {
      score01 = hammingSimilarity(a.fingerprint, b.fingerprint);
    }

    const status = statusFromScore(score01, mode);
    const score = Math.round(score01 * 100);
    const confidence = status === 'MATCH' ? 98
      : status === 'PARTIAL' ? Math.max(55, score)
      : Math.max(40, 100 - score);

    const result: EnterpriseLayerCompareResult = {
      layerId,
      layerName: label,
      domain,
      mode,
      score,
      confidence,
      status,
      reason: status === 'MATCH' ? 'fingerprints_equal_or_similar'
        : status === 'PARTIAL' ? 'partial_similarity'
        : 'fingerprint_mismatch',
      evidence: `${mode} compare · score=${score}% · status=${status}`,
      executionTimeMs: Date.now() - started,
      algorithmId: a.fingerprintAlgorithm,
      fingerprintVersion: a.fingerprintVersion,
    };
    logger.info('[EnterpriseCompare] layer finished', {
      layerId, status: result.status, score: result.score, durationMs: result.executionTimeMs,
    });
    return result;
  } catch (error) {
    const result: EnterpriseLayerCompareResult = {
      layerId, layerName: label, domain, mode,
      score: 0, confidence: 0, status: 'ERROR',
      reason: 'compare_exception',
      evidence: String(error).slice(0, 120),
      executionTimeMs: Date.now() - started,
    };
    logger.info('[EnterpriseCompare] layer finished', {
      layerId, status: result.status, score: result.score, durationMs: result.executionTimeMs,
    });
    return result;
  }
}

function averageDomain(
  layers: EnterpriseLayerCompareResult[],
  domain: EnterpriseScoreDomain,
): number {
  const rows = layers.filter(
    (l) => l.domain === domain && l.status !== 'NOT_PRESENT' && l.status !== 'ERROR',
  );
  if (!rows.length) return 0;
  return Math.round(rows.reduce((s, l) => s + l.score, 0) / rows.length);
}

function buildDomainScores(layers: EnterpriseLayerCompareResult[]): EnterpriseDomainScores {
  // Domains stay independent — never average across identity/evidence/ownership/trust.
  return {
    identityScore: averageDomain(layers, 'identity'),
    evidenceScore: averageDomain(layers, 'evidence'),
    ownershipScore: averageDomain(layers, 'ownership'),
    trustScore: averageDomain(layers, 'trust'),
  };
}

export class EnterpriseComparisonEngine {
  /**
   * Compare stored package (SSoT) vs probe package (ephemeral).
   * Returns independent domain scores — never a single fused ownership %.
   */
  comparePackages(
    stored: EnterpriseComparePackageInput,
    probe: EnterpriseComparePackageInput,
  ): EnterpriseComparisonReport {
    const started = Date.now();
    const comparisonId = uuidv4();
    const versionValidation = validateCompareVersions(stored, probe);

    logger.info('[EnterpriseCompare] comparison started', {
      comparisonId: comparisonId.slice(0, 8),
      storedDnaId: stored.dnaId.slice(0, 12),
      probeDnaId: probe.dnaId.slice(0, 12),
      versionOk: versionValidation.ok,
    });

    const layers: EnterpriseLayerCompareResult[] = [];
    for (let n = 1; n <= 15; n++) {
      layers.push(compareEnterpriseLayer(n, stored, probe));
    }

    const domains = buildDomainScores(layers);
    const processingMs = Date.now() - started;
    const matched = layers.filter((l) => l.status === 'MATCH').length;
    const partial = layers.filter((l) => l.status === 'PARTIAL').length;

    const report: EnterpriseComparisonReport = {
      schema: 'enterprise-comparison-report-v1',
      comparisonId,
      engineVersion: DNA_COMPARISON_VERSION,
      comparedAt: new Date().toISOString(),
      processingMs,
      versionValidation,
      layers,
      domains,
      summary: `Enterprise compare · identity=${domains.identityScore} evidence=${domains.evidenceScore} ownership=${domains.ownershipScore} trust=${domains.trustScore} · ${matched} MATCH / ${partial} PARTIAL`,
    };

    logger.info('[EnterpriseCompare] comparison finished', {
      comparisonId: comparisonId.slice(0, 8),
      processingMs,
      identityScore: domains.identityScore,
      evidenceScore: domains.evidenceScore,
      ownershipScore: domains.ownershipScore,
      trustScore: domains.trustScore,
      // No fingerprints logged
    });

    return report;
  }

  compareStoredVsEphemeral(
    storedPkg: EnterpriseDnaPackage,
    probeFp: EphemeralFingerprint,
  ): EnterpriseComparisonReport {
    return this.comparePackages(
      packageFromEnterpriseDna(storedPkg),
      packageFromEphemeralFingerprint(probeFp),
    );
  }
}

export const enterpriseComparisonEngine = new EnterpriseComparisonEngine();

export function isComparisonV2Enabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.COMPARISON_V2);
}
