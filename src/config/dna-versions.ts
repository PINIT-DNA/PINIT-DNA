/**
 * Global DNA Version Contracts (Task A1 / Phase 10 Part 7).
 *
 * WHY this file exists:
 * - Single source of truth for system / DNA / investigation version identifiers.
 * - Prevents duplicated hardcoded version strings drifting across modules.
 * - Values are frozen to TODAY'S production strings so behaviour, APIs, and
 *   stored DNA remain identical (no generation / comparison / acceptance change).
 *
 * DO NOT bump these without an EDS revision and an explicit migration plan.
 * Env overrides (DNA_SCHEMA_VERSION, DNA_ENGINE_VERSION) remain supported in
 * config/index.ts — those defaults MUST stay equal to the constants below.
 *
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md Part 7 — VERSIONING CONTRACT
 */

/** Product / package semver — matches package.json "version". */
export const SYSTEM_VERSION = '1.0.0' as const;

/**
 * DNA package structure / table contract (EDS schema_version).
 * Existing default: config.dna.schemaVersion → '1.0.0'.
 */
export const DNA_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Suite of module algorithms (EDS algorithm_version).
 * Existing: ACCEPTANCE / investigation "15-layer-v1".
 */
export const DNA_ALGORITHM_VERSION = '15-layer-v1' as const;

/**
 * Fingerprint construction suite (EDS fingerprint_version).
 * WHY equal to DNA_ALGORITHM_VERSION today: fingerprints are built under the
 * same 15-layer-v1 suite; a distinct id will be introduced when construction
 * diverges. Defining the constant now avoids inventing a new persisted string.
 */
export const DNA_FINGERPRINT_VERSION = '15-layer-v1' as const;

/**
 * Generator binary / universal engine id (EDS generator_version).
 * Existing: UNIVERSAL_ENGINE_VERSION / DNA_ENGINE_VERSION default → '2.0.0-universal'.
 */
export const DNA_GENERATOR_VERSION = '2.0.0-universal' as const;

/**
 * Comparison weights / similarity suite id (EDS comparison_version).
 * Existing comparison-engine ENGINE_VERSION emits '2.0.0-universal'.
 * WHY same string as generator today: comparison has not yet been split into a
 * separate policy id; Milestone D+ may introduce a distinct comparison suite.
 */
export const DNA_COMPARISON_VERSION = '2.0.0-universal' as const;

/**
 * Acceptance / verdict policy id (EDS acceptance_version).
 * Existing: ACCEPTANCE_POLICY_VERSION → 'acceptance-policy-v1.2'.
 */
export const DNA_ACCEPTANCE_VERSION = 'acceptance-policy-v1.2' as const;

/**
 * DNA storage contract id (persistence layout).
 * WHY equal to DNA_SCHEMA_VERSION today: storage shape tracks schema_version;
 * a distinct storage id will be introduced when storage layout diverges.
 */
export const DNA_STORAGE_VERSION = '1.0.0' as const;

/**
 * Integrity hash algorithm / package integrity contract id (Milestone B Step 2).
 * Used when hashing sealed enterprise DNA packages.
 */
export const DNA_INTEGRITY_VERSION = 'integrity-sha256-v1' as const;

/**
 * Enterprise DNA Package document schema id (stored in universalFingerprints).
 */
export const DNA_PACKAGE_VERSION = 'enterprise-dna-package-v1' as const;

/**
 * Investigation pipeline engine contract id.
 * No prior distinct hardcoded engine id existed; '1.0.0' aligns with SYSTEM_VERSION
 * so introducing this constant does not invent a new API/report field value.
 * Not wired into investigation outputs in Task A1 (definitions only).
 */
export const INVESTIGATION_ENGINE_VERSION = '1.0.0' as const;

/**
 * Investigation / evidence report schema id.
 * Existing: INVESTIGATION_MANIFEST_VERSION → 'investigation-manifest-v1.0'.
 */
export const REPORT_VERSION = 'investigation-manifest-v1.0' as const;

/** Frozen bundle for tests / diagnostics — do not mutate. */
export const DNA_VERSION_CONTRACT = {
  SYSTEM_VERSION,
  DNA_SCHEMA_VERSION,
  DNA_ALGORITHM_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_GENERATOR_VERSION,
  DNA_COMPARISON_VERSION,
  DNA_ACCEPTANCE_VERSION,
  DNA_STORAGE_VERSION,
  DNA_INTEGRITY_VERSION,
  DNA_PACKAGE_VERSION,
  INVESTIGATION_ENGINE_VERSION,
  REPORT_VERSION,
} as const;
