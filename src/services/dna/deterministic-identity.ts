/**
 * Deterministic Identity Fingerprints (Milestone B Step 1 / EDS Part 2 + Part 7).
 *
 * WHY: L1–L10 identity must depend only on file content — never Date.now, uuid,
 * randomBytes, session, upload time, or user id. L11–L15 may use runtime data
 * but must not mutate these digests.
 *
 * Dual-write: legacy fields may still exist; identityDeterministic holds the
 * compare-stable package Investigation will read in later milestones.
 *
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md L5–L10, Part 7
 * @see docs/PHASE9_MIGRATION_IMPLEMENTATION_BLUEPRINT.md Milestone B
 */

import crypto from 'crypto';
import {
  DNA_ALGORITHM_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_GENERATOR_VERSION,
  DNA_SCHEMA_VERSION,
} from '../../config/dna-versions';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';

/** EDS content seal algorithm id */
export const CONTENT_SEAL_ALGORITHM_ID = 'L6-content-seal-v1' as const;
/** EDS claims digest algorithm id */
export const CLAIMS_DIGEST_ALGORITHM_ID = 'L5-claims-digest-v1' as const;

export interface IdentityModuleFingerprint {
  moduleId: number;
  fingerprint: string;
  algorithmId: string;
  fingerprintVersion: typeof DNA_FINGERPRINT_VERSION;
  status: 'COMPLETE' | 'FAILED' | 'SKIPPED';
  deterministic: true;
}

export interface IdentityDeterministicPackage {
  /** Package marker — Investigation dual-reads this in Milestone D */
  schema: 'identity-deterministic-v1';
  deterministic: true;
  algorithmVersion: typeof DNA_ALGORITHM_VERSION;
  fingerprintVersion: typeof DNA_FINGERPRINT_VERSION;
  generatorVersion: typeof DNA_GENERATOR_VERSION;
  schemaVersion: typeof DNA_SCHEMA_VERSION;
  generationStatus: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  mediaType: string;
  /** L1 content_id (sha256 of canonical bytes) */
  contentId: string;
  claimsDigest: string;
  contentSealHmac: string;
  /** Optional ownership-trace HMAC (random LSB) — NOT identity */
  stegoTraceHmac?: string;
  modules: IdentityModuleFingerprint[];
  generatedAtMeta: string; // wall-clock metadata only — not hashed into fingerprints
}

/** Stable JSON stringify (sorted keys) for deterministic hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * L5 claims_digest — content/claims only (EDS).
 * Excludes dnaRecordId, generatedAt, session, user.
 */
export function computeClaimsDigest(input: {
  exifData: Record<string, unknown> | null;
  layer1HashRef: string | null;
  tool?: string;
  version?: string;
}): string {
  const payload = {
    exif: input.exifData ? sortKeysShallow(input.exifData) : null,
    layer1HashRef: input.layer1HashRef,
    tool: input.tool ?? 'PINIT-DNA',
    version: input.version ?? DNA_SCHEMA_VERSION,
  };
  return sha256Hex(stableStringify(payload));
}

/**
 * L6 content_seal — HMAC over L1–L5 digests (EDS SEAL:v1).
 * Never includes dnaRecordId or random token.
 */
export function computeContentSealHmac(
  mediaType: string,
  digestsL1toL5: readonly string[],
  secret: string,
): string {
  const joined = digestsL1toL5.join('|');
  const payload = `SEAL:v1:${mediaType}:${joined}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Universal-engine L6 seal — same SEAL:v1 without dnaRecordId.
 * WHY: previous engines used `TYPE:dnaRecordId:fps` which varied every upload.
 */
export function computeUniversalContentSeal(
  mediaType: string,
  fingerprintsJoined: string,
  secret: string,
): string {
  return computeContentSealHmac(mediaType, fingerprintsJoined.split('|'), secret);
}

/** L8 family_id — SHA-256("FAM:v1" ‖ L3_bucket ‖ L1_prefix) */
export function computeFamilyId(contentId: string, perceptualPrimary: string): string {
  const l3Bucket = (perceptualPrimary || 'none').slice(0, 16);
  const l1Prefix = (contentId || 'none').slice(0, 16);
  return sha256Hex(`FAM:v1|${l3Bucket}|${l1Prefix}`);
}

/**
 * L7 interim content fragment digest (until full patch-grid engine lands).
 * Content-only: L1 + L3 primary.
 */
export function computeLocalPatchIdentityDigest(contentId: string, perceptualPrimary: string): string {
  return sha256Hex(`L7:content:v1|${contentId}|${perceptualPrimary || 'none'}`);
}

/**
 * L9 interim cross-modal descriptor (content-only sketch).
 */
export function computeCrossModalDescriptor(contentId: string, mediaType: string): string {
  return sha256Hex(`XMOD:v1|${mediaType}|${contentId}`);
}

/**
 * L10 lineage merkle head — no wall-clock in leaf (EDS).
 */
export function computeLineageMerkleHead(contentId: string, relationType = 'ORIGIN'): string {
  const leaf = sha256Hex(`${contentId}|none|${relationType}`);
  return leaf;
}

export function isDnaDeterministicModeEnabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.DNA_DETERMINISTIC_MODE);
}

function sortKeysShallow(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

export function buildIdentityDeterministicPackage(input: {
  mediaType: string;
  contentId: string;
  claimsDigest: string;
  contentSealHmac: string;
  stegoTraceHmac?: string;
  modules: Array<{
    moduleId: number;
    fingerprint: string;
    algorithmId: string;
    status: 'COMPLETE' | 'FAILED' | 'SKIPPED';
  }>;
}): IdentityDeterministicPackage {
  const complete = input.modules.filter((m) => m.status === 'COMPLETE').length;
  const failed = input.modules.filter((m) => m.status === 'FAILED').length;
  const generationStatus =
    failed === 0 && complete === input.modules.length
      ? 'COMPLETE'
      : complete > 0
        ? 'PARTIAL'
        : 'FAILED';

  return {
    schema: 'identity-deterministic-v1',
    deterministic: true,
    algorithmVersion: DNA_ALGORITHM_VERSION,
    fingerprintVersion: DNA_FINGERPRINT_VERSION,
    generatorVersion: DNA_GENERATOR_VERSION,
    schemaVersion: DNA_SCHEMA_VERSION,
    generationStatus,
    mediaType: input.mediaType,
    contentId: input.contentId,
    claimsDigest: input.claimsDigest,
    contentSealHmac: input.contentSealHmac,
    stegoTraceHmac: input.stegoTraceHmac,
    modules: input.modules.map((m) => ({
      ...m,
      fingerprintVersion: DNA_FINGERPRINT_VERSION,
      deterministic: true as const,
    })),
    generatedAtMeta: new Date().toISOString(),
  };
}

/** Merge identity package into universalFingerprints JSON (no schema migration). */
export function mergeIdentityDeterministicPackage(
  existing: unknown,
  identityPackage: IdentityDeterministicPackage | undefined,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object'
      ? { ...(existing as object) }
      : ({} as Record<string, unknown>);
  if (identityPackage) {
    (base as Record<string, unknown>).identityDeterministic = identityPackage;
  }
  return base as Record<string, unknown>;
}
