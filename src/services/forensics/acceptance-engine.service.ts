/**
 * Acceptance Engine — sole authority for investigation verdicts.
 *
 * Four stages (orchestrated upstream): Candidate Retrieval → DNA layers →
 * Weighted Fusion (this scorecard) → Final Decision (decide()).
 *
 * Ownership is revealed ONLY for VERIFIED_* verdicts.
 * POSSIBLE_MATCH = similarity / manual review — never assigns owner.
 * Policy: acceptance-policy-v1.2 / investigation-match-policy.ts
 */
import { logger } from '../../lib/logger';
import {
  ACCEPTANCE_POLICY_VERSION,
  DNA_ALGORITHM_VERSION,
  type AcceptanceDecision,
  type AcceptanceEvidence,
  type AcceptanceScorecard,
  type AcceptanceVerdict,
  type EvidenceChannel,
  type ScorecardChannelResult,
} from '../../types/acceptance.types';
import { logInvestigationScores } from './investigation-score-logger';
import {
  CROSS_MODAL_DERIVATIVE_MIN,
  DNA_DERIVATIVE_VERIFIED_MIN,
  DNA_FULL_PASS_MIN,
  DNA_PARTIAL_MIN,
  INSTANT_PROOF_MIN,
  LIKELY_OWNER_MIN,
  LOCAL_PATCH_RESCUE_MIN,
  NOT_FOUND_MAX_WITHOUT_PATCH,
  POSSIBLE_L3_MIN_WITHOUT_PATCH,
  POSSIBLE_MIN,
  SINGLE_LAYER_WEAK_MAX,
  VERIFIED_FUSION_MIN,
  VISUAL_DERIVATIVE_MIN,
} from '../../config/investigation-match-policy';

/** Frozen weights — acceptance-policy-v1.2 (ownership decision audit) */
const WEIGHTS = {
  certificate: 25,
  dna: 30,
  visual: 15,
  metadata: 10,
  watermark: 10,
  timeline: 5,
  owner: 5,
} as const;

const VERIFIED_OWNER_MIN = VERIFIED_FUSION_MIN;
const POSSIBLE_SIMILARITY_MIN = POSSIBLE_MIN;

export const ACCEPTANCE_VERDICT_LABELS: Record<AcceptanceVerdict, string> = {
  VERIFIED_ORIGINAL: 'Ownership Verified',
  VERIFIED_DERIVATIVE: 'Ownership Verified (Derivative)',
  POSSIBLE_MATCH: 'Likely Match – Manual Review Recommended',
  NOT_PINIT: 'Unknown Asset',
  INSUFFICIENT_EVIDENCE: 'Investigation Incomplete — Manual Review Recommended',
};

function channelContribution(weight: number, channel: EvidenceChannel): ScorecardChannelResult {
  if (channel.state !== 'PASS') {
    return { weight, score: 0, contribution: 0, state: channel.state };
  }
  const score = Math.max(0, Math.min(100, channel.score));
  return {
    weight,
    score,
    contribution: Math.round((weight / 100) * score * 100) / 100,
    state: 'PASS',
  };
}

/**
 * Deterministic scorecard. FAIL/SKIPPED contribute 0.
 * Metadata alone never drives ownership (low weight + gate in decide()).
 */
export function computeAcceptanceScorecard(evidence: AcceptanceEvidence): AcceptanceScorecard {
  const dnaChannel: EvidenceChannel = { ...evidence.dna };
  const dnaClass = evidence.dna.classification?.toUpperCase() ?? '';
  if (
    dnaClass === 'DIFFERENT'
    || dnaChannel.state === 'FAIL'
    || (dnaChannel.state === 'PASS' && dnaChannel.score < DNA_PARTIAL_MIN)
  ) {
    dnaChannel.state = dnaChannel.state === 'SKIPPED' ? 'SKIPPED' : 'FAIL';
    if (dnaChannel.state === 'FAIL') dnaChannel.score = 0;
  }

  const certificate = channelContribution(WEIGHTS.certificate, evidence.certificate);
  const dna = channelContribution(WEIGHTS.dna, dnaChannel);
  const visual = channelContribution(WEIGHTS.visual, evidence.visual);
  const metadata = channelContribution(WEIGHTS.metadata, evidence.metadata);
  const watermark = channelContribution(WEIGHTS.watermark, evidence.watermark);
  const timeline = channelContribution(WEIGHTS.timeline, evidence.timeline);
  const owner = channelContribution(WEIGHTS.owner, evidence.owner);

  const finalConfidence = Math.round(
    certificate.contribution
    + dna.contribution
    + visual.contribution
    + metadata.contribution
    + watermark.contribution
    + timeline.contribution
    + owner.contribution,
  );

  return {
    certificate,
    dna,
    visual,
    metadata,
    watermark,
    timeline,
    owner,
    finalConfidence: Math.max(0, Math.min(100, finalConfidence)),
  };
}

