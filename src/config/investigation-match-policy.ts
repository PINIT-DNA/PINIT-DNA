/**
 * Investigation Match Policy — single source of truth for vault match thresholds.
 *
 * Product rules:
 * - Exact L1 / strong multi-signal (fusion ≥90) → Verified (reveal owner)
 * - Local-patch ≥55 OR content DNA ≥55 with L3≥70 / patch → Possible (vault only)
 * - Best support <50% AND no local-patch ≥55 → Asset Not Found
 * - Mid-band L3 55–70 without patch → Asset Not Found (lookalike reject)
 *
 * Enterprise migration (Milestone C):
 * - `PREFER_STORED_VAULT_DNA` aliases `USE_STORED_DNA_PRIMARY` (default ON).
 * - Valid enterpriseDnaPackage is SSoT; `INVESTIGATION_PREFER_LIVE_VAULT_FP` is fallback only.
 * - See docs/PHASE9_MIGRATION_IMPLEMENTATION_BLUEPRINT.md Milestone C.
 */

import { ENTERPRISE_FEATURE_FLAG, isEnterpriseFeatureEnabled } from './enterprise-feature-flags';

/**
 * When true, investigation prefers sealed enterpriseDnaPackage (EDS P3/P5 SSoT).
 * Aliased to USE_STORED_DNA_PRIMARY. Default ON (Milestone C).
 * Env: `USE_STORED_DNA_PRIMARY` or legacy `PREFER_STORED_VAULT_DNA`
 */
export const PREFER_STORED_VAULT_DNA = isEnterpriseFeatureEnabled(
  ENTERPRISE_FEATURE_FLAG.USE_STORED_DNA_PRIMARY,
);

/** Best support below this with no patch → Asset Not Found */
export const NOT_FOUND_MAX_WITHOUT_PATCH = 50;

/** Minimum for POSSIBLE similarity / local-patch rescue */
export const POSSIBLE_MIN = 55;

/** Non-patch POSSIBLE requires measured L3 at least this strong */
export const POSSIBLE_L3_MIN_WITHOUT_PATCH = 70;

/** Local patch DNA fragment lock / crop rescue */
export const LOCAL_PATCH_RESCUE_MIN = 55;

/** DIFFERENT→SIMILAR only when perceptual reaches this (anti-lookalike) */
export const DERIVATIVE_PROMOTE_L3_MIN = 75;

/** Weak perceptual: do not inflate content score */
export const DERIVATIVE_WEAK_L3_MAX = 40;

/** Verified owner / ORIGINAL_VERIFIED fusion band */
export const VERIFIED_FUSION_MIN = 90;

/** Likely / partial identity band */
export const LIKELY_OWNER_MIN = 75;

/** DNA channel PASS floor — below this without local_patch → FAIL */
export const DNA_PARTIAL_MIN = 50;

/** Full DNA pass for Verified Original path */
export const DNA_FULL_PASS_MIN = 75;

/** Non-patch Verified Derivative DNA floor */
export const DNA_DERIVATIVE_VERIFIED_MIN = 72;

/** Cross-modal derivative support */
export const CROSS_MODAL_DERIVATIVE_MIN = 62;

/** Visual channel for derivative / possible */
export const VISUAL_DERIVATIVE_MIN = 55;

/** Instant ownership (watermark / certificate) */
export const INSTANT_PROOF_MIN = 90;

/** Single-layer weak cap */
export const SINGLE_LAYER_WEAK_MAX = 74;

/** Hard reject non-patch if measured L3 below this */
export const RANKING_L3_PERCEPTUAL_MIN = 55;

/** Live SSE may show vault at this score — not trusted alone */
export const RANKING_LIVE_LEAD_MIN = 40;

/** Trusted vector lead — shrink deep pool */
export const RANKING_TRUSTED_LEAD_MIN = 75;

/** Deep-compare funnel sizes */
export const RANKING_TOP_VECTOR = 100;
export const RANKING_TOP_IDENTITY = 30;
export const RANKING_TOP_MEDIA = 20;
export const RANKING_TOP_DEEP = 6;
export const RANKING_TOP_DEEP_STRONG_LEAD = 4;

/**
 * Investigation deep compare: prefer decrypted vault bytes for L1–L6 (legacy fallback).
 * Milestone C: when a valid enterpriseDnaPackage exists, live FP is NOT used
 * (see resolveInvestigationVaultDnaSource / deep-vault-compare).
 */
export const INVESTIGATION_PREFER_LIVE_VAULT_FP = true;

/**
 * Runtime preference summary for diagnostics (Milestone C wired).
 */
export function getInvestigationVaultDnaSourcePreference(): {
  preferStoredVaultDna: boolean;
  preferLiveVaultFingerprint: boolean;
  migrationNote: string;
} {
  return {
    preferStoredVaultDna: PREFER_STORED_VAULT_DNA,
    // Live FP constant remains true for unmigrated/corrupt package fallback:
    preferLiveVaultFingerprint: INVESTIGATION_PREFER_LIVE_VAULT_FP,
    migrationNote: PREFER_STORED_VAULT_DNA
      ? 'Milestone C: prefer enterpriseDnaPackage when valid; live vault FP is fallback only.'
      : 'Legacy live vault fingerprinting preferred (USE_STORED_DNA_PRIMARY off).',
  };
}

/** Policy table for docs / tests */
export const INVESTIGATION_MATCH_POLICY = {
  notFoundMaxWithoutPatch: NOT_FOUND_MAX_WITHOUT_PATCH,
  possibleMin: POSSIBLE_MIN,
  possibleL3MinWithoutPatch: POSSIBLE_L3_MIN_WITHOUT_PATCH,
  localPatchRescueMin: LOCAL_PATCH_RESCUE_MIN,
  derivativePromoteL3Min: DERIVATIVE_PROMOTE_L3_MIN,
  verifiedFusionMin: VERIFIED_FUSION_MIN,
  likelyOwnerMin: LIKELY_OWNER_MIN,
  dnaPartialMin: DNA_PARTIAL_MIN,
  preferLiveVaultFingerprint: INVESTIGATION_PREFER_LIVE_VAULT_FP,
  /** Milestone C — default ON; valid package is SSoT */
  preferStoredVaultDna: PREFER_STORED_VAULT_DNA,
} as const;
