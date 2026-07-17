/**
 * Enterprise Feature Flag Framework (Task A2).
 *
 * WHY this file exists:
 * - Single registry for all enterprise migration flags (Phase 9 milestones B→L).
 * - Prevents magic strings / duplicated env parsers across services.
 * - Defaults preserve TODAY'S production behaviour — this module alone does not
 *   change DNA generation, investigation, comparison, acceptance, retrieval,
 *   vault, monitoring, APIs, DB, or frontend. Future milestones MUST gate new
 *   behaviour behind `isEnterpriseFeatureEnabled(...)`.
 *
 * Consumption pattern (future milestones — do not wire here):
 *   if (isEnterpriseFeatureEnabled('COMPARISON_V2')) { ... new path ... }
 *   else { ... legacy path ... }
 *
 * Env override: each flag reads `process.env[envKey]` (and optional legacy keys).
 * Truthy: 1|true|yes|on  Falsy: 0|false|no|off  Missing → defaultValue.
 *
 * @see docs/PHASE9_MIGRATION_IMPLEMENTATION_BLUEPRINT.md
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md
 */

import { SYSTEM_VERSION } from './dna-versions';

/** Flag taxonomy groups — matches Task A2 specification. */
export const FEATURE_FLAG_CATEGORY = {
  DNA_GENERATION: 'DNA_GENERATION',
  RETRIEVAL: 'RETRIEVAL',
  COMPARISON: 'COMPARISON',
  ACCEPTANCE: 'ACCEPTANCE',
  INVESTIGATION: 'INVESTIGATION',
  PERFORMANCE: 'PERFORMANCE',
} as const;

export type FeatureFlagCategory =
  (typeof FEATURE_FLAG_CATEGORY)[keyof typeof FEATURE_FLAG_CATEGORY];

/**
 * Canonical flag names — use these constants instead of string literals.
 * Extending: add to this union + ENTERPRISE_FEATURE_FLAG_REGISTRY in one change.
 */
export const ENTERPRISE_FEATURE_FLAG = {
  // Group 1 — DNA Generation
  DNA_V2_ENABLED: 'DNA_V2_ENABLED',
  DNA_DETERMINISTIC_MODE: 'DNA_DETERMINISTIC_MODE',
  DNA_IMMUTABLE_STORAGE: 'DNA_IMMUTABLE_STORAGE',
  DNA_INTEGRITY_HASH: 'DNA_INTEGRITY_HASH',
  DNA_VERSIONING: 'DNA_VERSIONING',

  // Group 2 — Retrieval
  RECALL_ENGINE_V2: 'RECALL_ENGINE_V2',
  ANN_RETRIEVAL: 'ANN_RETRIEVAL',
  PATCH_DNA_ENGINE: 'PATCH_DNA_ENGINE',
  IDENTITY_SHORTCUTS: 'IDENTITY_SHORTCUTS',
  VISUAL_RETRIEVAL_V2: 'VISUAL_RETRIEVAL_V2',

  // Group 3 — Comparison
  COMPARISON_V2: 'COMPARISON_V2',
  USE_STORED_DNA_PRIMARY: 'USE_STORED_DNA_PRIMARY',
  LIVE_DNA_AUDIT_ONLY: 'LIVE_DNA_AUDIT_ONLY',
  ENABLE_LAYER11_COMPARE: 'ENABLE_LAYER11_COMPARE',
  ENABLE_LAYER12_COMPARE: 'ENABLE_LAYER12_COMPARE',
  ENABLE_LAYER13_COMPARE: 'ENABLE_LAYER13_COMPARE',
  ENABLE_LAYER14_COMPARE: 'ENABLE_LAYER14_COMPARE',
  ENABLE_LAYER15_COMPARE: 'ENABLE_LAYER15_COMPARE',

  // Group 4 — Acceptance
  ACCEPTANCE_V2: 'ACCEPTANCE_V2',
  STRICT_OWNER_VERIFICATION: 'STRICT_OWNER_VERIFICATION',
  STRICT_EVIDENCE_POLICY: 'STRICT_EVIDENCE_POLICY',
  STRICT_DERIVATIVE_POLICY: 'STRICT_DERIVATIVE_POLICY',

  // Group 5 — Investigation
  INVESTIGATION_V2: 'INVESTIGATION_V2',
  ENTERPRISE_PIPELINE_V2: 'ENTERPRISE_PIPELINE_V2',
  DETERMINISTIC_PIPELINE: 'DETERMINISTIC_PIPELINE',
  STABLE_RANKING: 'STABLE_RANKING',
  AUTHORITATIVE_STORED_DNA: 'AUTHORITATIVE_STORED_DNA',

  // Group 6 — Performance
  ANN_CACHE: 'ANN_CACHE',
  ASYNC_COMPARE: 'ASYNC_COMPARE',
  DISTRIBUTED_COMPARE: 'DISTRIBUTED_COMPARE',
  FAST_RETRIEVAL: 'FAST_RETRIEVAL',
} as const;