function isPass(ch: EvidenceChannel, minScore = 0): boolean {
  return ch.state === 'PASS' && ch.score >= minScore;
}

function dnaIsDifferent(evidence: AcceptanceEvidence): boolean {
  return (evidence.dna.classification ?? '').toUpperCase() === 'DIFFERENT';
}

function dnaFullPass(evidence: AcceptanceEvidence): boolean {
  if (dnaIsDifferent(evidence)) return false;
  return isPass(evidence.dna, DNA_FULL_PASS_MIN);
}

function dnaPartialPass(evidence: AcceptanceEvidence): boolean {
  const localPatch = /local_patch/i.test(evidence.dna.detail ?? '');
  if (dnaIsDifferent(evidence) && !localPatch) return false;
  if (dnaIsDifferent(evidence) && evidence.dna.score < POSSIBLE_MIN) return false;
  return evidence.dna.state === 'PASS' && evidence.dna.score >= DNA_PARTIAL_MIN;
}

function crossModalAverage(evidence: AcceptanceEvidence): number {
  return (evidence.dna.score + evidence.visual.score) / 2;
}

function passesDerivativeCrossModal(evidence: AcceptanceEvidence): boolean {
  return crossModalAverage(evidence) >= CROSS_MODAL_DERIVATIVE_MIN;
}

/** Closest non-metadata similarity for messaging / ranking display */
export function peakSupportScore(evidence: AcceptanceEvidence): number {
  const dna = evidence.dna.state === 'PASS' || evidence.dna.state === 'FAIL'
    ? evidence.dna.score
    : 0;
  const visual = evidence.visual.state === 'PASS' ? evidence.visual.score : 0;
  const watermark = evidence.watermark.state === 'PASS' ? evidence.watermark.score : 0;
  const certificate = evidence.certificate.state === 'PASS' ? evidence.certificate.score : 0;
  const combined = (dna + visual) / 2;
  return Math.max(dna, visual, combined, watermark, certificate);
}

function vaultLocked(evidence: AcceptanceEvidence): boolean {
  return isPass(evidence.vault, 100);
}

/** Count independent content layers that passed (excludes metadata-only, vault lock, timeline). */
function strongLayerCount(evidence: AcceptanceEvidence): number {
  let n = 0;
  if (isPass(evidence.dna, DNA_PARTIAL_MIN) && !dnaIsDifferent(evidence)) n++;
  if (isPass(evidence.visual, POSSIBLE_SIMILARITY_MIN)) n++;
  if (isPass(evidence.watermark, 50)) n++;
  if (isPass(evidence.certificate, 50)) n++;
  if (isPass(evidence.owner, 80)) n++; // cryptographic / signed owner binding only
  return n;
}

function hasInstantOwnershipProof(evidence: AcceptanceEvidence): boolean {
  return isPass(evidence.watermark, INSTANT_PROOF_MIN)
    || isPass(evidence.certificate, INSTANT_PROOF_MIN);
}

/** Metadata-only or visual-only must never verify ownership. */
function isMetadataOnlyMatch(evidence: AcceptanceEvidence): boolean {
  const metaOk = isPass(evidence.metadata, POSSIBLE_SIMILARITY_MIN);
  if (!metaOk) return false;
  return !isPass(evidence.dna, DNA_PARTIAL_MIN)
    && !isPass(evidence.visual, POSSIBLE_SIMILARITY_MIN)
    && !isPass(evidence.watermark, 50)
    && !isPass(evidence.certificate, 50);
}

