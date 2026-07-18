import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Lock,
  MapPin,
  ShieldCheck,
  Share2,
  FileSearch,
  Activity,
  Download,
  Eye,
  Trash2,
  RefreshCw,
  Users,
  ChevronRight,
  Microscope,
  Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { VaultFileThumbnail } from './VaultFileThumbnail';
import { Badge } from './ui/Badge';
import { cn } from './ui/utils';
import { formatBytes } from '../hooks/useApi';
import {
  getVaultFileTypeDisplay,
  resolveVaultFileMime,
} from '../lib/file-type-utils';
import { API_BASE_URL } from '../config/api.config';
import { BRAND } from '../config/brand.config';
import { api, retrieveFromVault, getVaultTracking, protectedDownloadFromVault, type VaultTrackingDashboard } from '../services/dashboard.api';
import { useAuth } from '../context/AuthContext';
import type { VaultRecord } from '../types/dashboard.types';

type PanelTab = 'overview' | 'details' | 'permissions' | 'activity';

interface VaultShareLink {
  id: string;
  token: string;
  filename: string;
  createdAt: string;
  isActive: boolean;
  viewCount: number;
  downloadCount: number;
  expiresAt: string | null;
  maxViews: number | null;
  allowDownload: boolean;
  accessLogs?: Array<{
    id: string;
    action: string;
    country: string | null;
    device: string | null;
    createdAt: string;
  }>;
}

interface VaultDetailSidePanelProps {
  record: VaultRecord;
  onClose: () => void;
  onShare: () => void;
  onDelete: () => void;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Details' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'activity', label: 'Activity' },
];

function QuickAction({
  icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-3 rounded-xl border text-center transition-colors min-h-[72px]',
        variant === 'danger'
          ? 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400'
          : 'border-bg-border bg-bg-elevated hover:border-dna-500/30 hover:bg-dna-500/5 text-gray-300 hover:text-white',
      )}
    >
      <span className="text-dna-400">{icon}</span>
      <span className="text-2xs font-medium leading-tight">{label}</span>
    </button>
  );
}

