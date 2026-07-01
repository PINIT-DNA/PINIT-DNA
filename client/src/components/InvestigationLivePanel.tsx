import { CheckCircle, Dna, Fingerprint, Loader2, Shield, User } from 'lucide-react';
import type { InvestigationLiveSnapshot } from '../services/dashboard.api';
import { cn } from './ui/utils';

interface Props {
  snapshot: InvestigationLiveSnapshot;
  previewUrl?: string | null;
  fileName?: string;
}

function shortId(id?: string): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function phaseLabel(phase: InvestigationLiveSnapshot['phase']): string {
  if (phase === 1) return 'Identity located';
  if (phase === 2) return 'Patch DNA verified';
  if (phase === 3) return 'Deep forensic verification';
  if (phase === 'final') return 'Final decision';
  return 'Investigation complete';
}

export function InvestigationLivePanel({ snapshot, previewUrl, fileName }: Props) {
  const phase = snapshot.phase;
  const phaseNum = typeof phase === 'number' ? phase : phase === 'final' ? 4 : 3;
  const confidence = snapshot.dnaMatchPercent ?? snapshot.confidence;

  return (
    <div className="card border border-dna-500/30 bg-dna-500/5 overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Probe"
            className="w-full sm:w-28 h-28 rounded-lg border border-bg-border object-contain bg-black/40 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {snapshot.signatureFound ? (
                <CheckCircle size={18} className="text-green-400 shrink-0" />
              ) : (
                <Loader2 size={18} className="text-dna-400 animate-spin shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold text-white">
                  {snapshot.signatureFound
                    ? '✓ PINIT Signature Found'
                    : phaseNum >= 4
                      ? 'No PINIT Signature Found'
                      : 'Scanning for PINIT signature…'}
                </p>
                <p className="text-2xs text-dna-400">{phaseLabel(phase)}</p>
              </div>
            </div>
            {confidence != null && (
              <div className="text-right shrink-0">
                <p className="text-2xs text-gray-500 uppercase">Confidence</p>
                <p className="text-xl font-bold text-white mono">{Math.round(confidence)}%</p>
              </div>
            )}
          </div>

          {(snapshot.ownerName || snapshot.ownerPinitId) && (
            <div className="flex items-center gap-2 text-xs">
              <User size={14} className="text-gray-500 shrink-0" />
              <span className="text-gray-500">Possible Owner</span>
              <span className="text-white font-semibold truncate">
                {snapshot.ownerName ?? snapshot.ownerPinitId}
              </span>
              {snapshot.ownerName && snapshot.ownerPinitId && (
                <span className="text-gray-500 mono text-2xs">({snapshot.ownerPinitId})</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {snapshot.vaultId && (
              <div className="rounded-lg bg-bg-elevated p-2">
                <p className="text-2xs text-gray-500 flex items-center gap-1">
                  <Shield size={10} /> Vault ID
                </p>
                <p className="mono text-white truncate mt-0.5">{shortId(snapshot.vaultId)}</p>
              </div>
            )}
            {snapshot.originalFilename && (
              <div className="rounded-lg bg-bg-elevated p-2 col-span-2 sm:col-span-1">
                <p className="text-2xs text-gray-500">Original File</p>
                <p className="text-white truncate mt-0.5">{snapshot.originalFilename}</p>
              </div>
            )}
            {snapshot.patchVotes != null && phaseNum >= 2 && (
              <div className="rounded-lg bg-bg-elevated p-2">
                <p className="text-2xs text-gray-500 flex items-center gap-1">
                  <Dna size={10} /> Patch Matches
                </p>
                <p className="text-white font-bold mt-0.5">{snapshot.patchVotes}</p>
              </div>
            )}
            {snapshot.orbScore != null && phaseNum >= 2 && (
              <div className="rounded-lg bg-bg-elevated p-2">
                <p className="text-2xs text-gray-500">ORB Score</p>
                <p className="text-white font-bold mt-0.5">{Math.round(snapshot.orbScore)}%</p>
              </div>
            )}
            {snapshot.similarityScore != null && phaseNum >= 2 && (
              <div className="rounded-lg bg-bg-elevated p-2">
                <p className="text-2xs text-gray-500">Similarity</p>
                <p className="text-white font-bold mt-0.5">{Math.round(snapshot.similarityScore)}%</p>
              </div>
            )}
          </div>

          {snapshot.watermarkStatus && (
            <p className="text-2xs text-green-400">
              Watermark: {snapshot.watermarkStatus}
            </p>
          )}

          {snapshot.statusMessage && (
            <p className={cn(
              'text-xs flex items-center gap-2',
              snapshot.deepVerificationRunning ? 'text-dna-400' : 'text-gray-400',
            )}>
              {snapshot.deepVerificationRunning && (
                <Loader2 size={12} className="animate-spin shrink-0" />
              )}
              {!snapshot.deepVerificationRunning && phaseNum >= 2 && (
                <Fingerprint size={12} className="text-dna-400 shrink-0" />
              )}
              {snapshot.statusMessage}
            </p>
          )}

          {fileName && (
            <p className="text-2xs text-gray-600 mono truncate">{fileName}</p>
          )}
        </div>
      </div>
    </div>
  );
}