function isPerceptualOnlyMatch(evidence: AcceptanceEvidence): boolean {
  if (!isPass(evidence.visual, POSSIBLE_SIMILARITY_MIN)) return false;
  return !isPass(evidence.dna, DNA_PARTIAL_MIN)
    && !isPass(evidence.watermark, 50)
    && !isPass(evidence.certificate, 50)
    && !isPass(evidence.owner, 80);
}

function closestSimilarityLabel(evidence: AcceptanceEvidence, scorecard: AcceptanceScorecard): number {
  return Math.round(Math.max(peakSupportScore(evidence), scorecard.finalConfidence));
}

function noVerifiedOwnerMessage(evidence: AcceptanceEvidence, scorecard: AcceptanceScorecard): string {
  const closest = closestSimilarityLabel(evidence, scorecard);
  return `No verified vault owner found. Closest similarity: ${closest}%. Manual investigation recommended.`;
}

function decide(evidence: AcceptanceEvidence, scorecard: AcceptanceScorecard): AcceptanceVerdict {
  if (!evidence.analysisComplete) {
    return 'INSUFFICIENT_EVIDENCE';
  }

  if (!evidence.hasCandidate) {
    return 'NOT_PINIT';
  }

  const localPatchFragment = /local_patch/i.test(evidence.dna.detail ?? '');
  const support = peakSupportScore(evidence);
  const fused = scorecard.finalConfidence;

  // Metadata alone never identifies ownership
  if (isMetadataOnlyMatch(evidence)) {
    return 'NOT_PINIT';
  }

  // Lookalike: DNA DIFFERENT without local-patch fragment → Asset Not Found
  if (dnaIsDifferent(evidence) && !localPatchFragment) {
    return 'NOT_PINIT';
  }

  // Below ~50% with no patch lock → Asset Not Found
  if (
    !localPatchFragment
    && support < NOT_FOUND_MAX_WITHOUT_PATCH
    && fused < NOT_FOUND_MAX_WITHOUT_PATCH
    && evidence.dna.score < NOT_FOUND_MAX_WITHOUT_PATCH
  ) {
    return 'NOT_PINIT';
  }

  // Watermark or digital signature / certificate may immediately verify ownership
  if (hasInstantOwnershipProof(evidence) && vaultLocked(evidence)) {
    return evidence.tamperDetected ? 'VERIFIED_DERIVATIVE' : 'VERIFIED_ORIGINAL';
  }

  const layers = strongLayerCount(evidence);

  // Single weak layer → Unknown Asset (perceptual-only mid-band needs L3-strong band or patch)
  if (layers <= 1 && support <= SINGLE_LAYER_WEAK_MAX && fused < LIKELY_OWNER_MIN) {
    if (fused >= POSSIBLE_SIMILARITY_MIN || support >= POSSIBLE_SIMILARITY_MIN) {
      if (isPerceptualOnlyMatch(evidence) && fused < VERIFIED_OWNER_MIN) {
        // Visual-only below POSSIBLE_L3_MIN without patch = lookalike → Not Found
        if (!localPatchFragment && support < POSSIBLE_L3_MIN_WITHOUT_PATCH) {
          return 'NOT_PINIT';
        }
        return support >= POSSIBLE_SIMILARITY_MIN ? 'POSSIBLE_MATCH' : 'NOT_PINIT';
      }
      if (layers === 1 && support < LIKELY_OWNER_MIN) {
        if (!localPatchFragment && support < POSSIBLE_L3_MIN_WITHOUT_PATCH && !isPass(evidence.dna, POSSIBLE_MIN)) {
          return 'NOT_PINIT';
        }
        return support >= POSSIBLE_SIMILARITY_MIN ? 'POSSIBLE_MATCH' : 'NOT_PINIT';
      }
    }
    if (fused < POSSIBLE_SIMILARITY_MIN && support < POSSIBLE_SIMILARITY_MIN) {
      return 'NOT_PINIT';
    }
  }

  const dnaBlocksVerified = dnaIsDifferent(evidence) || evidence.dna.score < DNA_PARTIAL_MIN
    || evidence.dna.state === 'FAIL' || evidence.dna.state === 'SKIPPED';

  // VERIFIED ORIGINAL — multi-layer + high fusion (90+)
  if (
    !dnaBlocksVerified
    && dnaFullPass(evidence)
    && isPass(evidence.certificate, 100)
    && isPass(evidence.vault, 100)
    && isPass(evidence.owner, 100)
    && isPass(evidence.timeline, 100)
    && fused >= VERIFIED_OWNER_MIN
    && !evidence.tamperDetected
    && !isPerceptualOnlyMatch(evidence)
  ) {
    return 'VERIFIED_ORIGINAL';
  }

  // VERIFIED DERIVATIVE — local-patch fragment recovery (~50% crops / recompress)
  if (
    !dnaBlocksVerified
    && localPatchFragment
    && evidence.dna.score >= LOCAL_PATCH_RESCUE_MIN
    && dnaPartialPass(evidence)
    && passesDerivativeCrossModal(evidence)
    && isPass(evidence.visual, VISUAL_DERIVATIVE_MIN)
    && isPass(evidence.vault, 100)
    && evidence.tamperDetected
    && !isPerceptualOnlyMatch(evidence)
    && layers >= 2
    && (fused >= LIKELY_OWNER_MIN || evidence.dna.score >= POSSIBLE_L3_MIN_WITHOUT_PATCH)
  ) {
    return 'VERIFIED_DERIVATIVE';
  }

  // VERIFIED DERIVATIVE — multi-layer DNA + visual, fusion ≥ 90 (or DNA ≥ 90)
  if (
    !dnaBlocksVerified
    && dnaPartialPass(evidence)
    && evidence.dna.score >= DNA_DERIVATIVE_VERIFIED_MIN
    && passesDerivativeCrossModal(evidence)
    && isPass(evidence.visual, VISUAL_DERIVATIVE_MIN)
    && isPass(evidence.vault, 100)
    && evidence.tamperDetected
    && !isPerceptualOnlyMatch(evidence)
    && layers >= 2
    && (fused >= VERIFIED_OWNER_MIN || evidence.dna.score >= VERIFIED_OWNER_MIN)
  ) {
    return 'VERIFIED_DERIVATIVE';
  }

  if (
    !dnaBlocksVerified
    && dnaFullPass(evidence)
    && passesDerivativeCrossModal(evidence)
    && isPass(evidence.visual, VISUAL_DERIVATIVE_MIN)
    && isPass(evidence.vault, 100)
    && evidence.tamperDetected
    && !isPerceptualOnlyMatch(evidence)
    && layers >= 2
    && (fused >= VERIFIED_OWNER_MIN || evidence.dna.score >= VERIFIED_OWNER_MIN)
  ) {
    return 'VERIFIED_DERIVATIVE';
  }

  // Likely Owner band (75–89) or Possible Similarity (55–74) — similarity only, no ownership
  const bandScore = Math.max(fused, support);
  const possibleContentOk = localPatchFragment
    || (dnaPartialPass(evidence) && evidence.dna.score >= POSSIBLE_MIN)
    || (isPass(evidence.visual, POSSIBLE_L3_MIN_WITHOUT_PATCH) && !dnaIsDifferent(evidence));

  if (
    vaultLocked(evidence)
    && bandScore >= LIKELY_OWNER_MIN
    && bandScore < VERIFIED_OWNER_MIN
    && possibleContentOk
    && (dnaPartialPass(evidence) || isPass(evidence.visual, LIKELY_OWNER_MIN) || layers >= 2)
  ) {
    return 'POSSIBLE_MATCH';
  }

  if (
    vaultLocked(evidence)
    && bandScore >= POSSIBLE_SIMILARITY_MIN
    && bandScore < LIKELY_OWNER_MIN
    && possibleContentOk
  ) {
    return 'POSSIBLE_MATCH';
  }

  return 'NOT_PINIT';
}

