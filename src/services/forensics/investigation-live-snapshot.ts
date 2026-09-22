/**
 * Progressive investigation snapshots — streamed to UI in phases.
 */
import type { InvestigationLiveSnapshot } from '../../types/unified-investigation.types';

/** A score shown as a percentage can never leave 0–100, whatever produced it. */
export function clampPercent(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}

/** Copy of a snapshot with its percentage fields held to 0–100. */
export function clampLiveScores<T extends Partial<InvestigationLiveSnapshot>>(snapshot: T): T {
  const out = { ...snapshot };
  if ('confidence' in out) out.confidence = clampPercent(out.confidence);
  if ('dnaMatchPercent' in out) out.dnaMatchPercent = clampPercent(out.dnaMatchPercent);
  return out;
}

export function mergeSnapshot(
  prev: InvestigationLiveSnapshot | null,
  patch: Partial<InvestigationLiveSnapshot>,
): InvestigationLiveSnapshot {
  // A patch that names a DIFFERENT vault is a different candidate. Everything that
  // describes the candidate — its filename, owner, scores — must come from the patch,
  // never be inherited from the lead it replaces. Inheriting is how one vault's id ended
  // up beside another vault's filename, and how a new candidate borrowed the previous
  // candidate's confidence. Process-level fields (phase, status text) still carry over.
  const differentCandidate = !!patch.vaultId && !!prev?.vaultId && patch.vaultId !== prev.vaultId;
  const lead = differentCandidate ? null : prev;

  // Never let a terminal 0% wipe a stronger live lead (crops often show vault early, then
  // fusion temporarily zeros before local-patch lock lands) — for the SAME candidate only.
  const mergedConfidence = 'confidence' in patch
    ? Math.max(patch.confidence ?? 0, lead?.confidence ?? 0) || patch.confidence
    : lead?.confidence;

  return clampLiveScores({
    phase: patch.phase ?? prev?.phase ?? 1,
    signatureFound: patch.signatureFound ?? prev?.signatureFound ?? false,
    ownerName: 'ownerName' in patch ? patch.ownerName : lead?.ownerName,
    ownerPinitId: 'ownerPinitId' in patch ? patch.ownerPinitId : lead?.ownerPinitId,
    vaultId: 'vaultId' in patch ? patch.vaultId : prev?.vaultId,
    dnaRecordId: 'dnaRecordId' in patch ? patch.dnaRecordId : lead?.dnaRecordId,
    originalFilename: patch.originalFilename ?? lead?.originalFilename,
    confidence: mergedConfidence,
    patchVotes: patch.patchVotes ?? lead?.patchVotes,
    orbScore: patch.orbScore ?? lead?.orbScore,
    similarityScore: patch.similarityScore ?? lead?.similarityScore,
    watermarkStatus: patch.watermarkStatus ?? lead?.watermarkStatus,
    certificateStatus: patch.certificateStatus ?? lead?.certificateStatus,
    dnaMatchPercent: 'dnaMatchPercent' in patch
      ? Math.max(patch.dnaMatchPercent ?? 0, lead?.dnaMatchPercent ?? 0) || patch.dnaMatchPercent
      : lead?.dnaMatchPercent,
    statusMessage: patch.statusMessage ?? prev?.statusMessage,
    deepVerificationRunning: patch.deepVerificationRunning ?? prev?.deepVerificationRunning,
  });
}
