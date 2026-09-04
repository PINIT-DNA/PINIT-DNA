/**
 * Enterprise Acceptance Engine (Milestone F).
 *
 * Consumes EnterpriseComparisonReport only.
 * Does NOT recompute comparison scores or regenerate fingerprints.
 * Domain scores remain independent — never merged into one percentage.
 *
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md Parts 3.4, 6, P6–P9, P14
 */

import { logger } from '../../lib/logger';
import { DNA_ACCEPTANCE_VERSION, DNA_ALGORITHM_VERSION } from '../../config/dna-versions';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';
import type { EnterpriseComparisonReport } from '../../types/enterprise-comparison.types';
import type {
  EnterpriseAcceptanceDecision,
  EnterpriseAcceptanceExplanation,
  EnterpriseAcceptanceInput,
  EnterpriseAcceptanceVerdict,
} from '../../types/enterprise-acceptance.types';
import type { AcceptanceDecision, AcceptanceEvidence, AcceptanceVerdict } from '../../types/acceptance.types';

const IDENTITY_FAMILY_MIN = 55;
const IDENTITY_STRONG_MIN = 75;
const IDENTITY_VERIFIED_MIN = 90;
const OWNERSHIP_FACTOR_MIN = 70;
const TRUST_MIN = 40;
const EVIDENCE_BLOCK_MAX = 15;

function layer(
  report: EnterpriseComparisonReport,
  id: number,
) {
  return report.layers.find((l) => l.layerId === id);
}

function isMatch(report: EnterpriseComparisonReport, id: number): boolean {
  return layer(report, id)?.status === 'MATCH';
}

function isPartial(report: EnterpriseComparisonReport, id: number): boolean {
  return layer(report, id)?.status === 'PARTIAL';
}

function isPresent(report: EnterpriseComparisonReport, id: number): boolean {
  const s = layer(report, id)?.status;
  return s === 'MATCH' || s === 'PARTIAL' || s === 'MISMATCH';
}

function missingLayers(report: EnterpriseComparisonReport): string[] {
  return report.layers
    .filter((l) => l.status === 'NOT_PRESENT' || l.status === 'ERROR')
    .map((l) => `L${l.layerId}:${l.layerName}:${l.status}`);
}

function triggered(
  report: EnterpriseComparisonReport,
  ids: number[],
): number[] {
  return ids.filter((id) => {
    const s = layer(report, id)?.status;
    return s === 'MATCH' || s === 'PARTIAL';
  });
}

function explain(
  verdict: EnterpriseAcceptanceVerdict,
  reason: string,
  satisfied: string[],
  unsatisfied: string[],
  triggeredLayers: number[],
  supporting: string[],
  missing: string[],
): EnterpriseAcceptanceExplanation {
  return {
    decision: verdict,
    reason,
    satisfiedConditions: satisfied,
    unsatisfiedConditions: unsatisfied,
    triggeredLayers,
    supportingEvidence: supporting,
    missingEvidence: missing,
  };
}

/**
 * Core decision — evaluates domains independently; selects one rule.
 * Identity = same asset family; Ownership = attribution; Evidence = strength;
 * Trust = package reliability. No single layer decides alone unless designed
 * (L1 exact + ownership mark, etc.).
 */