function displayLabelFor(
  verdict: AcceptanceVerdict,
  evidence: AcceptanceEvidence,
  scorecard: AcceptanceScorecard,
): string {
  if (verdict !== 'POSSIBLE_MATCH') return ACCEPTANCE_VERDICT_LABELS[verdict];
  const band = closestSimilarityLabel(evidence, scorecard);
  if (band >= LIKELY_OWNER_MIN) {
    return 'Likely Match – Manual Review Recommended';
  }
  return 'Possible Similarity – Top Candidates Only';
}

function reasonFor(
  verdict: AcceptanceVerdict,
  evidence: AcceptanceEvidence,
  scorecard: AcceptanceScorecard,
): string {
  switch (verdict) {
    case 'INSUFFICIENT_EVIDENCE':
      return evidence.failureReason
        ?? 'Investigation could not complete analysis — manual review recommended';
    case 'NOT_PINIT':
      return noVerifiedOwnerMessage(evidence, scorecard);
    case 'VERIFIED_ORIGINAL':
      return `All gates PASS — confidence ${scorecard.finalConfidence}%`;
    case 'VERIFIED_DERIVATIVE':
      return `Original identified with derivative/tamper signals — DNA ${evidence.dna.score}%, visual ${evidence.visual.score}%, confidence ${scorecard.finalConfidence}%`;
    case 'POSSIBLE_MATCH':
      return noVerifiedOwnerMessage(evidence, scorecard);
    default:
      return 'Acceptance complete';
  }
}

