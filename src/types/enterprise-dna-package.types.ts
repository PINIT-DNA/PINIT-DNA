/**
 * Enterprise DNA Package types (Milestone B Step 2 / EDS Part 4).
 *
 * Stored additively under DnaRecord.universalFingerprints.enterpriseDnaPackage
 * — no Prisma schema migration. Future Comparison reads these fingerprints
 * verbatim (compare-ready format).
 */

export type DnaPackageStorageStatus = 'PENDING' | 'SEALED';
export type DnaPackageValidationStatus = 'PENDING' | 'VALID' | 'INVALID';
export type DnaPackageGenerationStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED';
export type DnaLayerValidationStatus = 'VALID' | 'INVALID' | 'MISSING' | 'SKIPPED';

/** Per-layer compare-ready fingerprint row (EDS module row + Task B2 fields). */
export interface EnterpriseDnaLayerRecord {
  layerNumber: number;
  layerName: string;
  fingerprint: string;
  fingerprintAlgorithm: string;
  fingerprintVersion: string;
  fingerprintSize: number;
  generationTime: string;
  generationDurationMs: number;
  deterministic: boolean;
  validationStatus: DnaLayerValidationStatus;
  integrityHash: string;
  storageStatus: DnaPackageStorageStatus;
  /** EDS engine role hint */
  engine?: 'identity' | 'ownership' | 'evidence';
}

/** Complete immutable enterprise DNA package (SSoT for later Investigation). */
export interface EnterpriseDnaPackage {
  schema: 'enterprise-dna-package-v1';
  dnaId: string;
  ownerId: string | null;
  assetId: string | null;
  mediaType: string;
  creationTime: string;
  dnaSchemaVersion: string;
  dnaAlgorithmVersion: string;
  fingerprintVersion: string;
  generatorVersion: string;
  integrityVersion: string;
  dnaPackageVersion: string;
  storageVersion: string;
  comparisonVersion: string;
  generationStatus: DnaPackageGenerationStatus;
  validationStatus: DnaPackageValidationStatus;
  storageStatus: DnaPackageStorageStatus;
  /** SHA-256 over package header + layer integrity hashes (EDS integrity_hash) */
  overallIntegrityHash: string;
  /** SHA-256 over ordered layer fingerprints only (compare shortcut) */
  overallFingerprintHash: string;
  /** Merkle-style root over layer integrity hashes */
  integrityMerkleRoot: string;
  contentId: string;
  layers: EnterpriseDnaLayerRecord[];
  sealedAt: string | null;
}