export function decideEnterpriseAcceptance(
  input: EnterpriseAcceptanceInput,
): EnterpriseAcceptanceDecision {
  const started = Date.now();
  const { report } = input;
  const analysisComplete = input.analysisComplete !== false;

  logger.info('[EnterpriseAcceptance] started', {
    comparisonId: report.comparisonId.slice(0, 8),
    packageMissing: !!input.packageMissing,
    packageCorrupted: !!input.packageCorrupted,
  });

  const domains = {
    identityScore: report.domains.identityScore,
    evidenceScore: report.domains.evidenceScore,
    ownershipScore: report.domains.ownershipScore,
    trustScore: report.domains.trustScore,
  };

  logger.info('[EnterpriseAcceptance] domains evaluated', {
    identityScore: domains.identityScore,
    evidenceScore: domains.evidenceScore,
    ownershipScore: domains.ownershipScore,
    trustScore: domains.trustScore,
  });

  let verdict: EnterpriseAcceptanceVerdict;
  let ruleId: string;
  let explanation: EnterpriseAcceptanceExplanation;
  const missing = missingLayers(report);

  // ── Package integrity gates (fail closed on ownership) ───────────────────
  if (input.packageCorrupted) {
    verdict = 'PACKAGE_CORRUPTED';
    ruleId = 'F-PACKAGE-CORRUPTED';
    explanation = explain(
      verdict,
      'Stored enterprise DNA package failed integrity validation',
      ['package_present'],
      ['integrity_valid'],
      [],
      ['integrity_hash_mismatch_or_corrupt_layers'],
      ['valid_enterprise_dna_package'],
    );
  } else if (input.packageMissing) {
    verdict = 'INVALID_PACKAGE';
    ruleId = 'F-PACKAGE-MISSING';
    explanation = explain(
      verdict,
      'No enterprise DNA package available for acceptance',
      [],
      ['enterprise_package_present'],
      [],
      [],
      ['enterprise_dna_package'],
    );
  } else if (!analysisComplete) {
    verdict = 'INSUFFICIENT_EVIDENCE';
    ruleId = 'F-ANALYSIS-INCOMPLETE';
    explanation = explain(
      verdict,
      'Investigation analysis incomplete — acceptance withheld',
      [],
      ['analysis_complete'],
      [],
      [],
      ['completed_comparison_analysis'],
    );
  } else {
    const l1 = isMatch(report, 1);
    const l3Match = isMatch(report, 3);
    const l3Partial = isPartial(report, 3);
    const l6 = isMatch(report, 6);
    const l7Strong = isMatch(report, 7) || (isPartial(report, 7) && (layer(report, 7)?.score ?? 0) >= 55);
    const l10Deriv = isMatch(report, 10) || isPartial(report, 10);
    const ownershipMark = isMatch(report, 12);
    const ownershipCommit = isMatch(report, 14);
    const ownershipHint = !!(
      input.ownershipHints?.certificateBound
      || input.ownershipHints?.watermarkBound
    );
    const ownershipFactor = ownershipMark || ownershipCommit || ownershipHint
      || domains.ownershipScore >= OWNERSHIP_FACTOR_MIN;
    const identityFamily = domains.identityScore >= IDENTITY_FAMILY_MIN
      || l1 || l3Match || l3Partial || l7Strong;
    const identityStrong = domains.identityScore >= IDENTITY_STRONG_MIN
      || l1
      || (l3Match && domains.identityScore >= IDENTITY_FAMILY_MIN);
    const identityVerified = l1
      || (domains.identityScore >= IDENTITY_VERIFIED_MIN && (l3Match || l6));
    const trustOk = domains.trustScore >= TRUST_MIN
      || isMatch(report, 15)
      || isPresent(report, 15) === false; // absent trust layer does not block
    const evidenceWeak = domains.evidenceScore > 0
      && domains.evidenceScore < EVIDENCE_BLOCK_MAX
      && !isPresent(report, 5)
      && !isPresent(report, 11)
      && !isPresent(report, 13);

    const satisfied: string[] = [];
    const unsatisfied: string[] = [];
    if (identityFamily) satisfied.push('identity_family');
    else unsatisfied.push('identity_family');
    if (identityStrong) satisfied.push('identity_strong');
    else unsatisfied.push('identity_strong');
    if (identityVerified) satisfied.push('identity_verified');
    else unsatisfied.push('identity_verified');
    if (ownershipFactor) satisfied.push('ownership_factor');
    else unsatisfied.push('ownership_factor');
    if (trustOk) satisfied.push('trust_ok');
    else unsatisfied.push('trust_ok');
    if (l7Strong) satisfied.push('fragment_identity_l7');
    if (l10Deriv) satisfied.push('lineage_derivative_l10');
    if (l1 && !ownershipFactor) unsatisfied.push('ownership_for_l1_exact');

    // NO_MATCH — identity rejects family
    if (!identityFamily && domains.identityScore < IDENTITY_FAMILY_MIN) {
      verdict = 'NO_MATCH';
      ruleId = 'F-NO-MATCH-IDENTITY';
      explanation = explain(
        verdict,
        'Identity domain does not place probe in the same asset family',
        satisfied,
        unsatisfied,
        triggered(report, [1, 2, 3, 4]),
        [`identityScore=${domains.identityScore}`],
        missing,
      );
    } else if (
      identityVerified
      && ownershipFactor
      && trustOk
      && l1
      && !l7Strong
      && !input.packageCorrupted
    ) {
      // Original owner — cryptographic identity + ownership factor
      verdict = 'VERIFIED_OWNER';
      ruleId = 'F-VERIFIED-OWNER';
      explanation = explain(
        verdict,
        'Cryptographic identity match with ownership factor',
        [...satisfied, 'l1_exact', ownershipMark ? 'l12_ownership_mark' : 'ownership_domain'],
        unsatisfied.filter((c) => c !== 'ownership_factor'),
        triggered(report, [1, 6, 12, 14, 15]),
        [
          `identityScore=${domains.identityScore}`,
          `ownershipScore=${domains.ownershipScore}`,
          `trustScore=${domains.trustScore}`,
        ],
        missing.filter((m) => !m.startsWith('L5')),
      );
    } else if (
      identityStrong
      && ownershipFactor
      && trustOk
      && !l1
      && (l3Match || l3Partial || domains.identityScore >= IDENTITY_STRONG_MIN)
      && !l7Strong
    ) {
      // Same content family, re-encoded/shared copy — ownership still attributable
      verdict = 'VERIFIED_COPY';
      ruleId = 'F-VERIFIED-COPY';
      explanation = explain(
        verdict,
        'Strong perceptual/identity family with ownership factor (non-exact bitstream)',
        [...satisfied, 'copy_or_reencode_path'],
        [...unsatisfied, 'l1_exact'],
        triggered(report, [3, 4, 6, 12, 14]),
        [
          `identityScore=${domains.identityScore}`,
          `ownershipScore=${domains.ownershipScore}`,
          `evidenceScore=${domains.evidenceScore}`,
        ],
        missing,
      );
    } else if (
      ownershipFactor
      && trustOk
      && (l7Strong || l10Deriv || (identityFamily && (report.layers.some((l) =>
        l.layerId <= 4 && l.status === 'PARTIAL'))))
      && !l1
    ) {
      // Derivative / crop / edited with ownership
      verdict = 'DERIVATIVE';
      ruleId = 'F-DERIVATIVE';
      explanation = explain(
        verdict,
        'Derivative or fragment identity with ownership factor',
        [...satisfied, l7Strong ? 'local_patch_l7' : 'derivative_identity'],
        [...unsatisfied, 'l1_exact'],
        triggered(report, [3, 7, 10, 12, 14]),
        [
          `identityScore=${domains.identityScore}`,
          `ownershipScore=${domains.ownershipScore}`,
          `evidenceScore=${domains.evidenceScore}`,
        ],
        missing,
      );
    } else if (identityFamily && !ownershipFactor) {
      // Similarity without ownership attribution
      verdict = 'POSSIBLE_MATCH';
      ruleId = 'F-POSSIBLE-MATCH';
      explanation = explain(
        verdict,
        'Identity suggests same asset family but ownership cannot be attributed',
        satisfied,
        unsatisfied,
        triggered(report, [1, 2, 3, 4, 7]),
        [
          `identityScore=${domains.identityScore}`,
          `evidenceScore=${domains.evidenceScore}`,
          `trustScore=${domains.trustScore}`,
        ],
        [...missing, 'ownership_factor_l12_or_l14'],
      );
    } else if (
      identityFamily
      && ownershipFactor
      && (!trustOk || evidenceWeak)
    ) {
      verdict = 'INSUFFICIENT_EVIDENCE';
      ruleId = 'F-INSUFFICIENT-TRUST-OR-EVIDENCE';
      explanation = explain(
        verdict,
        'Identity/ownership signals present but trust or evidence package is insufficient',
        satisfied,
        unsatisfied,
        triggered(report, [1, 3, 11, 13, 15]),
        [
          `trustScore=${domains.trustScore}`,
          `evidenceScore=${domains.evidenceScore}`,
        ],
        missing,
      );
    } else {
      verdict = 'INSUFFICIENT_EVIDENCE';
      ruleId = 'F-INSUFFICIENT-DEFAULT';
      explanation = explain(
        verdict,
        'Enterprise acceptance could not satisfy a verified or possible rule',
        satisfied,
        unsatisfied,
        triggered(report, [1, 2, 3, 12, 14]),
        [
          `identityScore=${domains.identityScore}`,
          `ownershipScore=${domains.ownershipScore}`,
        ],
        missing,
      );
    }
  }

  const retainCandidate = verdict === 'VERIFIED_OWNER'
    || verdict === 'VERIFIED_COPY'
    || verdict === 'DERIVATIVE';

  const executionTimeMs = Date.now() - started;
  logger.info('[EnterpriseAcceptance] rule selected', { ruleId, verdict });
  logger.info('[EnterpriseAcceptance] verdict', {
    verdict,
    ruleId,
    retainCandidate,
    executionTimeMs,
  });

  return {
    schema: 'enterprise-acceptance-decision-v1',
    verdict,
    policyVersion: DNA_ACCEPTANCE_VERSION,
    domains,
    explanation,
    retainCandidate,
    ruleId,
    executionTimeMs,
    comparedAt: new Date().toISOString(),
  };
}

