/**
 * Acceptance Engine — sole authority for investigation verdicts.
 * Contract: docs/architecture/02_ACCEPTANCE_RULES.md
 *           docs/architecture/04_CONFIDENCE_SCORECARD.md
 *
 * No other module may emit VERIFIED / POSSIBLE / NOT_PINIT / INSUFFICIENT_EVIDENCE.
 */
import { logger } from '../../lib/logger';
import {
  ACCEPTANCE_POLICY_VERSION,
  DNA_ALGORITHM_VERSION,
  type AcceptanceDecision,
  type AcceptanceEvidence,
  type AcceptanceScorecard,
  type AcceptanceVerdict,
  type ChannelState,
  type EvidenceChannel,
  type ScorecardChannelResult,
} from '../../types/acceptance.types';

/** Frozen weights — acceptance-policy-v1.0 */
const WEIGHTS = {
  certificate: 25,
  dna: 30,
  visual: 15,
  metadata: 10,
  watermark: 10,
  timeline: 5,
  owner: 5,
} as const;

const DNA_FULL_PASS_MIN = 75;
const DNA_PARTIAL_MIN = 40;
/** Minimum DNA for VERIFIED_DERIVATIVE — blocks unrelated ~60% false positives */
const DNA_DERIVATIVE_VERIFIED_MIN = 72;
/** DNA + visual must average at least this for derivative ownership claims */
const CROSS_MODAL_DERIVATIVE_MIN = 62;
const VISUAL_PASS_MIN = 40;
const VISUAL_DERIVATIVE_MIN = 55;
const VISUAL_STRONG_MIN = 80;
const VERIFIED_ORIGINAL_CONFIDENCE_MIN = 95;
const VERIFIED_DERIVATIVE_CONFIDENCE_MIN = 55;

export const ACCEPTANCE_VERDICT_LABELS: Record<AcceptanceVerdict, string> = {
  VERIFIED_ORIGINAL: 'Verified PINIT Asset',
  VERIFIED_DERIVATIVE: 'Original Found — Derivative Detected',
  POSSIBLE_MATCH: 'Possible PINIT Asset — Needs Manual Review',
  NOT_PINIT: 'No PINIT Asset Found',
  INSUFFICIENT_EVIDENCE: 'Insufficient Evidence — Investigation Incomplete',
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
 * Deterministic scorecard. FAIL/SKIPPED channels contribute 0.
 * DNA DIFFERENT or below partial band forces DNA contribution to 0.
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
  if (dnaIsDifferent(evidence) && evidence.dna.score < DNA_PARTIAL_MIN) return false;
  if (dnaIsDifferent(evidence) && evidence.dna.score < 55) return false;
  return evidence.dna.state === 'PASS' && evidence.dna.score >= DNA_PARTIAL_MIN;
}

function crossModalAverage(evidence: AcceptanceEvidence): number {
  return (evidence.dna.score + evidence.visual.score) / 2;
}

function passesDerivativeCrossModal(evidence: AcceptanceEvidence): boolean {
  return crossModalAverage(evidence) >= CROSS_MODAL_DERIVATIVE_MIN;
}

function decide(evidence: AcceptanceEvidence, scorecard: AcceptanceScorecard): AcceptanceVerdict {
  if (!evidence.analysisComplete) {
    return 'INSUFFICIENT_EVIDENCE';
  }

  if (!evidence.hasCandidate) {
    return 'NOT_PINIT';
  }

  // Hard rule: DNA DIFFERENT / low DNA cannot be VERIFIED_*
  const dnaBlocksVerified = dnaIsDifferent(evidence) || evidence.dna.score < DNA_PARTIAL_MIN
    || evidence.dna.state === 'FAIL' || evidence.dna.state === 'SKIPPED';

  // VERIFIED ORIGINAL — all gates PASS + confidence > 95
  if (
    !dnaBlocksVerified
    && dnaFullPass(evidence)
    && isPass(evidence.certificate, 100)
    && isPass(evidence.vault, 100)
    && isPass(evidence.owner, 100)
    && isPass(evidence.timeline, 100)
    && scorecard.finalConfidence > VERIFIED_ORIGINAL_CONFIDENCE_MIN
    && !evidence.tamperDetected
  ) {
    return 'VERIFIED_ORIGINAL';
  }

  // VERIFIED DERIVATIVE — original identified, tamper detected
  if (
    !dnaBlocksVerified
    && dnaPartialPass(evidence)
    && evidence.dna.score >= DNA_DERIVATIVE_VERIFIED_MIN
    && passesDerivativeCrossModal(evidence)
    && scorecard.finalConfidence >= VERIFIED_DERIVATIVE_CONFIDENCE_MIN
    && isPass(evidence.visual, VISUAL_DERIVATIVE_MIN)
    && isPass(evidence.timeline, 50)
    && isPass(evidence.owner, 50)
    && isPass(evidence.vault, 100)
    && evidence.tamperDetected
    && (evidence.dna.score >= 85 || evidence.visual.score >= 65)
  ) {
    return 'VERIFIED_DERIVATIVE';
  }

  // Also derivative when DNA full but tamper detected (cannot be ORIGINAL)
  if (
    !dnaBlocksVerified
    && dnaFullPass(evidence)
    && passesDerivativeCrossModal(evidence)
    && scorecard.finalConfidence >= VERIFIED_DERIVATIVE_CONFIDENCE_MIN
    && isPass(evidence.visual, VISUAL_DERIVATIVE_MIN)
    && isPass(evidence.owner, 50)
    && isPass(evidence.vault, 100)
    && evidence.tamperDetected
  ) {
    return 'VERIFIED_DERIVATIVE';
  }

  // POSSIBLE MATCH — visual strong, DNA partial, no cert/watermark
  const certMissing = evidence.certificate.state === 'FAIL' || evidence.certificate.state === 'SKIPPED';
  const watermarkMissing = evidence.watermark.state === 'FAIL' || evidence.watermark.state === 'SKIPPED';

  // Unrelated lookalikes: weak DNA + weak visual cannot be PINIT (before POSSIBLE_MATCH)
  if (
    evidence.hasCandidate
    && !passesDerivativeCrossModal(evidence)
    && evidence.dna.score < 80
    && evidence.visual.score < 70
  ) {
    return 'NOT_PINIT';
  }

  // Mid-band similarity without strong visual — common false lead on unrelated photos
  if (
    evidence.hasCandidate
    && evidence.tamperDetected
    && evidence.dna.score >= 40
    && evidence.dna.score < 85
    && evidence.visual.score < 65
  ) {
    return 'NOT_PINIT';
  }

  if (
    !dnaBlocksVerified
    && isPass(evidence.visual, VISUAL_STRONG_MIN)
    && dnaPartialPass(evidence)
    && evidence.dna.score < DNA_FULL_PASS_MIN
    && certMissing
    && watermarkMissing
    && isPass(evidence.vault, 100)
  ) {
    return 'POSSIBLE_MATCH';
  }

  // Broader possible: partial DNA + vault locked, cert not fully valid
  if (
    !dnaBlocksVerified
    && dnaPartialPass(evidence)
    && isPass(evidence.vault, 100)
    && isPass(evidence.visual, VISUAL_PASS_MIN)
    && certMissing
  ) {
    return 'POSSIBLE_MATCH';
  }

  return 'NOT_PINIT';
}

