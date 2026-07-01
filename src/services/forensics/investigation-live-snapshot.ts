/**
 * Progressive investigation snapshots — streamed to UI in phases.
 */
import type { InvestigationLiveSnapshot } from '../../types/unified-investigation.types';

export function mergeSnapshot(
  prev: InvestigationLiveSnapshot | null,
  patch: Partial<InvestigationLiveSnapshot>,
): InvestigationLiveSnapshot {
  return {
    phase: patch.phase ?? prev?.phase ?? 1,
    signatureFound: patch.signatureFound ?? prev?.signatureFound ?? false,
    ownerName: patch.ownerName ?? prev?.ownerName,
    ownerPinitId: patch.ownerPinitId ?? prev?.ownerPinitId,
    vaultId: patch.vaultId ?? prev?.vaultId,
    dnaRecordId: patch.dnaRecordId ?? prev?.dnaRecordId,
    originalFilename: patch.originalFilename ?? prev?.originalFilename,
    confidence: patch.confidence ?? prev?.confidence,
    patchVotes: patch.patchVotes ?? prev?.patchVotes,
    orbScore: patch.orbScore ?? prev?.orbScore,
    similarityScore: patch.similarityScore ?? prev?.similarityScore,
    watermarkStatus: patch.watermarkStatus ?? prev?.watermarkStatus,
    certificateStatus: patch.certificateStatus ?? prev?.certificateStatus,
    dnaMatchPercent: patch.dnaMatchPercent ?? prev?.dnaMatchPercent,
    statusMessage: patch.statusMessage ?? prev?.statusMessage,
    deepVerificationRunning: patch.deepVerificationRunning ?? prev?.deepVerificationRunning,
  };
}
