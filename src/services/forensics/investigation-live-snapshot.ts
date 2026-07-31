/**
 * Progressive investigation snapshots — streamed to UI in phases.
 */
import type { InvestigationLiveSnapshot } from '../../types/unified-investigation.types';

export function mergeSnapshot(
  prev: InvestigationLiveSnapshot | null,
  patch: Partial<InvestigationLiveSnapshot>,
): InvestigationLiveSnapshot {
  // Never let a terminal 0% wipe a stronger live lead (crops often show vault early, then
  // fusion temporarily zeros before local-patch lock lands).
  const mergedConfidence = 'confidence' in patch
    ? Math.max(patch.confidence ?? 0, prev?.confidence ?? 0) || patch.confidence
    : prev?.confidence;

  return {
    phase: patch.phase ?? prev?.phase ?? 1,
    signatureFound: patch.signatureFound ?? prev?.signatureFound ?? false,
    ownerName: 'ownerName' in patch ? patch.ownerName : prev?.ownerName,
    ownerPinitId: 'ownerPinitId' in patch ? patch.ownerPinitId : prev?.ownerPinitId,
    vaultId: 'vaultId' in patch ? patch.vaultId : prev?.vaultId,
    dnaRecordId: 'dnaRecordId' in patch ? patch.dnaRecordId : prev?.dnaRecordId,
    originalFilename: patch.originalFilename ?? prev?.originalFilename,
    confidence: mergedConfidence,
    patchVotes: patch.patchVotes ?? prev?.patchVotes,
    orbScore: patch.orbScore ?? prev?.orbScore,
    similarityScore: patch.similarityScore ?? prev?.similarityScore,
    watermarkStatus: patch.watermarkStatus ?? prev?.watermarkStatus,
    certificateStatus: patch.certificateStatus ?? prev?.certificateStatus,
    dnaMatchPercent: 'dnaMatchPercent' in patch
      ? Math.max(patch.dnaMatchPercent ?? 0, prev?.dnaMatchPercent ?? 0) || patch.dnaMatchPercent
      : prev?.dnaMatchPercent,
    statusMessage: patch.statusMessage ?? prev?.statusMessage,
    deepVerificationRunning: patch.deepVerificationRunning ?? prev?.deepVerificationRunning,
  };
}