export function isAcceptanceV2Enabled(): boolean {
  return isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.ACCEPTANCE_V2);
}

/** Map enterprise verdict → legacy AcceptanceVerdict for existing callers. */
export function mapEnterpriseVerdictToLegacy(
  verdict: EnterpriseAcceptanceVerdict,
): AcceptanceVerdict {
  switch (verdict) {
    case 'VERIFIED_OWNER':
      return 'VERIFIED_ORIGINAL';
    case 'VERIFIED_COPY':
      return 'VERIFIED_ORIGINAL';
    case 'DERIVATIVE':
      return 'VERIFIED_DERIVATIVE';
    case 'POSSIBLE_MATCH':
      return 'POSSIBLE_MATCH';
    case 'NO_MATCH':
      return 'NOT_PINIT';
    case 'INVALID_PACKAGE':
    case 'PACKAGE_CORRUPTED':
    case 'INSUFFICIENT_EVIDENCE':
      return 'INSUFFICIENT_EVIDENCE';
    default:
      return 'INSUFFICIENT_EVIDENCE';
  }
}

export const ENTERPRISE_ACCEPTANCE_LABELS: Record<EnterpriseAcceptanceVerdict, string> = {
  VERIFIED_OWNER: 'Ownership Verified (Original)',
  VERIFIED_COPY: 'Ownership Verified (Copy)',
  DERIVATIVE: 'Ownership Verified (Derivative)',
  POSSIBLE_MATCH: 'Protected original identified',
  INSUFFICIENT_EVIDENCE: 'Insufficient Evidence',
  NO_MATCH: 'No Match',
  INVALID_PACKAGE: 'Invalid DNA Package',
  PACKAGE_CORRUPTED: 'Corrupted DNA Package',
};

