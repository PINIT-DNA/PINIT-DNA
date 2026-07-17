/**
 * Investigation Stored DNA Source Resolver (Milestone C).
 *
 * WHY: Investigation must treat sealed enterpriseDnaPackage as SSoT (EDS P3/P5).
 * Never regenerate vault identity fingerprints when a valid package exists.
 * Legacy live/registry regeneration remains as fallback for unmigrated rows.
 *
 * Does NOT change ComparisonEngine scoring, Acceptance, or Retrieval ranking.
 *
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md P3–P5
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';
import { TOTAL_DNA_LAYERS } from '../../constants/dna-layers';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';
import {
  computeOverallIntegrityHash,
  parseEnterpriseDnaPackage,
} from '../dna/enterprise-dna-package.service';
import type { EnterpriseDnaPackage } from '../../types/enterprise-dna-package.types';
import type { EphemeralFingerprint, EphemeralLayer } from '../verification/ephemeral-fingerprinter';

export type InvestigationVaultDnaSourceMode =
  | 'enterprise_package'
  | 'legacy_registry'
  | 'legacy_live'
  | 'unavailable';

export interface InvestigationVaultDnaResolution {
  mode: InvestigationVaultDnaSourceMode;
  dnaRecordId: string;
  /** Present when mode === enterprise_package */
  fingerprint?: EphemeralFingerprint;
  reason: string;
  integrityValid?: boolean;
  packagePresent: boolean;
}

export function isUseStoredDnaPrimaryEnabled(): boolean {
  return (
    isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.USE_STORED_DNA_PRIMARY) ||
    isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.AUTHORITATIVE_STORED_DNA)
  );
}

/**
 * Re-validate package integrity without logging fingerprints.
 * User rule: generationStatus COMPLETE + integrity valid + 15 layers.
 * (validationStatus VALID maps to "package validation passed"; COMPLETE is generationStatus.)
 */
export function isEnterprisePackageUsableForInvestigation(pkg: EnterpriseDnaPackage): {
  ok: boolean;
  reason: string;
  integrityValid: boolean;
} {
  if (pkg.layers.length !== TOTAL_DNA_LAYERS) {
    return {
      ok: false,
      reason: `layer_count_${pkg.layers.length}_expected_${TOTAL_DNA_LAYERS}`,
      integrityValid: false,
    };
  }

  // Accept COMPLETE generation; VALID validation (spec "package complete")
  const complete =
    pkg.generationStatus === 'COMPLETE' ||
    (pkg.validationStatus === 'VALID' && pkg.layers.every((l) => l.validationStatus === 'VALID' || l.validationStatus === 'SKIPPED'));

  if (!complete && pkg.generationStatus !== 'COMPLETE') {
    return {
      ok: false,
      reason: `generation_status_${pkg.generationStatus}`,
      integrityValid: false,
    };
  }

  if (!pkg.overallIntegrityHash || pkg.overallIntegrityHash.length !== 64) {
    return { ok: false, reason: 'missing_integrity_hash', integrityValid: false };
  }

  if (!pkg.dnaSchemaVersion || !pkg.dnaAlgorithmVersion || !pkg.fingerprintVersion) {
    return { ok: false, reason: 'version_tuple_incomplete', integrityValid: false };
  }

  const recomputed = computeOverallIntegrityHash({
    dnaId: pkg.dnaId,
    contentId: pkg.contentId,
    mediaType: pkg.mediaType,
    dnaSchemaVersion: pkg.dnaSchemaVersion,
    dnaAlgorithmVersion: pkg.dnaAlgorithmVersion,
    fingerprintVersion: pkg.fingerprintVersion,
    generatorVersion: pkg.generatorVersion,
    integrityVersion: pkg.integrityVersion,
    dnaPackageVersion: pkg.dnaPackageVersion,
    integrityMerkleRoot: pkg.integrityMerkleRoot,
    layerIntegrityHashes: pkg.layers.map((l) => l.integrityHash),
  });

  const integrityValid = recomputed === pkg.overallIntegrityHash;
  if (!integrityValid) {
    return { ok: false, reason: 'integrity_hash_mismatch', integrityValid: false };
  }

  if (pkg.generationStatus !== 'COMPLETE') {
    // Integrity OK but not fully complete → still reject for SSoT path
    return { ok: false, reason: `generation_status_${pkg.generationStatus}`, integrityValid: true };
  }

  return { ok: true, reason: 'enterprise_package_valid', integrityValid: true };
}

