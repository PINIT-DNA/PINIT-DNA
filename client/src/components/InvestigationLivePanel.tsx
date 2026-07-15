import { CheckCircle, Dna, Fingerprint, Loader2, Shield, User } from 'lucide-react';
import type { InvestigationLiveSnapshot } from '../services/dashboard.api';
import { InvestigationFilePreview } from './InvestigationFilePreview';
import { cn } from './ui/utils';

/** Align with RANKING_TRUSTED_LEAD_MIN / investigation-match-policy — mid-band lookalikes are not strong leads */
const STRONG_CANDIDATE_MIN = 75;

interface Props {
  snapshot: InvestigationLiveSnapshot;
  /** Prefer file for video/audio/PDF preview — blob img breaks for video */
  file?: File | null;
  previewUrl?: string | null;
  fileName?: string;
}

function shortId(id?: string): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function phaseLabel(phase: InvestigationLiveSnapshot['phase'], strongMatch: boolean, confidence?: number | null): string {
  if (!strongMatch && (confidence == null || confidence < STRONG_CANDIDATE_MIN)) {
    if (phase === 'final') return 'Needs manual review';
    return 'Refining candidates…';
  }
  if (phase === 1) return strongMatch ? 'Strong candidate — verifying' : 'Weak lead — refining';
  if (phase === 2) return 'Patch DNA verified';
  if (phase === 3) return 'Deep forensic verification';
  if (phase === 'final') return 'Final decision';
  return 'Investigation complete';
}

export function InvestigationLivePanel({ snapshot, file, previewUrl }: Props) {
  const phase = snapshot.phase;
  const phaseNum = typeof phase === 'number' ? phase : phase === 'final' ? 4 : 3;
  const confidence = snapshot.dnaMatchPercent ?? snapshot.confidence;
  // Do not show green "Signature Found" or owner for weak lookalikes (false positives).
  const strongMatch = !!snapshot.signatureFound && (confidence == null || confidence >= STRONG_CANDIDATE_MIN);
  const midBandCandidate = !strongMatch
    && !!(snapshot.vaultId || snapshot.originalFilename)
    && (confidence == null || confidence >= 55);
  const showOwnerLead = (strongMatch || midBandCandidate)
    && !!(snapshot.ownerName || snapshot.ownerPinitId || snapshot.originalFilename || snapshot.vaultId);

  const headline = strongMatch
    ? '✓ Strong candidate lead — verifying'
    : phaseNum >= 4
      ? (midBandCandidate
        ? '⚠ Possible PINIT candidate — manual review'
        : confidence != null && confidence < STRONG_CANDIDATE_MIN
          ? '⚠ Needs Manual Review — low confidence'
          : 'No PINIT Signature Found')
      : snapshot.signatureFound || midBandCandidate
        ? 'Candidate found — verifying…'
        : (confidence != null && confidence < STRONG_CANDIDATE_MIN
          ? 'Weak lookalike — refining (do not treat as match)…'
          : 'Scanning for PINIT signature…');


  return (
    <div className="card border border-dna-500/30 bg-dna-500/5 overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {(file || previewUrl) && (
          <div className="w-full sm:w-28 h-28 rounded-lg border border-bg-border bg-black/40 shrink-0 overflow-hidden">
            {file ? (
              <InvestigationFilePreview file={file} className="w-full h-full object-contain" />
            ) : (
              <img
                src={previewUrl!}
                alt="Probe"
                className="w-full h-full object-contain"
              />
            )}
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {strongMatch ? (
                <CheckCircle size={18} className="text-green-400 shrink-0" />
              ) : (
                <Loader2 size={18} className="text-dna-400 animate-spin shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold text-white">
                  {headline}
                </p>
                <p className="text-2xs text-dna-400">{phaseLabel(phase, strongMatch || midBandCandidate, confidence)}</p>
              </div>
            </div>
            {confidence != null && (
              <div className="text-right shrink-0">
                <p className="text-2xs text-gray-500 uppercase">Confidence</p>
                <p className={cn(
                  'text-xl font-bold mono',
                  strongMatch ? 'text-green-400' : 'text-yellow-400',
                )}>
                  {Math.round(confidence)}%
                </p>
              </div>
            )}
          </div>

          {showOwnerLead && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {(strongMatch || midBandCandidate) && (snapshot.ownerName || snapshot.ownerPinitId) && (
                <div className="flex items-center gap-2 min-w-0">
                  <User size={12} className="text-gray-500 shrink-0" />
                  <span className="text-gray-500">{strongMatch ? 'Possible Owner' : 'Vault Registrant'}</span>
                  <span className="text-white truncate">
                    {snapshot.ownerName ?? snapshot.ownerPinitId}
                    {snapshot.ownerName && snapshot.ownerPinitId ? ` (${snapshot.ownerPinitId})` : ''}
                  </span>
                </div>
              )}
              {snapshot.vaultId && (
                <div className="flex items-center gap-2 min-w-0">
                  <Shield size={12} className="text-gray-500 shrink-0" />
                  <span className="text-gray-500">Vault</span>
                  <span className="text-white mono">{shortId(snapshot.vaultId)}</span>
                </div>
              )}
              {snapshot.originalFilename && (
                <div className="flex items-center gap-2 min-w-0 sm:col-span-2">
                  <Fingerprint size={12} className="text-gray-500 shrink-0" />
                  <span className="text-gray-500">Original File</span>
                  <span className="text-white truncate">{snapshot.originalFilename}</span>
                </div>
              )}
              {strongMatch && snapshot.watermarkStatus && (
                <div className="flex items-center gap-2 min-w-0 sm:col-span-2">
                  <Dna size={12} className="text-gray-500 shrink-0" />
                  <span className="text-gray-500">Watermark</span>
                  <span className="text-white">{snapshot.watermarkStatus}</span>
                </div>
              )}
            </div>
          )}

          {snapshot.statusMessage && (
            <p className="text-2xs text-gray-500">{snapshot.statusMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