/**
 * Sole entry point for final investigation verdict.
 * Input is evidence only — no pre-assigned verdicts.
 *
 * retainCandidate is TRUE only for Ownership Verified (owner may be revealed).
 * POSSIBLE_MATCH keeps similarity scores for Top Candidates — does not retain owner.
 */
export function runAcceptanceEngine(evidence: AcceptanceEvidence): AcceptanceDecision {
  const scorecard = computeAcceptanceScorecard(evidence);
  const verdict = decide(evidence, scorecard);
  const isVerified = verdict === 'VERIFIED_ORIGINAL' || verdict === 'VERIFIED_DERIVATIVE';
  const support = peakSupportScore(evidence);
  const closest = closestSimilarityLabel(evidence, scorecard);

  const retrievalConfidence = isVerified
    ? Math.max(scorecard.finalConfidence, Math.round(support))
    : verdict === 'POSSIBLE_MATCH'
      ? closest
      : 0;

  const decision: AcceptanceDecision = {
    verdict,
    acceptancePolicyVersion: ACCEPTANCE_POLICY_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    confidence: retrievalConfidence,
    scorecard,
    displayLabel: displayLabelFor(verdict, evidence, scorecard),
    decisionReason: reasonFor(verdict, evidence, scorecard),
    retainCandidate: isVerified,
    retrievalConfidence,
  };

  logInvestigationScores({
    stage: 'acceptance',
    vaultId: evidence.vaultId,
    dnaRecordId: evidence.dnaRecordId,
    acceptance: {
      verdict: decision.verdict,
      confidence: decision.confidence,
      dna: evidence.dna.score,
      visual: evidence.visual.score,
      certificate: evidence.certificate.score,
      watermark: evidence.watermark.score,
      vault: evidence.vault.score,
      owner: evidence.owner.score,
      reason: decision.decisionReason,
    },
    extra: {
      scorecard: scorecard.finalConfidence,
      tamperDetected: evidence.tamperDetected,
      analysisComplete: evidence.analysisComplete,
      support,
      strongLayers: strongLayerCount(evidence),
      retainOwner: decision.retainCandidate,
    },
  });

  logger.info('[AcceptanceEngine] Decision', {
    verdict: decision.verdict,
    confidence: decision.confidence,
    displayLabel: decision.displayLabel,
    dna: evidence.dna.score,
    visual: evidence.visual.score,
    support,
    fused: scorecard.finalConfidence,
    retainCandidate: decision.retainCandidate,
  });

  return decision;
}

export function passChannel(score: number, detail?: string): EvidenceChannel {
  return { state: 'PASS', score: Math.max(0, Math.min(100, score)), detail };
}

export function failChannel(score = 0, detail?: string): EvidenceChannel {
  return { state: 'FAIL', score: Math.max(0, Math.min(100, score)), detail };
}

export function skippedChannel(detail?: string): EvidenceChannel {
  return { state: 'SKIPPED', score: 0, detail };
}