function reasonFor(
  verdict: AcceptanceVerdict,
  evidence: AcceptanceEvidence,
  scorecard: AcceptanceScorecard,
): string {
  switch (verdict) {
    case 'INSUFFICIENT_EVIDENCE':
      return evidence.failureReason
        ?? 'Investigation could not complete analysis';
    case 'NOT_PINIT':
      if (!evidence.hasCandidate) {
        return 'No vault candidate passed evidence gates';
      }
      if (dnaIsDifferent(evidence) || evidence.dna.score < DNA_PARTIAL_MIN) {
        return `DNA does not confirm vault pairing (${evidence.dna.score}% ${evidence.dna.classification ?? 'FAIL'})`;
      }
      return 'Evidence insufficient for PINIT ownership claim';
    case 'VERIFIED_ORIGINAL':
      return `All gates PASS — confidence ${scorecard.finalConfidence}%`;
    case 'VERIFIED_DERIVATIVE':
      return `Original identified with tamper detected — DNA ${evidence.dna.score}%, confidence ${scorecard.finalConfidence}%`;
    case 'POSSIBLE_MATCH':
      return `Partial evidence — DNA ${evidence.dna.score}%, visual ${evidence.visual.score}% — needs manual review`;
    default:
      return 'Acceptance complete';
  }
}

/**
 * Sole entry point for final investigation verdict.
 * Input is evidence only — no pre-assigned verdicts.
 */
export function runAcceptanceEngine(evidence: AcceptanceEvidence): AcceptanceDecision {
  const scorecard = computeAcceptanceScorecard(evidence);
  const verdict = decide(evidence, scorecard);
  const retainCandidate = verdict !== 'NOT_PINIT' && verdict !== 'INSUFFICIENT_EVIDENCE';
  const retrievalConfidence = retainCandidate ? scorecard.finalConfidence : 0;

  const decision: AcceptanceDecision = {
    verdict,
    acceptancePolicyVersion: ACCEPTANCE_POLICY_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    confidence: retainCandidate ? scorecard.finalConfidence : 0,
    scorecard,
    displayLabel: ACCEPTANCE_VERDICT_LABELS[verdict],
    decisionReason: reasonFor(verdict, evidence, scorecard),
    retainCandidate,
    retrievalConfidence,
  };

  logger.info('[AcceptanceEngine] Decision', {
    verdict: decision.verdict,
    confidence: decision.confidence,
    policy: decision.acceptancePolicyVersion,
    dnaVersion: decision.dnaAlgorithmVersion,
    retainCandidate: decision.retainCandidate,
    vaultId: evidence.vaultId?.slice(0, 8) ?? null,
    dnaScore: evidence.dna.score,
    dnaClass: evidence.dna.classification ?? null,
    visualScore: evidence.visual.score,
    certState: evidence.certificate.state,
    analysisComplete: evidence.analysisComplete,
  });

  return decision;
}

/** Helper for tests and adapters — build a FAIL channel. */
export function failChannel(score = 0, detail?: string): EvidenceChannel {
  return { state: 'FAIL', score, detail };
}

export function passChannel(score: number, detail?: string): EvidenceChannel {
  return { state: 'PASS', score: Math.max(0, Math.min(100, score)), detail };
}

export function skippedChannel(detail?: string): EvidenceChannel {
  return { state: 'SKIPPED', score: 0, detail };
}

export function channelStateFromScore(score: number, passMin: number): ChannelState {
  if (score <= 0) return 'FAIL';
  return score >= passMin ? 'PASS' : 'FAIL';
}
