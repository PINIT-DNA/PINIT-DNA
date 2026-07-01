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
    ownerName: 'ownerName' in patch ? patch.ownerName : prev?.ownerName,
    ownerPinitId: 'ownerPinitId' in patch ? patch.ownerPinitId : prev?.ownerPinitId,
    vaultId: 'vaultId' in patch ? patch.vaultId : prev?.vaultId,
    dnaRecordId: 'dnaRecordId' in patch ? patch.dnaRecordId : prev?.dnaRecordId,
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
