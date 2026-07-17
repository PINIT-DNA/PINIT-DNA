/**
 * Enterprise DNA Package Storage (Milestone B Step 2).
 *
 * WHY:
 * - Persist a complete, compare-ready, integrity-hashed DNA package as SSoT.
 * - Dual-write into universalFingerprints.enterpriseDnaPackage (no DB migration).
 * - When DNA_IMMUTABLE_STORAGE is ON, sealed packages never have fingerprints overwritten.
 *
 * Does NOT touch Investigation / Comparison / Acceptance / Retrieval / APIs / UI.
 *
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md Part 4
 * @see docs/PHASE9_MIGRATION_IMPLEMENTATION_BLUEPRINT.md Milestone C (storage)
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import {
  DNA_ALGORITHM_VERSION,
  DNA_COMPARISON_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_GENERATOR_VERSION,
  DNA_INTEGRITY_VERSION,
  DNA_PACKAGE_VERSION,
  DNA_SCHEMA_VERSION,
  DNA_STORAGE_VERSION,
} from '../../config/dna-versions';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';
import { TOTAL_DNA_LAYERS } from '../../constants/dna-layers';
import { getDnaModuleEngineRole } from '../../config/dna-suite';
import { sha256Hex, stableStringify } from './deterministic-identity';
import type {
  DnaLayerValidationStatus,
  DnaPackageGenerationStatus,
  EnterpriseDnaLayerRecord,
  EnterpriseDnaPackage,
} from '../../types/enterprise-dna-package.types';
import { Prisma } from '@prisma/client';

export const ENTERPRISE_DNA_PACKAGE_KEY = 'enterpriseDnaPackage' as const;

export function isDnaImmutableStorageEnabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.DNA_IMMUTABLE_STORAGE);
}

export function isDnaIntegrityHashEnabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.DNA_INTEGRITY_HASH);
}

export function isDnaVersioningEnabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.DNA_VERSIONING);
}

/** Layer integrity = SHA-256 of compare-ready fields (excludes wall-clock duration). */
export function computeLayerIntegrityHash(input: {
  layerNumber: number;
  fingerprint: string;
  fingerprintAlgorithm: string;
  fingerprintVersion: string;
  deterministic: boolean;
}): string {
  return sha256Hex(
    stableStringify({
      layerNumber: input.layerNumber,
      fingerprint: input.fingerprint,
      fingerprintAlgorithm: input.fingerprintAlgorithm,
      fingerprintVersion: input.fingerprintVersion,
      deterministic: input.deterministic,
    }),
  );
}