/**
 * Adapt enterprise decision into legacy AcceptanceDecision shape.
 * scorecard remains the legacy explainable channel card (unchanged weights).
 * Domain scores stay on the enterprise decision object — not fused here.
 */
export function toLegacyAcceptanceDecision(
  enterprise: EnterpriseAcceptanceDecision,
  _evidence: AcceptanceEvidence,
  legacyScorecard: AcceptanceDecision['scorecard'],
): AcceptanceDecision & { enterpriseAcceptance?: EnterpriseAcceptanceDecision } {
  const legacyVerdict = mapEnterpriseVerdictToLegacy(enterprise.verdict);
  const isVerified = enterprise.retainCandidate;
  const peak = Math.max(
    enterprise.domains.identityScore,
    enterprise.domains.ownershipScore,
    enterprise.domains.evidenceScore,
    enterprise.domains.trustScore,
  );
  const confidence = isVerified
    ? peak
    : legacyVerdict === 'POSSIBLE_MATCH'
      ? enterprise.domains.identityScore
      : 0;

  return {
    verdict: legacyVerdict,
    acceptancePolicyVersion: DNA_ACCEPTANCE_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    confidence,
    scorecard: legacyScorecard,
    displayLabel: ENTERPRISE_ACCEPTANCE_LABELS[enterprise.verdict],
    decisionReason: `${enterprise.ruleId}: ${enterprise.explanation.reason}`,
    retainCandidate: enterprise.retainCandidate,
    retrievalConfidence: confidence,
    enterpriseAcceptance: enterprise,
  };
}
