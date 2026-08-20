import { motion } from 'framer-motion';
import { CheckCircle2, Shield, Lock, Archive, Plus, Copy, Check, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { DnaSession } from '../types';
import { formatBytes } from '../lib/file-type-utils';
import { protectedDownloadFromVault } from '../services/dashboard.api';
import { AuthenticityReportCard } from './AuthenticityReportCard';
import { formatTrackId, formatVaultId } from '../lib/lifecycle-ids';

interface Props {
  session: DnaSession;
  onReset: () => void;
}

export function SuccessPanel({ session, onReset }: Props) {
  const [copied, setCopied] = useState(false);
  const [copiedTep, setCopiedTep] = useState(false);
  const [copiedVault, setCopiedVault] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const ms = session.totalProcessingMs;
  const vaultId = session.vault?.vaultId;
  const trackId = formatTrackId(session.tepCode, vaultId);
  const canDownload = !!vaultId || !!session.protectedBlobUrl;
  const analysis = (session.vault?.contentAnalysis ?? session.fileAnalysis ?? null);
  const imageAnalysis = analysis?.signals?.fileCategory === 'IMAGE' ? analysis : null;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(session.dnaRecordId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  const copyTep = async () => {
    try {
      await navigator.clipboard.writeText(trackId);
      setCopiedTep(true);
      setTimeout(() => setCopiedTep(false), 1800);
    } catch { /* ignore */ }
  };

  const copyVault = async () => {
    if (!vaultId) return;
    try {
      await navigator.clipboard.writeText(formatVaultId(vaultId));
      setCopiedVault(true);
      setTimeout(() => setCopiedVault(false), 1800);
    } catch { /* ignore */ }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      let url = session.protectedBlobUrl;
      if (!url && vaultId) {
        const { blob } = await protectedDownloadFromVault(vaultId);
        url = URL.createObjectURL(blob);
      }
      if (!url) throw new Error('Download not ready');
      const a = document.createElement('a');
      a.href = url;
      a.download = session.filename || session.vault?.originalFileName || 'protected-file';
      a.click();
      if (url !== session.protectedBlobUrl) URL.revokeObjectURL(url);
      setDownloadDone(true);
      toast.success('Protected file downloaded');
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed. Try again from Vault.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto w-full px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-layer-complete/30 bg-bg-card overflow-hidden shadow-lg"
      >
        <div className="px-5 pt-7 pb-5 text-center border-b border-bg-border/60 bg-layer-complete/5">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-layer-complete flex items-center justify-center shadow-md">
            <CheckCircle2 size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Your file is protected</h2>
          <p className="text-sm text-gray-400 mt-1.5">
            Identity, security, vault, and tracked download are ready.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-xl bg-bg-elevated border border-bg-border p-3.5">
            <p className="text-2xs text-gray-500 uppercase tracking-wider mb-1">File</p>
            <p className="text-sm font-medium text-white truncate">{session.filename}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
              <span className="text-2xs text-gray-500 mono">{formatBytes(session.fileSizeBytes)}</span>
              {session.mimeType && (
                <span className="text-2xs text-gray-500 mono">{session.mimeType}</span>
              )}
            </div>
          </div>

          {imageAnalysis && (
            <AuthenticityReportCard
              analysis={imageAnalysis}
              compact
              title="Image analysis"
            />
          )}

          <div className="rounded-xl bg-bg-elevated border border-bg-border p-3.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-2xs text-gray-500 uppercase tracking-wider">Protection ID</p>
              <button
                type="button"
                onClick={copyId}
                className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-white mono break-all">{session.dnaRecordId}</p>
          </div>

          {vaultId && (
            <div className="rounded-xl bg-bg-elevated border border-bg-border p-3.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-2xs text-gray-500 uppercase tracking-wider">Vault ID</p>
                <button
                  type="button"
                  onClick={copyVault}
                  className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1"
                >
                  {copiedVault ? <Check size={12} /> : <Copy size={12} />}
                  {copiedVault ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-white mono break-all">{formatVaultId(vaultId)}</p>
            </div>
          )}

          <div className="rounded-xl bg-dna-500/5 border border-dna-500/25 p-3.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-2xs text-gray-500 uppercase tracking-wider">Track ID</p>
              <button
                type="button"
                onClick={copyTep}
                className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1"
              >
                {copiedTep ? <Check size={12} /> : <Copy size={12} />}
                {copiedTep ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-sm font-bold text-dna-400 mono">{trackId}</p>
            <p className="text-2xs text-gray-500 mt-1">
              Use this when sharing the downloaded file — investigation can recover it later.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { icon: Shield, label: 'Identity', value: 'Ready' },
              { icon: Lock, label: 'Security', value: 'Locked' },
              { icon: Archive, label: 'Vault', value: vaultId ? 'Stored' : 'Ready' },
              {
                icon: Download,
                label: 'Download',
                value: session.downloadReady || session.protectedBlobUrl ? 'Ready' : canDownload ? 'Ready' : '—',
              },
            ].map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className="rounded-xl border border-bg-border bg-bg-elevated p-2.5 text-center"
              >
                <Icon size={14} className="mx-auto text-dna-400 mb-1" />
                <p className="text-2xs text-gray-500">{label}</p>
                <p className="text-2xs font-bold text-white mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>

          {canDownload && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="w-full flex items-center justify-center gap-3 rounded-2xl border-2 border-dna-500/40 bg-dna-500/10 hover:bg-dna-500/20 px-4 py-4 transition-colors disabled:opacity-60"
            >
              <span className="w-12 h-12 rounded-xl bg-dna-500 text-white flex items-center justify-center shadow-md">
                {downloading ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : downloadDone ? (
                  <Check size={22} strokeWidth={2.5} />
                ) : (
                  <Download size={22} />
                )}
              </span>
              <span className="text-left min-w-0">
                <span className="block text-sm font-bold text-white">
                  {downloading ? 'Preparing file…' : downloadDone ? 'Downloaded' : 'Download protected file'}
                </span>
                <span className="block text-2xs text-gray-400 mt-0.5">
                  Save the protected file to this device
                </span>
              </span>
            </button>
          )}

          {downloadError && (
            <p className="text-xs text-danger text-center">{downloadError}</p>
          )}

          <ul className="space-y-1.5 text-xs text-gray-400">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="text-layer-complete mt-0.5 shrink-0" />
              <span>Unique asset identity created and stored</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="text-layer-complete mt-0.5 shrink-0" />
              <span>File secured in your private vault</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="text-layer-complete mt-0.5 shrink-0" />
              <span>
                {imageAnalysis
                  ? 'End-to-end image analysis saved to Vault Explorer → Details'
                  : 'Tracked download ready — recoverable in investigation'}
              </span>
            </li>
          </ul>

          {ms != null && (
            <p className="text-center text-2xs text-gray-600">Completed in {(ms / 1000).toFixed(1)}s</p>
          )}
        </div>

        <div className="px-5 pb-6 pt-1 flex flex-col sm:flex-row gap-2">
          <button type="button" onClick={onReset} className="btn btn-secondary flex-1 py-3">
            <Plus size={16} />
            <span>Protect Another Asset</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