export function computeIntegrityMerkleRoot(layerIntegrityHashes: readonly string[]): string {
  if (layerIntegrityHashes.length === 0) {
    return sha256Hex('empty-merkle');
  }
  let level = [...layerIntegrityHashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return level[0]!;
}

export function computeOverallFingerprintHash(fingerprints: readonly string[]): string {
  return sha256Hex(fingerprints.join('|'));
}

export function computeOverallIntegrityHash(input: {
  dnaId: string;
  contentId: string;
  mediaType: string;
  dnaSchemaVersion: string;
  dnaAlgorithmVersion: string;
  fingerprintVersion: string;
  generatorVersion: string;
  integrityVersion: string;
  dnaPackageVersion: string;
  integrityMerkleRoot: string;
  layerIntegrityHashes: readonly string[];
}): string {
  return sha256Hex(
    stableStringify({
      dnaId: input.dnaId,
      contentId: input.contentId,
      mediaType: input.mediaType,
      dnaSchemaVersion: input.dnaSchemaVersion,
      dnaAlgorithmVersion: input.dnaAlgorithmVersion,
      fingerprintVersion: input.fingerprintVersion,
      generatorVersion: input.generatorVersion,
      integrityVersion: input.integrityVersion,
      dnaPackageVersion: input.dnaPackageVersion,
      integrityMerkleRoot: input.integrityMerkleRoot,
      layers: input.layerIntegrityHashes,
    }),
  );
}

export function buildEnterpriseDnaLayer(input: {
  layerNumber: number;
  fingerprint: string;
  fingerprintAlgorithm: string;
  generationTime?: string;
  generationDurationMs?: number;
  deterministic?: boolean;
  present: boolean;
}): EnterpriseDnaLayerRecord {
  const reg = DNA_LAYER_REGISTRY[input.layerNumber];
  const fingerprint = input.present ? (input.fingerprint || '') : '';
  const deterministic = input.deterministic ?? (input.layerNumber <= 10);
  const fingerprintVersion = DNA_FINGERPRINT_VERSION;
  const fingerprintAlgorithm = input.fingerprintAlgorithm || reg?.implementation || `L${input.layerNumber}`;

  let validationStatus: DnaLayerValidationStatus;
  if (!input.present) validationStatus = 'MISSING';
  else if (!fingerprint) validationStatus = 'INVALID';
  else validationStatus = 'VALID';

  const integrityHash = computeLayerIntegrityHash({
    layerNumber: input.layerNumber,
    fingerprint,
    fingerprintAlgorithm,
    fingerprintVersion,
    deterministic,
  });

  const engineRole = getDnaModuleEngineRole(input.layerNumber);

  return {
    layerNumber: input.layerNumber,
    layerName: reg?.name ?? `Layer ${input.layerNumber}`,
    fingerprint,
    fingerprintAlgorithm,
    fingerprintVersion,
    fingerprintSize: fingerprint.length,
    generationTime: input.generationTime ?? new Date().toISOString(),
    generationDurationMs: input.generationDurationMs ?? 0,
    deterministic,
    validationStatus,
    integrityHash,
    storageStatus: 'SEALED',
    engine: engineRole,
  };
}

export function validateEnterpriseDnaPackage(pkg: EnterpriseDnaPackage): {
  ok: boolean;
  generationStatus: DnaPackageGenerationStatus;
  validationStatus: EnterpriseDnaPackage['validationStatus'];
  reasons: string[];
} {
  const reasons: string[] = [];
  if (pkg.layers.length !== TOTAL_DNA_LAYERS) {
    reasons.push(`expected ${TOTAL_DNA_LAYERS} layers, got ${pkg.layers.length}`);
  }
  const missing = pkg.layers.filter((l) => l.validationStatus === 'MISSING');
  const invalid = pkg.layers.filter((l) => l.validationStatus === 'INVALID');
  if (missing.length) reasons.push(`missing layers: ${missing.map((l) => l.layerNumber).join(',')}`);
  if (invalid.length) reasons.push(`invalid layers: ${invalid.map((l) => l.layerNumber).join(',')}`);
  if (!pkg.overallIntegrityHash || pkg.overallIntegrityHash.length !== 64) {
    reasons.push('overallIntegrityHash missing or malformed');
  }
  if (!pkg.overallFingerprintHash || pkg.overallFingerprintHash.length !== 64) {
    reasons.push('overallFingerprintHash missing or malformed');
  }
  if (isDnaVersioningEnabled()) {
    if (!pkg.dnaSchemaVersion || !pkg.dnaAlgorithmVersion || !pkg.fingerprintVersion) {
      reasons.push('version tuple incomplete');
    }
  }

  const validCount = pkg.layers.filter((l) => l.validationStatus === 'VALID').length;
  let generationStatus: DnaPackageGenerationStatus;
  if (validCount === TOTAL_DNA_LAYERS && reasons.length === 0) generationStatus = 'COMPLETE';
  else if (validCount > 0) generationStatus = 'PARTIAL';
  else generationStatus = 'FAILED';

  const validationStatus =
    generationStatus === 'COMPLETE' && reasons.length === 0 ? 'VALID' : 'INVALID';

  return {
    ok: validationStatus === 'VALID',
    generationStatus,
    validationStatus,
    reasons,
  };
}

export function assembleEnterpriseDnaPackage(input: {
  dnaId: string;
  ownerId: string | null;
  assetId: string | null;
  mediaType: string;
  contentId: string;
  creationTime: string;
  layers: EnterpriseDnaLayerRecord[];
}): EnterpriseDnaPackage {
  // Ensure exactly 15 slots
  const byNum = new Map(input.layers.map((l) => [l.layerNumber, l]));
  const layers: EnterpriseDnaLayerRecord[] = [];
  for (let n = 1; n <= TOTAL_DNA_LAYERS; n++) {
    layers.push(
      byNum.get(n) ??
        buildEnterpriseDnaLayer({
          layerNumber: n,
          fingerprint: '',
          fingerprintAlgorithm: DNA_LAYER_REGISTRY[n]?.implementation ?? `L${n}`,
          present: false,
          deterministic: n <= 10,
        }),
    );
  }

  const layerIntegrityHashes = layers.map((l) => l.integrityHash);
  const integrityMerkleRoot = isDnaIntegrityHashEnabled()
    ? computeIntegrityMerkleRoot(layerIntegrityHashes)
    : sha256Hex('integrity-disabled');
  const overallFingerprintHash = computeOverallFingerprintHash(layers.map((l) => l.fingerprint));
  const overallIntegrityHash = isDnaIntegrityHashEnabled()
    ? computeOverallIntegrityHash({
        dnaId: input.dnaId,
        contentId: input.contentId,
        mediaType: input.mediaType,
        dnaSchemaVersion: DNA_SCHEMA_VERSION,
        dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
        fingerprintVersion: DNA_FINGERPRINT_VERSION,
        generatorVersion: DNA_GENERATOR_VERSION,
        integrityVersion: DNA_INTEGRITY_VERSION,
        dnaPackageVersion: DNA_PACKAGE_VERSION,
        integrityMerkleRoot,
        layerIntegrityHashes,
      })
    : sha256Hex('integrity-disabled');

  const draft: EnterpriseDnaPackage = {
    schema: 'enterprise-dna-package-v1',
    dnaId: input.dnaId,
    ownerId: input.ownerId,
    assetId: input.assetId,
    mediaType: input.mediaType,
    creationTime: input.creationTime,
    dnaSchemaVersion: DNA_SCHEMA_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    fingerprintVersion: DNA_FINGERPRINT_VERSION,
    generatorVersion: DNA_GENERATOR_VERSION,
    integrityVersion: DNA_INTEGRITY_VERSION,
    dnaPackageVersion: DNA_PACKAGE_VERSION,
    storageVersion: DNA_STORAGE_VERSION,
    comparisonVersion: DNA_COMPARISON_VERSION,
    generationStatus: 'PARTIAL',
    validationStatus: 'PENDING',
    storageStatus: 'PENDING',
    overallIntegrityHash,
    overallFingerprintHash,
    integrityMerkleRoot,
    contentId: input.contentId,
    layers,
    sealedAt: null,
  };

  const validation = validateEnterpriseDnaPackage(draft);
  draft.generationStatus = validation.generationStatus;
  draft.validationStatus = validation.validationStatus;

  if (isDnaImmutableStorageEnabled() && validation.ok) {
    draft.storageStatus = 'SEALED';
    draft.sealedAt = new Date().toISOString();
  } else if (validation.ok) {
    draft.storageStatus = 'SEALED';
    draft.sealedAt = new Date().toISOString();
  } else {
    draft.storageStatus = 'PENDING';
    draft.sealedAt = null;
  }

  return draft;
}

/**
 * Merge JSON into universalFingerprints without overwriting a sealed enterprise package.
 * Sidecars (enhancements, selfLearning, transformationHistory) may still update.
 */
export function mergeUniversalFingerprintsImmutable(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object'
      ? { ...(existing as object) }
      : ({} as Record<string, unknown>);

  const existingPkg = base[ENTERPRISE_DNA_PACKAGE_KEY] as EnterpriseDnaPackage | undefined;
  const sealed =
    isDnaImmutableStorageEnabled() &&
    existingPkg &&
    existingPkg.storageStatus === 'SEALED' &&
    !!existingPkg.overallIntegrityHash;

  for (const [key, value] of Object.entries(patch)) {
    if (key === ENTERPRISE_DNA_PACKAGE_KEY && sealed) {
      // WHY: never overwrite sealed fingerprints / integrity (EDS P1–P2)
      logger.warn('[EnterpriseDNA] refused overwrite of sealed enterpriseDnaPackage', {
        dnaId: existingPkg.dnaId,
      });
      continue;
    }
    base[key] = value;
  }
  return base;
}

export function parseEnterpriseDnaPackage(universalFingerprints: unknown): EnterpriseDnaPackage | null {
  if (!universalFingerprints || typeof universalFingerprints !== 'object') return null;
  const pkg = (universalFingerprints as Record<string, unknown>)[ENTERPRISE_DNA_PACKAGE_KEY];
  if (!pkg || typeof pkg !== 'object') return null;
  return pkg as EnterpriseDnaPackage;
}

type DnaRecordForPackage = {
  id: string;
  ownerUserId: string | null;
  fileType: string | null;
  imageMimeType: string;
  createdAt: Date;
  sha256Hash: string | null;
  universalFingerprints: unknown;
  cryptoLayer: { sha256Hash: string; createdAt?: Date } | null;
  structuralLayer: { edgeSignature64: string | null; createdAt?: Date } | null;
  perceptualLayer: { pHash64: string | null; createdAt?: Date } | null;
  semanticLayer: { colorFingerprint: string | null; createdAt?: Date } | null;
  metadataLayer: { metadataHash: string; createdAt?: Date } | null;
  stegoLayer: { payloadHmac: string; createdAt?: Date } | null;
  behavioralLayer: { behaviorHash: string; processingMs: number; createdAt?: Date } | null;
  relationshipLayer: { graphHash: string | null; processingMs: number; createdAt?: Date } | null;
  originLayer: { bundleHash: string; processingMs: number; createdAt?: Date } | null;
  evolutionLayer: { merkleRoot: string | null; processingMs: number; createdAt?: Date } | null;
  deepfakeLayer: { deepfakeScore: number; modelVersion: string; createdAt?: Date } | null;
  dctWatermarkLayer: { watermarkHash: string; createdAt?: Date } | null;
  custodyLayer: { evidenceHash: string | null; createdAt?: Date } | null;
  zkProofLayer: { commitmentHash: string; createdAt?: Date } | null;
  biometricBindLayer: { biometricHash: string; createdAt?: Date } | null;
  vaultRecord: { id: string } | null;
};

function iso(d?: Date | null): string {
  return (d ?? new Date()).toISOString();
}

/** Extract compare-ready fingerprints from persisted layer tables + universal JSON. */
export function extractLayersFromDnaRecord(record: DnaRecordForPackage): EnterpriseDnaLayerRecord[] {
  const fp = record.universalFingerprints as { layers?: Array<{ layer: number; fingerprint?: string; implementation?: string; processingMs?: number }> } | null;
  const jsonLayers = Array.isArray(fp?.layers) ? fp!.layers! : [];
  const jsonByLayer = new Map(jsonLayers.map((l) => [l.layer, l]));

  // Prefer identityDeterministic compare fingerprints when present (B1 dual-write)
  const identity = (record.universalFingerprints as { identityDeterministic?: { modules?: Array<{ moduleId: number; fingerprint: string; algorithmId: string }>; contentSealHmac?: string; claimsDigest?: string } } | null)?.identityDeterministic;
  const idMods = new Map((identity?.modules ?? []).map((m) => [m.moduleId, m]));

  const layers: EnterpriseDnaLayerRecord[] = [];

  const push = (
    n: number,
    fingerprint: string,
    algorithm: string,
    present: boolean,
    deterministic: boolean,
    durationMs = 0,
    generationTime?: string,
  ) => {
    layers.push(
      buildEnterpriseDnaLayer({
        layerNumber: n,
        fingerprint,
        fingerprintAlgorithm: algorithm,
        present,
        deterministic,
        generationDurationMs: durationMs,
        generationTime,
      }),
    );
  };

  // L1–L6: image tables or universal JSON
  const l1 = idMods.get(1)?.fingerprint ?? record.cryptoLayer?.sha256Hash ?? record.sha256Hash ?? jsonByLayer.get(1)?.fingerprint ?? '';
  push(1, l1, idMods.get(1)?.algorithmId ?? 'L1-sha256-v1', !!l1, true, 0, iso(record.cryptoLayer?.createdAt));

  const l2 = idMods.get(2)?.fingerprint ?? record.structuralLayer?.edgeSignature64 ?? jsonByLayer.get(2)?.fingerprint ?? '';
  push(2, l2, idMods.get(2)?.algorithmId ?? 'L2-sobel-8x8-v1', !!l2, true, 0, iso(record.structuralLayer?.createdAt));

  const l3 = idMods.get(3)?.fingerprint ?? record.perceptualLayer?.pHash64 ?? jsonByLayer.get(3)?.fingerprint ?? '';
  push(3, l3, idMods.get(3)?.algorithmId ?? 'L3-phash-dct-64-v1', !!l3, true, 0, iso(record.perceptualLayer?.createdAt));

  const l4 = idMods.get(4)?.fingerprint ?? record.semanticLayer?.colorFingerprint ?? jsonByLayer.get(4)?.fingerprint ?? '';
  push(4, l4, idMods.get(4)?.algorithmId ?? 'L4-hist-v1', !!l4, true, 0, iso(record.semanticLayer?.createdAt));

  const l5 = idMods.get(5)?.fingerprint ?? identity?.claimsDigest ?? record.metadataLayer?.metadataHash ?? jsonByLayer.get(5)?.fingerprint ?? '';
  push(5, l5, idMods.get(5)?.algorithmId ?? 'L5-claims-digest-v1', !!l5, true, 0, iso(record.metadataLayer?.createdAt));

  const l6 = idMods.get(6)?.fingerprint ?? identity?.contentSealHmac ?? record.stegoLayer?.payloadHmac ?? jsonByLayer.get(6)?.fingerprint ?? '';
  push(6, l6, idMods.get(6)?.algorithmId ?? 'L6-content-seal-v1', !!l6, true, 0, iso(record.stegoLayer?.createdAt));

  const l7 = idMods.get(7)?.fingerprint ?? record.behavioralLayer?.behaviorHash ?? '';
  push(7, l7, idMods.get(7)?.algorithmId ?? 'L7-content-v1', !!l7, true, record.behavioralLayer?.processingMs ?? 0, iso(record.behavioralLayer?.createdAt));

  const l8 = idMods.get(8)?.fingerprint ?? record.relationshipLayer?.graphHash ?? '';
  push(8, l8, idMods.get(8)?.algorithmId ?? 'L8-family-v1', !!l8, true, record.relationshipLayer?.processingMs ?? 0, iso(record.relationshipLayer?.createdAt));

  const l9 = idMods.get(9)?.fingerprint ?? record.originLayer?.bundleHash ?? '';
  push(9, l9, idMods.get(9)?.algorithmId ?? 'L9-xmod-v1', !!l9, true, record.originLayer?.processingMs ?? 0, iso(record.originLayer?.createdAt));

  const l10 = idMods.get(10)?.fingerprint ?? record.evolutionLayer?.merkleRoot ?? '';
  push(10, l10, idMods.get(10)?.algorithmId ?? 'L10-lineage-v1', !!l10, true, record.evolutionLayer?.processingMs ?? 0, iso(record.evolutionLayer?.createdAt));

  // L11–L15 evidence/ownership — may be non-deterministic; still stored for package completeness
  const l11fp = record.deepfakeLayer
    ? sha256Hex(`L11:${record.deepfakeLayer.deepfakeScore}:${record.deepfakeLayer.modelVersion}`)
    : '';
  push(11, l11fp, record.deepfakeLayer?.modelVersion ?? 'L11-deepfake', !!record.deepfakeLayer, false, 0, iso(record.deepfakeLayer?.createdAt));

  const l12fp = record.dctWatermarkLayer?.watermarkHash ?? '';
  push(12, l12fp, 'L12-dct-mark-v1', !!record.dctWatermarkLayer, false, 0, iso(record.dctWatermarkLayer?.createdAt));

  const l13fp = record.custodyLayer?.evidenceHash ?? '';
  push(13, l13fp, 'L13-custody-anchor-v1', !!record.custodyLayer, false, 0, iso(record.custodyLayer?.createdAt));

  const l14fp = record.zkProofLayer?.commitmentHash ?? '';
  push(14, l14fp, 'L14-commit-v1', !!record.zkProofLayer, false, 0, iso(record.zkProofLayer?.createdAt));

  const l15fp = record.biometricBindLayer?.biometricHash ?? '';
  push(15, l15fp, 'L15-subject-bind-v1', !!record.biometricBindLayer, false, 0, iso(record.biometricBindLayer?.createdAt));

  return layers;
}

const PACKAGE_INCLUDE = {
  cryptoLayer: true,
  structuralLayer: true,
  perceptualLayer: true,
  semanticLayer: true,
  metadataLayer: true,
  stegoLayer: true,
  behavioralLayer: true,
  relationshipLayer: true,
  originLayer: true,
  evolutionLayer: true,
  deepfakeLayer: true,
  dctWatermarkLayer: true,
  custodyLayer: true,
  zkProofLayer: true,
  biometricBindLayer: true,
  vaultRecord: { select: { id: true } },
} as const;

/**
 * Build + persist enterprise DNA package for a DNA record (storage-only).
 * Idempotent under immutability: will not replace a sealed package.
 */
export async function persistEnterpriseDnaPackage(dnaRecordId: string): Promise<EnterpriseDnaPackage | null> {
  logger.info('[EnterpriseDNA] package creation started', { dnaRecordId });

  const record = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    include: PACKAGE_INCLUDE,
  });
  if (!record) {
    logger.warn('[EnterpriseDNA] package creation failed — record missing', { dnaRecordId });
    return null;
  }

  const existing = parseEnterpriseDnaPackage(record.universalFingerprints);
  if (
    isDnaImmutableStorageEnabled() &&
    existing?.storageStatus === 'SEALED' &&
    existing.overallIntegrityHash
  ) {
    logger.info('[EnterpriseDNA] package already sealed — skip rewrite', {
      dnaRecordId,
      integrityHashLen: existing.overallIntegrityHash.length,
    });
    return existing;
  }

  const layerRows = extractLayersFromDnaRecord(record as unknown as DnaRecordForPackage);
  logger.debug('[EnterpriseDNA] layer persistence snapshot', {
    dnaRecordId,
    layerCount: layerRows.length,
    validLayers: layerRows.filter((l) => l.validationStatus === 'VALID').length,
  });

  const contentId = record.sha256Hash || record.cryptoLayer?.sha256Hash || '';
  const pkg = assembleEnterpriseDnaPackage({
    dnaId: record.id,
    ownerId: record.ownerUserId,
    assetId: record.vaultRecord?.id ?? null,
    mediaType: record.fileType ?? (record.imageMimeType?.startsWith('image/') ? 'IMAGE' : 'FILE'),
    contentId,
    creationTime: record.createdAt.toISOString(),
    layers: layerRows,
  });

  logger.info('[EnterpriseDNA] integrity generation', {
    dnaRecordId,
    integrityHashLen: pkg.overallIntegrityHash.length,
    fingerprintHashLen: pkg.overallFingerprintHash.length,
    merkleLen: pkg.integrityMerkleRoot.length,
    generationStatus: pkg.generationStatus,
    validationStatus: pkg.validationStatus,
  });

  const validation = validateEnterpriseDnaPackage(pkg);
  logger.info('[EnterpriseDNA] validation', {
    dnaRecordId,
    ok: validation.ok,
    generationStatus: validation.generationStatus,
    reasonCount: validation.reasons.length,
  });

  const merged = mergeUniversalFingerprintsImmutable(record.universalFingerprints, {
    [ENTERPRISE_DNA_PACKAGE_KEY]: pkg,
  });

  await prisma.dnaRecord.update({
    where: { id: dnaRecordId },
    data: { universalFingerprints: merged as Prisma.InputJsonValue },
  });

  // Align DnaRecord.status with package generationStatus when PARTIAL/COMPLETE
  if (pkg.generationStatus === 'COMPLETE' || pkg.generationStatus === 'PARTIAL') {
    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status: pkg.generationStatus },
    });
  }

  logger.info('[EnterpriseDNA] package completion', {
    dnaRecordId,
    storageStatus: pkg.storageStatus,
    generationStatus: pkg.generationStatus,
    validationStatus: pkg.validationStatus,
    sealed: pkg.storageStatus === 'SEALED',
  });

  return pkg;
}