/** Convert sealed package layers into compare-ready EphemeralFingerprint (identical format). */
export function enterprisePackageToEphemeralFingerprint(
  pkg: EnterpriseDnaPackage,
  meta?: { filename?: string; mimeType?: string; sizeBytes?: number },
): EphemeralFingerprint {
  const layers: EphemeralLayer[] = pkg.layers.map((l) => {
    const reg = DNA_LAYER_REGISTRY[l.layerNumber];
    return {
      layer: l.layerNumber,
      name: (reg?.name ?? l.layerName).toLowerCase().replace(/\s+/g, '_'),
      implementation: l.fingerprintAlgorithm || reg?.implementation || `L${l.layerNumber}`,
      fingerprint: l.fingerprint,
      data: {
        source: 'enterprise_dna_package',
        integrityHash: l.integrityHash,
        deterministic: l.deterministic,
      },
      success: l.validationStatus === 'VALID' && !!l.fingerprint,
    };
  });

  return {
    fileType: pkg.mediaType || 'IMAGE',
    mimeType: meta?.mimeType ?? 'application/octet-stream',
    filename: meta?.filename ?? pkg.dnaId,
    sizeBytes: meta?.sizeBytes ?? 0,
    detectedBy: 'enterprise-dna-package',
    layers,
  };
}

/**
 * Resolve vault-side fingerprint source for investigation deep compare.
 * Prefer sealed enterprise package; otherwise signal legacy fallback.
 */
export async function resolveInvestigationVaultDnaSource(
  dnaRecordId: string,
): Promise<InvestigationVaultDnaResolution> {
  const flagOn = isUseStoredDnaPrimaryEnabled();

  if (!flagOn) {
    logger.info('[InvestigationDNA] fallback regeneration path (flag off)', {
      dnaRecordId: dnaRecordId.slice(0, 8),
      reason: 'USE_STORED_DNA_PRIMARY_disabled',
    });
    return {
      mode: 'legacy_live',
      dnaRecordId,
      reason: 'feature_flag_off',
      packagePresent: false,
    };
  }

  const record = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: {
      id: true,
      imageFilename: true,
      imageMimeType: true,
      imageSizeBytes: true,
      universalFingerprints: true,
    },
  });

  if (!record) {
    logger.warn('[InvestigationDNA] migration fallback — DNA record missing', {
      dnaRecordId: dnaRecordId.slice(0, 8),
    });
    return {
      mode: 'unavailable',
      dnaRecordId,
      reason: 'dna_record_not_found',
      packagePresent: false,
    };
  }

  const pkg = parseEnterpriseDnaPackage(record.universalFingerprints);
  if (!pkg) {
    logger.info('[InvestigationDNA] migration fallback triggered — missing package', {
      dnaRecordId: dnaRecordId.slice(0, 8),
    });
    return {
      mode: 'legacy_live',
      dnaRecordId,
      reason: 'missing_enterprise_package',
      packagePresent: false,
    };
  }

  const check = isEnterprisePackageUsableForInvestigation(pkg);
  if (!check.ok) {
    logger.warn('[InvestigationDNA] integrity validation failed — fallback', {
      dnaRecordId: dnaRecordId.slice(0, 8),
      reason: check.reason,
      integrityValid: check.integrityValid,
    });
    return {
      mode: 'legacy_live',
      dnaRecordId,
      reason: check.reason,
      integrityValid: check.integrityValid,
      packagePresent: true,
    };
  }

  logger.info('[InvestigationDNA] stored package used', {
    dnaRecordId: dnaRecordId.slice(0, 8),
    integrityValid: true,
    layerCount: pkg.layers.length,
    storageStatus: pkg.storageStatus,
  });
  logger.info('[InvestigationDNA] integrity validation passed', {
    dnaRecordId: dnaRecordId.slice(0, 8),
  });

  const fingerprint = enterprisePackageToEphemeralFingerprint(pkg, {
    filename: record.imageFilename,
    mimeType: record.imageMimeType,
    sizeBytes: record.imageSizeBytes ?? 0,
  });

  return {
    mode: 'enterprise_package',
    dnaRecordId,
    fingerprint,
    reason: 'enterprise_package_valid',
    integrityValid: true,
    packagePresent: true,
  };
}