export type EnterpriseFeatureFlagName =
  (typeof ENTERPRISE_FEATURE_FLAG)[keyof typeof ENTERPRISE_FEATURE_FLAG];

export interface EnterpriseFeatureFlagDefinition {
  /** Canonical name — equals ENTERPRISE_FEATURE_FLAG.* */
  name: EnterpriseFeatureFlagName;
  /** Short human summary */
  description: string;
  /**
   * Default when env unset.
   * OFF for new enterprise paths; ON only when current production already
   * relies on that capability (so later gating preserves behaviour).
   */
  defaultValue: boolean;
  /** Milestone / EDS tag when the flag was introduced */
  versionIntroduced: string;
  category: FeatureFlagCategory;
  /** Longer docs: intent, milestone, rollback */
  documentation: string;
  /** Primary process.env key */
  envKey: string;
  /** Alternate env keys (backward-compatible aliases) */
  legacyEnvKeys?: readonly string[];
}

/** Shared env bool parser — same truthy set as investigation-match-policy / crawler. */
export function parseFeatureFlagEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveFlagEnabled(def: EnterpriseFeatureFlagDefinition): boolean {
  const keys = [def.envKey, ...(def.legacyEnvKeys ?? [])];
  for (const key of keys) {
    const raw = process.env[key];
    if (raw !== undefined && raw !== '') {
      return parseFeatureFlagEnv(raw, def.defaultValue);
    }
  }
  return def.defaultValue;
}

const A2 = 'A2' as const;

/**
 * Immutable registry — single source of truth for all enterprise flags.
 * Do not mutate at runtime; use env overrides for local/staging experiments.
 */
export const ENTERPRISE_FEATURE_FLAG_REGISTRY: Readonly<
  Record<EnterpriseFeatureFlagName, EnterpriseFeatureFlagDefinition>
