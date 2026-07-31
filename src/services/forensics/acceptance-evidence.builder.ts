/**
 * Maps pipeline outputs → AcceptanceEvidence (evidence only, no verdicts).
 *
 * Rules:
 * - Never invent DNA from perceptual/ORB alone (proxy removed).
 * - Owner channel PASS only with certificate/watermark/signed binding — not vault lock.
 * - Metadata is informational only (never sufficient for ownership).
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
  const local = enterprise.authoritativeAsset?.localDnaHit;
  const localScore = local?.compositeScore ?? 0;
  const selectionSource = enterprise.authoritativeAsset?.selectionSource;
  const isIdentityLock = selectionSource === 'identity_hit' || selectionSource === 'sha256_exact';
  const isLocalPatch = selectionSource === 'local_patch'
    || localScore >= 55;
  let score = deep?.overallConfidenceScore
    ?? (selectionSource === 'sha256_exact' ? 100 : 0);
  // Heavy crop: full-frame DNA often <40% — local patch votes are the fragment identity signal.
  if (isLocalPatch && localScore >= 55) {
    score = Math.max(score, localScore);
  }
  // TEP / Protected Download: identity is proven without waiting on 15-layer DNA.
  if (isIdentityLock && score <= 0 && !deep) {
    const identityScore = Math.max(
      90,
      Math.round(enterprise.fusion?.identityConfidence ?? 0),
      Math.round(enterprise.fusion?.ownershipVerificationConfidence ?? 0),
    );
    return {
      ...passChannel(identityScore, 'identity_hit_tep'),
      classification: 'IDENTITY_HIT',
    };
  }
  const classification = deep?.classification
    ?? (score === 100 ? 'DNA_MATCH' : undefined)
    ?? (isLocalPatch && localScore >= 55 ? 'SIMILAR' : undefined);

  // No finished 15-layer DNA — do NOT proxy visual into DNA (perceptual alone cannot verify)
  if (score <= 0 && !deep && !(isLocalPatch && localScore >= 55)) {
    return { ...failChannel(0, 'No DNA compare result'), classification: 'MISSING' };
  }
  if ((classification ?? '').toUpperCase() === 'DIFFERENT' && score < 55) {
    return { ...failChannel(score, classification), classification };
  }
  if (isLocalPatch && localScore >= 55 && score >= 55) {
    return {
      ...passChannel(score, `local_patch_${local?.patchMatchCount ?? 0}`),
      classification: classification ?? 'SIMILAR',
    };
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
  const clip = vector?.scores.clip ?? 0;
  const local = enterprise.authoritativeAsset?.localDnaHit;
  const localScore = local?.compositeScore ?? local?.orbRefineScore ?? 0;
  const ranked = enterprise.authoritativeAsset?.rankedCandidate?.compositeScore ?? 0;
  const probableVis = enterprise.probableMatch?.visualSimilarity != null
    ? enterprise.probableMatch.visualSimilarity * 100
    : 0;
  const fusionRetrieval = enterprise.fusion?.retrievalConfidence ?? 0;
  const score = Math.max(orb, perceptual, composite, clip, localScore, ranked, probableVis, fusionRetrieval);
  if (score <= 0) return failChannel(0, 'No visual evidence');
  return passChannel(score, `orb=${Math.round(orb)} pHash=${Math.round(perceptual)} clip=${Math.round(clip)}`);
}

function certificateChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const certId = enterprise.authoritativeAsset?.certificateId ?? enterprise.certificateId;
  if (!certId) return skippedChannel('No certificate on file');
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
  // Vault lock = candidate retrieved — NOT ownership
  return passChannel(100, vaultId);
}

/**
 * Owner channel requires cryptographic binding (cert / identity fusion), not retrieval.
 * Vault lock alone must never PASS owner.
 */
function ownerChannel(enterprise: EnterpriseRecoveryResult, hasCandidate: boolean): EvidenceChannel {
  if (!hasCandidate) return failChannel(0);
  const ownership = enterprise.fusion?.ownershipVerificationConfidence ?? 0;
  const certId = enterprise.authoritativeAsset?.certificateId ?? enterprise.certificateId;
  const signals = enterprise.recoveredSignals ?? [];
  const wm = signals.find((s) => /watermark|identity_token|manifest/i.test(s.stage) && s.recovered);

  if (certId && ownership >= 90) {
    return passChannel(100, certId);
  }
  if (wm && wm.score >= 90) {
    return passChannel(Math.max(90, wm.score), wm.stage);
  }
  if (certId && ownership >= 75) {
    return passChannel(ownership, certId);
  }
  return failChannel(ownership, 'Owner not cryptographically bound — retrieval is not ownership');
}

function timelineChannel(enterprise: EnterpriseRecoveryResult, hasCandidate: boolean): EvidenceChannel {
  if (!hasCandidate) return failChannel(0);
  if (enterprise.authoritativeAsset?.dnaRecordId || enterprise.verifiedCandidate?.dnaRecordId) {
    return passChannel(100, 'Custody record present');
  }
  return failChannel(0, 'No timeline custody link');
}

function watermarkChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const signals = enterprise.recoveredSignals ?? [];
  const wm = signals.find((s) => /watermark|identity_token|manifest/i.test(s.stage) && s.recovered);
  if (wm && wm.score >= 90) return passChannel(Math.max(90, wm.score), wm.stage);
  if (wm && wm.score >= 50) return passChannel(wm.score, wm.stage);
  return failChannel(0, 'Watermark not recovered');
}

function metadataChannel(enterprise: EnterpriseRecoveryResult): EvidenceChannel {
  const vector = enterprise.authoritativeAsset?.vector;
  if (!vector) return skippedChannel('No metadata channel');
  const structural = vector.scores.structural ?? 0;
  if (structural >= 40) return passChannel(structural, 'structural_proxy');
  return skippedChannel('Metadata not evaluated');
}

function tamperDetected(enterprise: EnterpriseRecoveryResult): boolean {
  const deep = enterprise.authoritativeAsset?.deepCompare ?? enterprise.bestDeepCompare;
  if (enterprise.authoritativeAsset?.selectionSource === 'sha256_exact') return false;

  const localScore = enterprise.authoritativeAsset?.localDnaHit?.compositeScore ?? 0;
  // Local-patch lock means probe is a fragment/crop of the vault original → derivative.
  if (
    enterprise.authoritativeAsset?.selectionSource === 'local_patch'
    && localScore >= 55
  ) {
    return true;
  }

  if (!deep) return false;

  const vector = enterprise.authoritativeAsset?.vector;
  const visual = Math.max(
    vector?.scores.orb ?? 0,
    vector?.scores.perceptualBlend ?? vector?.scores.pHash ?? 0,
    vector?.scores.composite ?? 0,
    localScore,
  );
  const dna = Math.max(deep.overallConfidenceScore, localScore >= 55 ? localScore : 0);
  const crossModal = (dna + visual) / 2;

  if (deep.tamperingDetected && dna >= 72 && crossModal >= 62 && visual >= 55) {
    return true;
  }
  if (dna >= 88 && dna < 100 && deep.tamperingDetected) {
    return true;
  }
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
