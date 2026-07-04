/**
 * Maps pipeline outputs → AcceptanceEvidence (evidence only, no verdicts).
 */
import type { EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import type { AcceptanceEvidence, EvidenceChannel } from '../../types/acceptance.types';
import {
  failChannel,
  passChannel,
  skippedChannel,
} from './acceptance-engine.service';
import { resolveAuthoritativeCandidate } from './investigation-decision-resolver.service';

function dnaChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel & { classification?: string } {
  const deep = enterprise.authoritativeAsset?.deepCompare ?? enterprise.bestDeepCompare;
  const score = deep?.overallConfidenceScore
    ?? (enterprise.authoritativeAsset?.selectionSource === 'sha256_exact' ? 100 : 0);
  const classification = deep?.classification ?? (score === 100 ? 'DNA_MATCH' : undefined);

  if (score <= 0 && !deep) {
    return { ...failChannel(0, 'No DNA compare result'), classification: 'MISSING' };
  }
  if ((classification ?? '').toUpperCase() === 'DIFFERENT' && score < 55) {
    return { ...failChannel(score, classification), classification };
  }
  if (score >= 40) {
    return { ...passChannel(score, classification), classification };
  }
  return { ...failChannel(score, classification), classification };
}

function visualChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const vector = enterprise.authoritativeAsset?.vector;
  const orb = vector?.scores.orb ?? 0;
  const perceptual = vector?.scores.perceptualBlend ?? vector?.scores.pHash ?? 0;
  const composite = vector?.scores.composite ?? 0;
  const local = enterprise.authoritativeAsset?.localDnaHit;
  const localScore = local?.compositeScore ?? local?.orbRefineScore ?? 0;
  const score = Math.max(orb, perceptual, composite, localScore);
  if (score <= 0) return failChannel(0, 'No visual evidence');
  return passChannel(score);
}

function certificateChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const certId = enterprise.authoritativeAsset?.certificateId ?? enterprise.certificateId;
  if (!certId) return skippedChannel('No certificate on file');
  // Pipeline sets certificateScore on fusion path; treat high ownership cert as valid when present
  const certScore = enterprise.fusion?.ownershipVerificationConfidence ?? 0;
  if (certScore >= 90) return passChannel(100, certId);
  if (certScore >= 40) return passChannel(certScore, certId);
  return failChannel(certScore, 'Certificate not fully verified');
}

function vaultChannel(enterprise: EnterpriseRecoveryResult, hasCandidate: boolean): EvidenceChannel {
  if (!hasCandidate) return failChannel(0, 'No vault candidate');
  const vaultId = enterprise.authoritativeAsset?.vaultId
    ?? enterprise.verifiedCandidate?.vaultId
    ?? enterprise.probableMatch?.vaultId;
  if (!vaultId) return failChannel(0, 'Vault not locked');
  return passChannel(100, vaultId);
}

function ownerChannel(enterprise: EnterpriseRecoveryResult, hasCandidate: boolean): EvidenceChannel {
  if (!hasCandidate) return failChannel(0);
  const ownerId = enterprise.authoritativeAsset?.ownerUserId
    ?? enterprise.verifiedCandidate?.ownerUserId;
  const ownerPinit = enterprise.authoritativeAsset?.ownerPinitId ?? enterprise.ownerShortId;
  if (!ownerId && !ownerPinit) return failChannel(0, 'Owner not bound');
  const score = enterprise.fusion?.ownershipVerificationConfidence ?? 50;
  return passChannel(Math.max(50, score));
}

function timelineChannel(enterprise: EnterpriseRecoveryResult, hasCandidate: boolean): EvidenceChannel {
  if (!hasCandidate) return failChannel(0);
  // Registration exists when we have authoritative asset / DNA record
  if (enterprise.authoritativeAsset?.dnaRecordId || enterprise.verifiedCandidate?.dnaRecordId) {
    return passChannel(100, 'Custody record present');
  }
  return failChannel(0, 'No timeline custody link');
}

function watermarkChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const signals = enterprise.recoveredSignals ?? [];
  const wm = signals.find((s) => /watermark|identity_token|manifest/i.test(s.stage) && s.recovered);
  if (wm) return passChannel(Math.max(50, wm.score), wm.stage);
  return failChannel(0, 'Watermark not recovered');
}

function metadataChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const vector = enterprise.authoritativeAsset?.vector;
  if (!vector) return skippedChannel('No metadata channel');
  // Structural as weak metadata proxy when present
  const structural = vector.scores.structural ?? 0;
  if (structural >= 40) return passChannel(structural);
  return skippedChannel('Metadata not evaluated');
}

function tamperDetected(enterprise: EnterpriseRecoveryResult): boolean {
  const deep = enterprise.authoritativeAsset?.deepCompare ?? enterprise.bestDeepCompare;
  if (deep?.tamperingDetected) return true;
  if (deep && deep.overallConfidenceScore < 95 && deep.overallConfidenceScore >= 40) return true;
  if (enterprise.authoritativeAsset?.selectionSource === 'sha256_exact') return false;
  return false;
}

export interface BuildEvidenceOptions {
  analysisComplete?: boolean;
  failureReason?: string;
}

/**
 * Build acceptance evidence from enterprise recovery result.
 * Does not assign a verdict.
 */
export function buildAcceptanceEvidenceFromEnterprise(
  enterprise: EnterpriseRecoveryResult,
  options?: BuildEvidenceOptions,
): AcceptanceEvidence {
  const candidate = resolveAuthoritativeCandidate(enterprise);
  const hasCandidate = !!candidate;
  const analysisComplete = options?.analysisComplete !== false;

  return {
    analysisComplete,
    failureReason: options?.failureReason,
    hasCandidate,
    vaultId: candidate?.vaultId ?? enterprise.authoritativeAsset?.vaultId,
    dnaRecordId: candidate?.dnaRecordId ?? enterprise.authoritativeAsset?.dnaRecordId,
    ownerUserId: candidate?.ownerUserId ?? enterprise.authoritativeAsset?.ownerUserId,
    ownerPinitId: enterprise.authoritativeAsset?.ownerPinitId ?? enterprise.ownerShortId ?? undefined,
    dna: dnaChannel(enterprise),
    certificate: certificateChannel(enterprise),
    vault: vaultChannel(enterprise, hasCandidate),
    owner: ownerChannel(enterprise, hasCandidate),
    timeline: timelineChannel(enterprise, hasCandidate),
    visual: visualChannel(enterprise),
    watermark: watermarkChannel(enterprise),
    metadata: metadataChannel(enterprise),
    tamperDetected: tamperDetected(enterprise),
  };
}