export function VaultDetailSidePanel({
  record,
  onClose,
  onShare,
  onDelete,
}: VaultDetailSidePanelProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<PanelTab>('overview');
  const [links, setLinks] = useState<VaultShareLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [tracking, setTracking] = useState<VaultTrackingDashboard | null>(null);
  const [loadingTracking, setLoadingTracking] = useState(true);
  const [retrieving, setRetrieving] = useState(false);
  const [protectDownloading, setProtectDownloading] = useState(false);
  const [copiedTep, setCopiedTep] = useState<string | null>(null);

  const refreshTracking = async () => {
    try {
      const t = await getVaultTracking(record.id);
      setTracking(t);
    } catch {
      /* keep previous */
    }
  };

  const fileType = getVaultFileTypeDisplay(record.originalMimeType, record.originalFileName);
  const resolvedMime = resolveVaultFileMime(undefined, record.originalMimeType, record.originalFileName);
  const tepPackages = tracking?.tepPackages ?? [];
  const latestTep = tepPackages[0] ?? null;

  useEffect(() => {
    setTab('overview');
    setLoadingLinks(true);
    setLoadingTracking(true);
    setTracking(null);
    void (async () => {
      try {
        const r = await api.get(`${API_BASE_URL}/share/vault/${record.id}`);
        const data = r.data as { links?: VaultShareLink[] };
        setLinks(data.links ?? []);
      } catch {
        setLinks([]);
      } finally {
        setLoadingLinks(false);
      }
    })();
    void (async () => {
      try {
        const t = await getVaultTracking(record.id);
        setTracking(t);
      } catch {
        setTracking(null);
      } finally {
        setLoadingTracking(false);
      }
    })();
  }, [record.id]);

  const copyTep = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedTep(code);
      setTimeout(() => setCopiedTep(null), 1600);
      toast.success('Tracking code copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const activeLinks = links.filter((l) => l.isActive);
  const totalViews = links.reduce((s, l) => s + (l.viewCount ?? 0), 0);
  const accessEvents = links.flatMap((l) => l.accessLogs ?? []);

  /** Protected tracked download — embeds identity for later investigation */
  const handleProtectedDownload = async () => {
    setProtectDownloading(true);
    try {
      const { blob, tepCode } = await protectedDownloadFromVault(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.originalFileName;
      a.click();
      URL.revokeObjectURL(url);
      await refreshTracking();
      toast.success(
        tepCode
          ? `Protected file downloaded — tracking code ${tepCode}`
          : 'Protected file downloaded',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Protected download failed');
    } finally {
      setProtectDownloading(false);
    }
  };

  /** Plain vault retrieve — only for owner backup (no tracking embed) */
  const handleDownloadOriginal = async () => {
    setRetrieving(true);
    try {
      const blob = await retrieveFromVault(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.originalFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Original retrieved (not tracked for sharing)');
    } catch {
      toast.error('Failed to retrieve file');
    } finally {
      setRetrieving(false);
    }
  };

  const handleAccessIntelligence = () => {
    const active = links.find((l) => l.isActive);
    if (active) {
      navigate(`/access-intelligence/${encodeURIComponent(active.token)}`);
      return;
    }
    navigate('/access-intelligence');
  };

  useEffect(() => {
    const main = document.querySelector('main.mobile-main') as HTMLElement | null;
    const isMobile = () => window.matchMedia('(max-width: 1023px)').matches;
    if (!main || !isMobile()) return;
    const prev = main.style.overflow;
    main.style.overflow = 'hidden';
    return () => {
      main.style.overflow = prev;
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="lg:hidden fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
        aria-label="Close file details"
      />
      <aside
        className={cn(
          'flex flex-col bg-bg-card z-50',
          'fixed inset-x-0 bottom-0 w-full max-h-[min(92dvh,900px)] rounded-t-2xl border-t border-bg-border shadow-2xl',
          'lg:static lg:inset-auto lg:max-h-[calc(100vh-5rem)] lg:w-[400px] xl:w-[420px] lg:shrink-0',
          'lg:border-l lg:border-t-0 lg:rounded-none lg:shadow-none lg:sticky lg:top-4',
        )}
      >
        <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0" aria-hidden>
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border shrink-0">
        <p className="text-sm font-semibold text-white truncate pr-2">File Details</p>
        <button type="button" onClick={onClose} className="btn-ghost btn-icon text-gray-500 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        <div className="relative aspect-video bg-bg-elevated border-b border-bg-border">
          <VaultFileThumbnail
            vaultId={record.id}
            fileName={record.originalFileName}
            mimeType={record.originalMimeType}
            variant="gallery"
            className="w-full h-full min-h-[180px]"
          />
        </div>

        <div className="p-4 space-y-3 border-b border-bg-border">
          <div>
            <h2 className="text-base font-bold text-white break-words">{record.originalFileName}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {fileType}
              {' · '}
              {formatBytes(record.originalSizeBytes)}
              {' · '}
              {format(new Date(record.createdAt), 'MMM d, yyyy · h:mm a')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="success" dot>Protected</Badge>
            <span className="text-2xs text-gray-500 mono">{record.id.slice(0, 12)}…</span>
          </div>
        </div>

        <div className="flex border-b border-bg-border px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors',
                tab === t.id
                  ? 'border-dna-500 text-dna-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {tab === 'overview' && (
            <>
              <section>
                <h3 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Encryption &amp; Protection
                </h3>
                <dl className="space-y-2 text-xs">
                  {[
                    ['Status', 'Protected'],
                    ['Encryption', record.encryptionAlgorithm],
                    ['DNA Verified', 'Verified'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="text-white font-medium text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h3 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  DNA Verification
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">DNA Record</dt>
                    <dd className="text-dna-400 mono text-right truncate max-w-[180px]">{record.dnaRecordId.slice(0, 16)}…</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Watermark</dt>
                    <dd className="text-white">Enabled</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">AI Tracking</dt>
                    <dd className="text-white">Active</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Protected Downloads
                </h3>
                {loadingTracking ? (
                  <div className="flex justify-center py-4">
                    <RefreshCw size={16} className="animate-spin text-gray-500" />
                  </div>
                ) : tepPackages.length === 0 ? (
                  <div className="rounded-lg border border-bg-border bg-bg-elevated p-3 space-y-2">
                    <p className="text-xs text-gray-400">
                      No tracked download yet. Use Download Protected to create a tracking code for sharing.
                    </p>
                    <button
                      type="button"
                      onClick={handleProtectedDownload}
                      disabled={protectDownloading}
                      className="text-2xs text-dna-400 hover:text-white font-semibold disabled:opacity-50"
                    >
                      {protectDownloading ? 'Preparing…' : 'Download Protected →'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {latestTep && (
                      <div className="rounded-lg border border-dna-500/25 bg-dna-500/5 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-2xs text-gray-500">Latest tracking code</p>
                          <Badge variant={latestTep.status === 'ACTIVE' || latestTep.status === 'active' ? 'success' : 'muted'}>
                            {latestTep.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-dna-400 mono flex-1 truncate">{latestTep.tepCode}</p>
                          <button
                            type="button"
                            onClick={() => copyTep(latestTep.tepCode)}
                            className="text-2xs text-gray-400 hover:text-white shrink-0"
                          >
                            {copiedTep === latestTep.tepCode ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p className="text-2xs text-gray-500">
                          {format(new Date(latestTep.createdAt), 'MMM d, yyyy · h:mm a')}
                          {latestTep.geoCity || latestTep.geoCountry
                            ? ` · ${[latestTep.geoCity, latestTep.geoCountry].filter(Boolean).join(', ')}`
                            : ''}
                        </p>
                      </div>
                    )}
                    {tepPackages.length > 1 && (
                      <p className="text-2xs text-gray-500">
                        {tepPackages.length} tracked downloads total
                      </p>
                    )}
                    <div className="max-h-36 overflow-y-auto space-y-1.5">
                      {tepPackages.slice(0, 8).map((t) => (
                        <div
                          key={t.tepCode}
                          className="flex items-center justify-between gap-2 rounded-lg bg-bg-elevated px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-2xs mono text-white truncate">{t.tepCode}</p>
                            <p className="text-2xs text-gray-500">
                              {format(new Date(t.createdAt), 'MMM d · HH:mm')} · {t.status}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyTep(t.tepCode)}
                            className="text-2xs text-dna-400 shrink-0"
                          >
                            {copiedTep === t.tepCode ? '✓' : 'Copy'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
              <section>
                <h3 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Chain of Custody
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Owner</dt>
                    <dd className="text-white">{user?.shortId ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Created</dt>
                    <dd className="text-white text-right">{format(new Date(record.createdAt), 'PPpp')}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">Vault</dt>
                    <dd className="text-dna-400 mono text-right truncate max-w-[180px]">{record.id.slice(0, 16)}…</dd>
                  </div>
                  {record.location?.status === 'AVAILABLE' && record.location.creationLabel && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500 flex items-center gap-1"><MapPin size={10} /> Location</dt>
                      <dd className="text-white text-right truncate max-w-[180px]">{record.location.creationLabel}</dd>
                    </div>
                  )}
                </dl>
              </section>
            </>
          )}

          {tab === 'details' && (
            <dl className="space-y-3 text-xs">
              {[
                ['Vault ID', record.id],
                ['DNA Record ID', record.dnaRecordId],
                ['MIME Type', resolvedMime],
                ['Original Size', formatBytes(record.originalSizeBytes)],
                ['Encrypted Size', formatBytes(record.encryptedSizeBytes)],
                ['Key Derivation', record.keyDerivation],
                ['Stored At', format(new Date(record.createdAt), 'PPpp')],
              ].map(([label, value]) => (
                <div key={label} className="bg-bg-elevated rounded-lg p-3">
                  <dt className="text-2xs text-gray-500 mb-1">{label}</dt>
                  <dd className={cn('break-all', label.toString().includes('ID') ? 'mono text-dna-400' : 'text-gray-200')}>
                    {value}
                  </dd>
                </div>
              ))}
              <div className="rounded-xl bg-success/5 border border-success/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Lock size={12} className="text-success" />
                  <p className="text-xs font-semibold text-success">AES-256-GCM</p>
                </div>
                <p className="text-2xs text-gray-400">
                  Key re-derived on demand via HKDF-SHA256. Authentication tag ensures tamper detection.
                </p>
              </div>
            </dl>
          )}

          {tab === 'permissions' && (
            <div className="space-y-3">
              {loadingLinks ? (
                <div className="flex justify-center py-8">
                  <RefreshCw size={18} className="animate-spin text-gray-500" />
                </div>
              ) : links.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">
                  No share links yet. Use Share Secure Link to create tracked access.
                </p>
              ) : (
                links.map((link) => (
                  <div key={link.id} className="rounded-xl border border-bg-border bg-bg-elevated p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white mono truncate">{link.token}</p>
                      <Badge variant={link.isActive ? 'success' : 'danger'}>
                        {link.isActive ? 'Active' : 'Revoked'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-2xs text-gray-500">
                      <span>Views: {link.viewCount ?? 0}</span>
                      <span>Downloads: {link.downloadCount ?? 0}</span>
                      <span>{link.allowDownload ? 'Download allowed' : 'View only'}</span>
                      <span>{link.expiresAt ? `Expires ${format(new Date(link.expiresAt), 'MMM d')}` : 'No expiry'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { icon: <Users size={12} />, label: 'Views', value: totalViews },
                  { icon: <Share2 size={12} />, label: 'Links', value: activeLinks.length },
                  { icon: <ShieldCheck size={12} />, label: 'TEP', value: tepPackages.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-bg-elevated p-2">
                    <p className="text-lg font-bold text-white">{s.value}</p>
                    <p className="text-2xs text-gray-500 flex items-center justify-center gap-1">{s.icon}{s.label}</p>
                  </div>
                ))}
              </div>
              {tepPackages.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-2xs font-semibold text-gray-500 uppercase tracking-wider">Tracking codes</p>
                  {tepPackages.slice(0, 5).map((t) => (
                    <div key={t.tepCode} className="rounded-lg bg-bg-elevated p-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-2xs mono text-dna-400 truncate">{t.tepCode}</p>
                        <p className="text-2xs text-gray-500">{format(new Date(t.createdAt), 'MMM d · HH:mm')}</p>
                      </div>
                      <Badge variant="muted">{t.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
              {loadingLinks ? (
                <div className="flex justify-center py-6">
                  <RefreshCw size={18} className="animate-spin text-gray-500" />
                </div>
              ) : accessEvents.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">No access events recorded yet.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {accessEvents.slice(0, 12).map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 text-xs rounded-lg bg-bg-elevated p-2">
                      <Activity size={12} className="text-dna-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium">{ev.action}</p>
                        <p className="text-2xs text-gray-500">
                          {[ev.device, ev.country].filter(Boolean).join(' · ') || format(new Date(ev.createdAt), 'MMM d · HH:mm')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate('/timeline')}
                className="w-full flex items-center justify-center gap-1 text-xs text-dna-400 hover:text-white py-2"
              >
                Open File Timeline <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-bg-border space-y-3">
          <h3 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction
              icon={protectDownloading ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
              label="Download Protected"
              onClick={handleProtectedDownload}
            />
            <QuickAction icon={<Share2 size={18} />} label="Share Secure Link" onClick={onShare} />
            <QuickAction icon={<FileSearch size={18} />} label="Intelligence Report" onClick={() => navigate(`/intelligence/${record.id}`)} />
            <QuickAction icon={<Microscope size={18} />} label="Difference Engine" onClick={() => navigate('/forensic-diff')} />
            <QuickAction icon={<Activity size={18} />} label="Access Intelligence" onClick={handleAccessIntelligence} />
            <QuickAction icon={<Shield size={18} />} label="Unified Investigation" onClick={() => navigate(BRAND.investigationPath)} />
            <QuickAction
              icon={retrieving ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              label="Owner Backup"
              onClick={handleDownloadOriginal}
            />
            <QuickAction icon={<Eye size={18} />} label="View in Timeline" onClick={() => navigate('/timeline')} />
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="w-full flex items-center justify-center gap-2 text-xs text-red-400 hover:text-red-300 py-2"
          >
            <Trash2 size={14} /> Remove from Vault
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