> = {
  // ─── Group 1: DNA Generation ─────────────────────────────────────────────
  DNA_V2_ENABLED: {
    name: 'DNA_V2_ENABLED',
    description: 'Enable enterprise DNA package generation path (EDS modules).',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.DNA_GENERATION,
    documentation:
      'Milestone B+. When ON, generation may emit additive EDS fields. Default OFF = legacy generators only. Rollback: set false.',
    envKey: 'DNA_V2_ENABLED',
  },
  DNA_DETERMINISTIC_MODE: {
    name: 'DNA_DETERMINISTIC_MODE',
    description: 'Force deterministic digests (no random/time in identity modules).',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.DNA_GENERATION,
    documentation:
      'Milestone B Step 1 ACTIVATED (default ON). Dual-write claims_digest / content_seal_hmac; L1–L10 identity ignores session/time/uuid. Rollback: DNA_DETERMINISTIC_MODE=false restores legacy L5–L10 variance.',
    envKey: 'DNA_DETERMINISTIC_MODE',
  },
  DNA_IMMUTABLE_STORAGE: {
    name: 'DNA_IMMUTABLE_STORAGE',
    description: 'Seal DNA packages; block post-seal fingerprint mutation.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.DNA_GENERATION,
    documentation:
      'Milestone B Step 2 ACTIVATED (default ON). Sealed enterpriseDnaPackage fingerprints cannot be overwritten. Rollback: DNA_IMMUTABLE_STORAGE=false.',
    envKey: 'DNA_IMMUTABLE_STORAGE',
  },
  DNA_INTEGRITY_HASH: {
    name: 'DNA_INTEGRITY_HASH',
    description: 'Write package integrity merkle / integrity_hash on seal.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.DNA_GENERATION,
    documentation:
      'Milestone B Step 2 ACTIVATED (default ON). Writes overallIntegrityHash + merkle into enterpriseDnaPackage. Rollback: false.',
    envKey: 'DNA_INTEGRITY_HASH',
  },
  DNA_VERSIONING: {
    name: 'DNA_VERSIONING',
    description: 'Persist full version tuple on DNA packages (schema/algorithm/…).',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.DNA_GENERATION,
    documentation:
      `Milestone B Step 2 ACTIVATED (default ON). Persists version tuple on enterpriseDnaPackage (SYSTEM_VERSION=${SYSTEM_VERSION}). Rollback: false.`,
    envKey: 'DNA_VERSIONING',
  },

  // ─── Group 2: Retrieval ──────────────────────────────────────────────────
  RECALL_ENGINE_V2: {
    name: 'RECALL_ENGINE_V2',
    description: 'Enterprise recall union before deep compare (recall-before-precision).',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.RETRIEVAL,
    documentation:
      'Milestone D / EDS P13. Default ON runs independent providers, unions candidates, then limits. Rollback: false.',
    envKey: 'RECALL_ENGINE_V2',
  },
  ANN_RETRIEVAL: {
    name: 'ANN_RETRIEVAL',
    description: 'Use ANN / vector index path as primary retrieval stage.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.RETRIEVAL,
    documentation:
      'Milestone K. Default OFF does not alter existing FAISS/CLIP call sites until gated. Rollback: false.',
    envKey: 'ANN_RETRIEVAL',
  },
  PATCH_DNA_ENGINE: {
    name: 'PATCH_DNA_ENGINE',
    description: 'Local-patch / fragment DNA retrieval and rescue.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.RETRIEVAL,
    documentation:
      'WHY default ON: patch DNA rescue already runs in production. Future gating must keep ON to preserve behaviour. Milestone E hardens pool inclusion. Rollback: true (legacy).',
    envKey: 'PATCH_DNA_ENGINE',
  },
  IDENTITY_SHORTCUTS: {
    name: 'IDENTITY_SHORTCUTS',
    description: 'L1 / SHA / watermark identity short-circuit recall.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.RETRIEVAL,
    documentation:
      'WHY default ON: exact-hash and identity shortcuts already exist. Rollback: true.',
    envKey: 'IDENTITY_SHORTCUTS',
  },
  VISUAL_RETRIEVAL_V2: {
    name: 'VISUAL_RETRIEVAL_V2',
    description: 'Next-gen visual / perceptual retrieval ranking.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.RETRIEVAL,
    documentation:
      'Milestone D. Default ON contributes visual candidates to recall union. Rollback: false.',
    envKey: 'VISUAL_RETRIEVAL_V2',
  },

  // ─── Group 3: Comparison ─────────────────────────────────────────────────
  COMPARISON_V2: {
    name: 'COMPARISON_V2',
    description: 'Enterprise comparison suite (Identity vs Ownership vs Evidence weights).',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone E. Default ON runs Enterprise Comparison Engine (package vs probe). Legacy ComparisonEngine still supplies overallConfidenceScore. Rollback: false.',
    envKey: 'COMPARISON_V2',
  },
  USE_STORED_DNA_PRIMARY: {
    name: 'USE_STORED_DNA_PRIMARY',
    description: 'Score vault side from sealed stored DNA (EDS P3/P5 SSoT).',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone C. Prefer enterpriseDnaPackage when valid; live vault FP is fallback. Alias PREFER_STORED_VAULT_DNA. Rollback: false.',
    envKey: 'USE_STORED_DNA_PRIMARY',
    legacyEnvKeys: ['PREFER_STORED_VAULT_DNA'],
  },
  LIVE_DNA_AUDIT_ONLY: {
    name: 'LIVE_DNA_AUDIT_ONLY',
    description: 'When stored DNA is primary, live regenerate is audit/metric only.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone D (pairs with USE_STORED_DNA_PRIMARY). Default OFF. Rollback: false.',
    envKey: 'LIVE_DNA_AUDIT_ONLY',
  },
  ENABLE_LAYER11_COMPARE: {
    name: 'ENABLE_LAYER11_COMPARE',
    description: 'Include L11 (synthetic/manipulation risk) in scored comparison.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone E. Default ON for enterprise domain scoring (evidence). Does not alter Acceptance. Rollback: false.',
    envKey: 'ENABLE_LAYER11_COMPARE',
  },
  ENABLE_LAYER12_COMPARE: {
    name: 'ENABLE_LAYER12_COMPARE',
    description: 'Include L12 (recoverable ownership mark) in scored comparison.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone E. Default ON for enterprise ownership domain. Does not alter Acceptance. Rollback: false.',
    envKey: 'ENABLE_LAYER12_COMPARE',
  },
  ENABLE_LAYER13_COMPARE: {
    name: 'ENABLE_LAYER13_COMPARE',
    description: 'Include L13 (custody anchor) in scored comparison.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone E. Default ON for enterprise evidence domain. Does not alter Acceptance. Rollback: false.',
    envKey: 'ENABLE_LAYER13_COMPARE',
  },
  ENABLE_LAYER14_COMPARE: {
    name: 'ENABLE_LAYER14_COMPARE',
    description: 'Include L14 (ownership commitment) in scored comparison.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone E. Default ON for enterprise ownership domain. Does not alter Acceptance. Rollback: false.',
    envKey: 'ENABLE_LAYER14_COMPARE',
  },
  ENABLE_LAYER15_COMPARE: {
    name: 'ENABLE_LAYER15_COMPARE',
    description: 'Include L15 (subject bind) in scored comparison.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.COMPARISON,
    documentation:
      'Milestone E. Default ON for enterprise trust domain. Does not alter Acceptance. Rollback: false.',
    envKey: 'ENABLE_LAYER15_COMPARE',
  },

  // ─── Group 4: Acceptance ─────────────────────────────────────────────────
  ACCEPTANCE_V2: {
    name: 'ACCEPTANCE_V2',
    description: 'Identity / Ownership / Evidence pack acceptance (EDS P6–P9).',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.ACCEPTANCE,
    documentation:
      'Milestone F ACTIVATED (default ON). Evaluates EnterpriseComparisonReport with independent domains. Rollback: false.',
    envKey: 'ACCEPTANCE_V2',
  },
  STRICT_OWNER_VERIFICATION: {
    name: 'STRICT_OWNER_VERIFICATION',
    description: 'Require ownership factor for VERIFIED_* (no WM/cert-only shortcut).',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.ACCEPTANCE,
    documentation:
      'Milestone F. Default OFF preserves instant WM/cert verification paths. Rollback: false.',
    envKey: 'STRICT_OWNER_VERIFICATION',
  },
  STRICT_EVIDENCE_POLICY: {
    name: 'STRICT_EVIDENCE_POLICY',
    description: 'Evidence engine may block VERIFIED on INVALID validation_status.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.ACCEPTANCE,
    documentation:
      'Milestone F / EDS P8. Default OFF. Rollback: false.',
    envKey: 'STRICT_EVIDENCE_POLICY',
  },
  STRICT_DERIVATIVE_POLICY: {
    name: 'STRICT_DERIVATIVE_POLICY',
    description: 'Stricter VERIFIED_DERIVATIVE identity/ownership gates.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.ACCEPTANCE,
    documentation:
      'Milestone F. Default OFF keeps current derivative thresholds. Rollback: false.',
    envKey: 'STRICT_DERIVATIVE_POLICY',
  },

  // ─── Group 5: Investigation ──────────────────────────────────────────────
  INVESTIGATION_V2: {
    name: 'INVESTIGATION_V2',
    description: 'Enterprise investigation pipeline orchestration (Identity→…→Verdict).',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.INVESTIGATION,
    documentation:
      'Milestone D–G. Default OFF = current unified investigation orchestrator. Rollback: false.',
    envKey: 'INVESTIGATION_V2',
  },
  ENTERPRISE_PIPELINE_V2: {
    name: 'ENTERPRISE_PIPELINE_V2',
    description: 'Single-pass enterprise E2E pipeline (gen→store→retrieve→compare→accept→report).',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.INVESTIGATION,
    documentation:
      'Milestone G. Default OFF = legacy multi-pass recovery. When ON: one probe fingerprint, one retrieval, one compare/accept per candidate, unified report. Rollback: false.',
    envKey: 'ENTERPRISE_PIPELINE_V2',
  },
  DETERMINISTIC_PIPELINE: {
    name: 'DETERMINISTIC_PIPELINE',
    description: 'Disable soft timeouts / non-deterministic ranking ties where possible.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.INVESTIGATION,
    documentation:
      'Milestone D/E. Default OFF preserves current soft-timeout behaviour. Rollback: false.',
    envKey: 'DETERMINISTIC_PIPELINE',
  },
  STABLE_RANKING: {
    name: 'STABLE_RANKING',
    description: 'Stable sort keys for candidate ranking (tie-break determinism).',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.INVESTIGATION,
    documentation:
      'Milestone E. Default OFF. Rollback: false.',
    envKey: 'STABLE_RANKING',
  },
  AUTHORITATIVE_STORED_DNA: {
    name: 'AUTHORITATIVE_STORED_DNA',
    description: 'Investigation treats stored DNA as authoritative for vault identity.',
    defaultValue: true,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.INVESTIGATION,
    documentation:
      'Milestone C — investigation companion to USE_STORED_DNA_PRIMARY. Default ON. Rollback: false.',
    envKey: 'AUTHORITATIVE_STORED_DNA',
  },

  // ─── Group 6: Performance ────────────────────────────────────────────────
  ANN_CACHE: {
    name: 'ANN_CACHE',
    description: 'Cache ANN / embedding query results across investigation stages.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.PERFORMANCE,
    documentation:
      'Milestone K. Default OFF. Rollback: false.',
    envKey: 'ANN_CACHE',
  },
  ASYNC_COMPARE: {
    name: 'ASYNC_COMPARE',
    description: 'Run deep compares asynchronously / batched.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.PERFORMANCE,
    documentation:
      'Milestone K. Default OFF = synchronous deep compare. Rollback: false.',
    envKey: 'ASYNC_COMPARE',
  },
  DISTRIBUTED_COMPARE: {
    name: 'DISTRIBUTED_COMPARE',
    description: 'Shard comparison work across workers.',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.PERFORMANCE,
    documentation:
      'Milestone K (future scale). Default OFF. Rollback: false.',
    envKey: 'DISTRIBUTED_COMPARE',
  },
  FAST_RETRIEVAL: {
    name: 'FAST_RETRIEVAL',
    description: 'Aggressive retrieval latency trade-offs (smaller pools / early exit).',
    defaultValue: false,
    versionIntroduced: A2,
    category: FEATURE_FLAG_CATEGORY.PERFORMANCE,
    documentation:
      'Milestone E/K. Default OFF keeps investigation-performance.ts constants. Rollback: false.',
    envKey: 'FAST_RETRIEVAL',
  },
};

/** Ordered list of all flag names (stable for diagnostics). */
export const ALL_ENTERPRISE_FEATURE_FLAGS: readonly EnterpriseFeatureFlagName[] =
  Object.keys(ENTERPRISE_FEATURE_FLAG_REGISTRY) as EnterpriseFeatureFlagName[];

/**
 * Resolve whether a flag is enabled (env override → default).
 * WHY: single entry point — no magic strings at call sites.
 */
export function isEnterpriseFeatureEnabled(name: EnterpriseFeatureFlagName): boolean {
  const def = ENTERPRISE_FEATURE_FLAG_REGISTRY[name];
  if (!def) {
    // Exhaustive registry — should never happen with typed name.
    return false;
  }
  return resolveFlagEnabled(def);
}

/** Full definition + resolved enabled state (for admin/diagnostics; unused in A2). */
export function getEnterpriseFeatureFlag(name: EnterpriseFeatureFlagName): {
  definition: EnterpriseFeatureFlagDefinition;
  enabled: boolean;
} {
  const definition = ENTERPRISE_FEATURE_FLAG_REGISTRY[name];
  return { definition, enabled: resolveFlagEnabled(definition) };
}

/** Snapshot of all flags — for tests / future health diagnostics. */
export function listEnterpriseFeatureFlags(): ReadonlyArray<{
  name: EnterpriseFeatureFlagName;
  category: FeatureFlagCategory;
  enabled: boolean;
  defaultValue: boolean;
  versionIntroduced: string;
  description: string;
  documentation: string;
}> {
  return ALL_ENTERPRISE_FEATURE_FLAGS.map((name) => {
    const def = ENTERPRISE_FEATURE_FLAG_REGISTRY[name];
    return {
      name: def.name,
      category: def.category,
      enabled: resolveFlagEnabled(def),
      defaultValue: def.defaultValue,
      versionIntroduced: def.versionIntroduced,
      description: def.description,
      documentation: def.documentation,
    };
  });
}

/** Filter registry by category. */
export function getEnterpriseFeatureFlagsByCategory(
  category: FeatureFlagCategory,
): readonly EnterpriseFeatureFlagDefinition[] {
  return ALL_ENTERPRISE_FEATURE_FLAGS
    .map((n) => ENTERPRISE_FEATURE_FLAG_REGISTRY[n])
    .filter((d) => d.category === category);
}
