import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Lock,
  MapPin,
  ShieldCheck,
  Share2,
  Send,
  FileSearch,
  Activity,
  Download,
  Eye,
  Trash2,
  Loader2,
  RefreshCw,
  Users,
  ChevronRight,
  Microscope,
  Pencil,
  Store,
  Plus,
  LayoutGrid,
  FileDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { VaultFileThumbnail } from './VaultFileThumbnail';
import { ExchangeListedTag } from './ExchangeListedTag';
import { Badge } from './ui/Badge';
import { cn } from './ui/utils';
import { formatBytes } from '../hooks/useApi';
import {
  getVaultFileTypeDisplay,
  resolveVaultFileMime,
} from '../lib/file-type-utils';
import { createPinitFile, downloadPinitCarrier, sharePinitFile } from '../lib/download-pinit';
import { pinitShareSheetFilename } from '../../../src/lib/pinit-file';
import { API_BASE_URL } from '../config/api.config';
import { api, getVaultTracking, protectedDownloadFromVault, createFileShare, analyzeVaultContent, renameVaultRecord, createExchangeListIntent, getExchangeRole, getExchangeConfig, getPortfolioContainsVault, getVaultContentAnalysis, type VaultTrackingDashboard,
  getAssetGraph, type AssetGraph,
} from '../services/dashboard.api';
import { useAuth } from '../context/AuthContext';
import { AuthenticityReportCard, verdictBadgeVariant } from './AuthenticityReportCard';
import type { VaultContentAnalysis, VaultRecord } from '../types/dashboard.types';
import { formatSourcePlatform, vaultSourceCaption } from '../lib/source-platform';
import { formatReshareId, formatShareId, formatTrackId } from '../lib/lifecycle-ids';
import { parseCoordsFromLabel } from '../lib/parse-location-label';

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
  listedOnExchange?: boolean;
  exchangeListingId?: string | null;
  onClose: () => void;
  onShare: () => void;
  onDelete: () => void;
  onRenamed?: (vaultId: string, originalFileName: string) => void;
  deleting?: boolean;
  /** Drawer is the My Assets slide-over. Embedded is the action grid on the living-asset page. */
  layout?: 'drawer' | 'embedded';
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
  hint,
  onClick,
  disabled = false,
  emphasis = false,
  appearance = 'card',
  className,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: boolean;
  appearance?: 'card' | 'plain';
  className?: string;
}) {
  const plain = appearance === 'plain';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full flex-col items-center justify-center text-center transition-colors touch-manipulation',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dna-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card',
        'disabled:opacity-60 disabled:pointer-events-none',
        plain
          ? 'min-h-[88px] gap-2 px-1 py-2 rounded-xl hover:bg-white/60 dark:hover:bg-white/5'
          : 'min-h-[52px] sm:min-h-[64px] gap-1 px-2 py-2.5 rounded-xl border',
        !plain && emphasis
          ? 'border-dna-500/35 bg-dna-500/10 text-slate-800 hover:border-dna-400/50 hover:bg-dna-500/15'
          : !plain
            ? 'border-bg-border bg-white dark:bg-bg-elevated text-slate-700 hover:border-dna-500/30 hover:bg-dna-500/5 hover:text-slate-900'
            : '',
        className,
      )}
    >
      <span className={plain ? 'text-dna-500' : 'text-dna-400'}>{icon}</span>
      <span className={`font-medium leading-tight break-words px-0.5 ${plain ? 'text-xs text-slate-700' : 'text-[11px] sm:text-2xs'}`}>{label}</span>
      {hint ? <span className="text-[10px] leading-tight text-slate-500">{hint}</span> : null}
    </button>
  );
}

export function VaultDetailSidePanel({
  record,
  listedOnExchange = false,
  exchangeListingId = null,
  onClose,
  onShare,
  onDelete,
  onRenamed,
  deleting = false,
  layout = 'drawer',
}: VaultDetailSidePanelProps) {
  const embedded = layout === 'embedded';
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<PanelTab>('overview');
  /*
   * What this file is connected to. Keyed on the canonical Asset id, which the
   * vault list now carries; files protected before Asset identity existed have
   * none, and for those the section simply does not appear.
   */
  const [graph, setGraph] = useState<AssetGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [links, setLinks] = useState<VaultShareLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [tracking, setTracking] = useState<VaultTrackingDashboard | null>(null);
  const [loadingTracking, setLoadingTracking] = useState(true);
  const [protectDownloading, setProtectDownloading] = useState(false);
  const [sharingFile, setSharingFile] = useState(false);
  const [downloadingPinit, setDownloadingPinit] = useState(false);
  /** Prepared .pinit carrier for WhatsApp / Email. Not a link and not a QR. */
  const [pinitShare, setPinitShare] = useState<{ filename: string; file: File } | null>(null);
  /** Ready before the click so the app list can open in the same tap. */
  const pinitReadyRef = useRef<File | null>(null);
  const [listingOnExchange, setListingOnExchange] = useState(false);
  const [canListOnExchange, setCanListOnExchange] = useState(false);
  const [inPortfolio, setInPortfolio] = useState(false);
  const [analysis, setAnalysis] = useState<VaultContentAnalysis | null>(
    record.contentAnalysis ?? null,
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<
    'NOT_ANALYZED' | 'PENDING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | 'NOT_APPLICABLE' | null
  >(record.contentAnalysis ? 'COMPLETED' : null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisRetrying, setAnalysisRetrying] = useState(false);
  const [copiedTep, setCopiedTep] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [displayName, setDisplayName] = useState(record.originalFileName);

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
  const isImageRecord = resolvedMime.startsWith('image/');
  const tepPackages = tracking?.tepPackages ?? [];
  const latestTep = tepPackages[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    void getExchangeRole()
      .then((role) => {
        if (!cancelled) setCanListOnExchange(Boolean(role.can_list));
      })
      .catch(() => {
        if (!cancelled) setCanListOnExchange(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setInPortfolio(false);
    void getPortfolioContainsVault(record.id)
      .then((present) => {
        if (!cancelled) setInPortfolio(present);
      })
      .catch(() => {
        if (!cancelled) setInPortfolio(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record.id]);

  /* Relationships load on their own, so an asset without an identity cannot
     short-circuit the panel's other reset work. */
  useEffect(() => {
    setGraph(null);
    const assetId = record.assetId;
    if (!assetId) {
      setGraphLoading(false);
      return;
    }
    let cancelled = false;
    setGraphLoading(true);
    getAssetGraph(assetId)
      .then((g) => { if (!cancelled) setGraph(g); })
      .catch(() => { if (!cancelled) setGraph(null); })
      .finally(() => { if (!cancelled) setGraphLoading(false); });
    return () => { cancelled = true; };
  }, [record.id, record.assetId]);

  useEffect(() => {
    setTab('overview');
    setDisplayName(record.originalFileName);
    setRenaming(false);
    setRenameDraft('');
    setRenameSaving(false);
    setLoadingLinks(true);
    setLoadingTracking(true);
    setTracking(null);
    setAnalysis(record.contentAnalysis ?? null);
    setAnalyzing(false);
    setAnalysisStatus(record.contentAnalysis ? 'COMPLETED' : null);
    setAnalysisError(null);
    setAnalysisRetrying(false);
    setSharingFile(false);
    setDownloadingPinit(false);
    setPinitShare(null);
    pinitReadyRef.current = null;
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

  useEffect(() => {
    setDisplayName(record.originalFileName);
  }, [record.originalFileName]);

  useEffect(() => {
    if (!isImageRecord) {
      setAnalysis(null);
      setAnalyzing(false);
      setAnalysisStatus('NOT_APPLICABLE');
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    const applySnap = (snap: Awaited<ReturnType<typeof getVaultContentAnalysis>>) => {
      if (cancelled) return;
      setAnalysisStatus(snap.status);
      setAnalysis(snap.contentAnalysis ?? null);
      setAnalysisError(snap.error ?? null);
      setAnalyzing(snap.status === 'ANALYZING' || snap.status === 'PENDING');
    };

    const poll = async () => {
      try {
        const snap = await getVaultContentAnalysis(record.id);
        applySnap(snap);
        if (!cancelled && (snap.status === 'ANALYZING' || snap.status === 'PENDING')) {
          timer = window.setTimeout(() => { void poll(); }, 2500);
        }
      } catch {
        if (!cancelled) {
          setAnalyzing(false);
          setAnalysisStatus((prev) => prev ?? 'FAILED');
          setAnalysisError("Analysis couldn't be completed.");
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [record.id, isImageRecord]);

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

  const splitDisplayName = (name: string) => {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return { base: name, ext: '' };
    return { base: name.slice(0, dot), ext: name.slice(dot) };
  };

  const startRename = () => {
    setRenameDraft(splitDisplayName(displayName).base);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameDraft('');
  };

  const applyRename = async () => {
    const { ext } = splitDisplayName(displayName);
    const base = renameDraft.trim().replace(/[<>:"/\\|?*]/g, '').slice(0, 120);
    if (!base) {
      toast.error('Enter a valid file name');
      return;
    }
    const nextName = `${base}${ext}`;
    if (nextName === displayName) {
      setRenaming(false);
      return;
    }
    setRenameSaving(true);
    try {
      const result = await renameVaultRecord(record.id, nextName);
      setDisplayName(result.originalFileName);
      setLinks((prev) => prev.map((l) => ({ ...l, filename: result.originalFileName })));
      onRenamed?.(record.id, result.originalFileName);
      setRenaming(false);
      toast.success('File renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenameSaving(false);
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
      a.download = displayName;
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

  const shareablePinitFile = (file: File) => new File(
    [file],
    pinitShareSheetFilename(file.name),
    { type: 'text/plain' },
  );

  const isShareAbort = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return /AbortError|canceled|cancelled/i.test(msg) || (err as { name?: string })?.name === 'AbortError';
  };

  /** Opens the device app list with the .pinit file. Must run in the click, before any await. */
  const openPinitShareSheet = async (file: File): Promise<'shared' | 'aborted' | 'unavailable'> => {
    if (typeof navigator.share !== 'function') return 'unavailable';
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (isShareAbort(err)) return 'aborted';
      return 'unavailable';
    }
  };

  const preparePinitFile = async (): Promise<File | null> => {
    if (pinitReadyRef.current) return pinitReadyRef.current;
    const created = await createFileShare(record.id, { requestLocation: true });
    const built = createPinitFile({
      token: created.token,
      name: created.filename || displayName,
    });
    if (!built.ok) return null;
    const shareable = shareablePinitFile(built.file);
    pinitReadyRef.current = shareable;
    setPinitShare({ filename: built.filename, file: shareable });
    return shareable;
  };

  useEffect(() => {
    let cancelled = false;
    void preparePinitFile().then((file) => {
      if (cancelled && file && pinitReadyRef.current === file) {
        pinitReadyRef.current = null;
      }
    });
    return () => { cancelled = true; };
    // Prepare once per asset so Share File can open the app list on the first tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id]);

  /**
   * Share File exports a .pinit carrier, not the raw asset.
   * The recipient opens that file at /open.
   */
  const handleShareFile = async () => {
    if (sharingFile) return;
    const ready = pinitReadyRef.current;
    if (ready) {
      const opened = await openPinitShareSheet(ready);
      if (opened === 'shared') {
        toast.success('Pick WhatsApp, choose the person, and send the .pinit file.');
        void refreshTracking();
        return;
      }
      if (opened === 'aborted') return;
    }

    setSharingFile(true);
    try {
      const file = ready ?? await preparePinitFile();
      if (!file) {
        toast.error('Could not create the .pinit file');
        return;
      }
      const opened = await openPinitShareSheet(file);
      if (opened === 'shared') {
        toast.success('Pick WhatsApp, choose the person, and send the .pinit file.');
      } else if (opened === 'aborted') {
        return;
      } else {
        toast('Tap Share File again to open your apps.');
      }
      await refreshTracking();
    } catch (err) {
      if (isShareAbort(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || 'Could not share file');
    } finally {
      setSharingFile(false);
    }
  };

  const handleSharePinitChannel = (channel: 'whatsapp' | 'email') => {
    if (!pinitShare) return;
    sharePinitFile(pinitShare.file, channel);
    const where = channel === 'whatsapp' ? 'WhatsApp' : 'Gmail';
    toast.success(
      `${where} is open. Attach the saved ${pinitShare.filename}.`,
      { duration: 7000 },
    );
  };

  const handleDownloadPinit = async () => {
    if (downloadingPinit || loadingLinks) return;

    const now = Date.now();
    const active = links
      .filter((link) => {
        if (!link.isActive || !link.token) return false;
        if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return false;
        if (link.maxViews != null && link.viewCount >= link.maxViews) return false;
        return true;
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const chosen = active[0];
    if (chosen) {
      const saved = downloadPinitCarrier({ token: chosen.token, name: displayName });
      if (!saved.ok) {
        toast.error('Could not create the .pinit file');
        return;
      }
      const built = createPinitFile({ token: chosen.token, name: displayName });
      if (built.ok) setPinitShare({ filename: built.filename, file: built.file });
      toast.success(`Saved ${saved.filename}. Send that file — it does not contain the asset.`);
      return;
    }

    setDownloadingPinit(true);
    try {
      const created = await createFileShare(record.id, { requestLocation: true });
      const saved = downloadPinitCarrier({
        token: created.token,
        name: created.filename || displayName,
      });
      if (!saved.ok) {
        toast.error('Could not create the .pinit file');
        return;
      }
      const built = createPinitFile({
        token: created.token,
        name: created.filename || displayName,
      });
      if (built.ok) setPinitShare({ filename: built.filename, file: built.file });
      toast.success(`Saved ${saved.filename}. Send that file — it does not contain the asset.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || 'Could not create the .pinit file');
    } finally {
      setDownloadingPinit(false);
    }
  };

  const handleRetryImageAnalysis = async () => {
    if (analysisRetrying || !isImageRecord) return;
    setAnalysisRetrying(true);
    setAnalysisStatus('ANALYZING');
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const data = await analyzeVaultContent(record.id, { force: true });
      setAnalysisStatus((data.status as typeof analysisStatus) || (data.contentAnalysis ? 'COMPLETED' : 'FAILED'));
      setAnalysis(data.contentAnalysis ?? null);
      setAnalysisError(data.error ?? null);
      setAnalyzing(data.status === 'ANALYZING' || data.status === 'PENDING');
    } catch {
      setAnalysisStatus('FAILED');
      setAnalysisError("Analysis couldn't be completed.");
      setAnalyzing(false);
    } finally {
      setAnalysisRetrying(false);
    }
  };

  const gatePremium = (path: string) => {
    navigate(path);
  };

  const handleAccessIntelligence = () => {
    if (loadingLinks) {
      toast('Loading this file’s share links…');
      return;
    }
    // Always open this file’s Tracking overview so EVERY share link for the
    // same vault file is listed (shared multiple times → all tracks visible).
    navigate(`/access-intelligence?vaultId=${encodeURIComponent(record.id)}`);
  };

  const handleListOnExchange = async () => {
    if (listingOnExchange) return;
    if (listedOnExchange) {
      setListingOnExchange(true);
      try {
        const cfg = await getExchangeConfig();
        const appUrl = String(cfg?.appUrl || '').replace(/\/$/, '');
        const url = exchangeListingId && appUrl
          ? `${appUrl}/listing/${encodeURIComponent(exchangeListingId)}`
          : appUrl || null;
        if (!url) {
          toast.error('Exchange listing URL is not available');
          return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        toast.error('Could not open Exchange listing');
      } finally {
        setListingOnExchange(false);
      }
      return;
    }
    if (!canListOnExchange) {
      toast.error('Private Hub asset. Become a Creator on Pinit Exchange to list marketplace inventory.');
      return;
    }
    setListingOnExchange(true);
    try {
      const result = await createExchangeListIntent(record.id);
      if (!result?.listUrl) {
        toast.error("Couldn't create the Exchange listing.");
        return;
      }
      window.open(result.listUrl, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : '');
      toast.error(msg || "Couldn't create the Exchange listing.");
    } finally {
      setListingOnExchange(false);
    }
  };

  const handleAddToPortfolio = () => {
    navigate(`/profile?tab=portfolio&addVault=${encodeURIComponent(record.id)}`);
  };

  useEffect(() => {
    if (embedded) return;
    const main = document.querySelector('main.mobile-main') as HTMLElement | null;
    const isMobile = () => window.matchMedia('(max-width: 1023px)').matches;
    if (!main || !isMobile()) return;
    const prev = main.style.overflow;
    main.style.overflow = 'hidden';
    return () => {
      main.style.overflow = prev;
    };
  }, [embedded]);

  return (
    <>
      {!embedded && (
      <button
        type="button"
        className="fixed inset-0 bg-black/40 z-[90] animate-fade-in"
        onClick={onClose}
        aria-label="Close file details"
      />
      )}
      <aside
        className={cn(
          'flex flex-col bg-bg-card border-bg-border',
          embedded
            ? 'relative w-full border-0 bg-transparent shadow-none'
            : 'z-[95] shadow-2xl fixed inset-x-0 bottom-0 w-full max-h-[min(92dvh,900px)] rounded-t-2xl border-t lg:inset-y-0 lg:top-14 lg:right-0 lg:left-auto lg:bottom-0 lg:w-[400px] xl:w-[420px] lg:max-h-none lg:rounded-none lg:border-t-0 lg:border-l',
        )}
      >
      {!embedded && (
        <>
        <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0" aria-hidden>
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border shrink-0">
        <p className="text-sm font-semibold text-white truncate pr-2">File</p>
        <button type="button" onClick={onClose} className="btn-ghost btn-icon text-gray-500 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 text-gray-800 dark:text-gray-100">
        <div className="relative aspect-video bg-bg-elevated border-b border-bg-border">
          <VaultFileThumbnail
            vaultId={record.id}
            fileName={displayName}
            mimeType={record.originalMimeType}
            variant="gallery"
            className="w-full h-full min-h-[180px]"
          />
        </div>

        <div className="p-4 space-y-3 border-b border-bg-border">
          <div>
            {renaming ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void applyRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    className="input text-sm flex-1"
                    autoFocus
                    disabled={renameSaving}
                  />
                  <span className="text-xs text-gray-500 shrink-0">{splitDisplayName(displayName).ext}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void applyRename()}
                    disabled={renameSaving}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    {renameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelRename}
                    disabled={renameSaving}
                    className="btn-ghost text-xs px-3 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <h2 className="text-base font-bold text-white break-words flex-1">{displayName}</h2>
                {listedOnExchange && <ExchangeListedTag compact className="shrink-0 mt-1" />}
                <button
                  type="button"
                  onClick={startRename}
                  className="btn-ghost btn-icon text-gray-500 hover:text-dna-400 shrink-0"
                  title="Rename file"
                  aria-label="Rename file"
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}
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
            {analysis && (
              <>
                <Badge variant={verdictBadgeVariant(String(analysis.verdict ?? analysis.label))}>
                  {analysis.verdictDisplay ?? analysis.labelDisplay ?? analysis.verdict ?? analysis.label}
                </Badge>
                <Badge variant={(analysis.scores?.tamperScore ?? 0) < 15 ? 'success' : 'warning'}>
                  {(analysis.scores?.tamperScore ?? 0) < 15
                    ? 'Not tampered'
                    : `Tamper ${Math.round(analysis.scores?.tamperScore ?? 0)}%`}
                </Badge>
              </>
            )}
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
                <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                  Protection
                </h3>
                <dl className="space-y-2 text-xs">
                  {[
                    ['Status', 'Protected'],
                    ['Content', analysis?.verdictDisplay ?? analysis?.labelDisplay ?? (analysis ? String(analysis.verdict ?? analysis.label) : '—')],
                    ['Tamper', analysis?.scores
                      ? `${Math.round(analysis.scores.tamperScore)}%${analysis.scores.tamperScore < 15 ? ' · none found' : ''}`
                      : '—'],
                    ['Authenticity', analysis?.scores ? `${Math.round(analysis.scores.authenticityScore)}%` : '—'],
                    ['Access', 'Only you control'],
                    ['Verified', 'Yes'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">{k}</dt>
                    <dd className="text-gray-900 dark:text-gray-100 font-medium text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              {/*
                * What this file is connected to.
                *
                * The server returns only groups that have members, so there is
                * no empty-state to render here — if an asset is connected to
                * nothing, the whole section stays away rather than showing a
                * row of blank headings.
                */}
              {graphLoading && (
                <section>
                  <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                    Relationships
                  </h3>
                  <div className="skeleton h-12 rounded-lg" />
                </section>
              )}

              {!graphLoading && graph && graph.groups.length > 0 && (
                <section>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                      Relationships
                    </h3>
                    <span className="text-2xs text-gray-500">
                      {graph.totalConnections}{' '}
                      {graph.totalConnections === 1 ? 'connection' : 'connections'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {graph.groups.map((group) => (
                      <div key={group.kind}>
                        <p className="text-2xs text-gray-500 mb-1">{group.label}</p>
                        <ul className="space-y-1">
                          {group.items.map((item) => {
                            const body = (
                              <>
                                <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
                                  {item.label}
                                </span>
                                {item.sub && (
                                  <span className="shrink-0 truncate text-2xs text-gray-500 max-w-[45%]">
                                    {item.sub}
                                  </span>
                                )}
                              </>
                            );
                            const cls =
                              'flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 '
                              + 'bg-gray-50 dark:bg-white/[0.03]';
                            return (
                              <li key={`${group.kind}-${item.id}`}>
                                {item.href ? (
                                  <a
                                    href={item.href}
                                    target={item.href.startsWith('http') ? '_blank' : undefined}
                                    rel="noreferrer noopener"
                                    className={`${cls} hover:bg-gray-100 dark:hover:bg-white/[0.06]`}
                                  >
                                    {body}
                                  </a>
                                ) : (
                                  <div className={cls}>{body}</div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                  Where it came from
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Source</dt>
                    <dd className="text-gray-900 dark:text-gray-100 font-medium text-right">
                      {vaultSourceCaption(record) ?? 'Pinit HUB upload'}
                    </dd>
                  </div>
                  {formatSourcePlatform(record.sourcePlatform) && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-600 dark:text-gray-300">Platform</dt>
                      <dd className="text-gray-900 dark:text-gray-100 font-medium text-right">
                        {formatSourcePlatform(record.sourcePlatform)}
                      </dd>
                    </div>
                  )}
                  {record.sourceUrl && (
                    <div className="flex flex-col gap-1">
                      <dt className="text-gray-600 dark:text-gray-300">Original link</dt>
                      <dd className="text-dna-400 text-right break-all">
                        <a
                          href={record.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {record.sourceUrl.length > 48
                            ? `${record.sourceUrl.slice(0, 48)}…`
                            : record.sourceUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
              <section>
                <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                  File identity
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Record</dt>
                    <dd className="text-dna-400 mono text-right truncate max-w-[180px]">{record.dnaRecordId.slice(0, 16)}…</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Watermark</dt>
                    <dd className="text-gray-900 dark:text-gray-100">Enabled</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Live tracking</dt>
                    <dd className="text-gray-900 dark:text-gray-100">Active</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                  Protected Downloads
                </h3>
                {loadingTracking ? (
                  <div className="flex justify-center py-4">
                    <RefreshCw size={16} className="animate-spin text-gray-500" />
                  </div>
                ) : tepPackages.length === 0 ? (
                  <div className="rounded-lg border border-bg-border bg-bg-elevated p-3 space-y-2">
                    <p className="text-xs text-gray-400">
                      No tracked download yet. Download Protected saves the file to this device’s Files so other apps can pick it. Protection stays on the copy.
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
                <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                  Chain of Custody
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Owner</dt>
                    <dd className="text-gray-900 dark:text-gray-100">{user?.shortId ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Created</dt>
                    <dd className="text-gray-900 dark:text-gray-100 text-right">{format(new Date(record.createdAt), 'PPpp')}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 dark:text-gray-300">Asset</dt>
                    <dd className="text-dna-400 mono text-right truncate max-w-[180px]">{record.id.slice(0, 16)}…</dd>
                  </div>
                  {record.location?.status === 'AVAILABLE' && (
                    <>
                      {record.location.creationLabel && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-gray-600 dark:text-gray-300 flex items-center gap-1"><MapPin size={10} /> Asset GPS</dt>
                          <dd className="text-gray-900 dark:text-gray-100 text-right truncate max-w-[180px]">{record.location.creationLabel}</dd>
                        </div>
                      )}
                      {record.location.sharedLabel && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-gray-600 dark:text-gray-300">Share GPS</dt>
                          <dd className="text-gray-900 dark:text-gray-100 text-right truncate max-w-[180px]">{record.location.sharedLabel}</dd>
                        </div>
                      )}
                      {record.location.presentLabel && record.location.presentLabel !== record.location.creationLabel && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-gray-600 dark:text-gray-300">Latest GPS</dt>
                          <dd className="text-gray-900 dark:text-gray-100 text-right truncate max-w-[180px]">{record.location.presentLabel}</dd>
                        </div>
                      )}
                    </>
                  )}
                </dl>
              </section>
            </>
          )}

          {tab === 'details' && (
            <div className="space-y-3">
              {isImageRecord && analysis && analysisStatus !== 'FAILED' ? (
                <AuthenticityReportCard analysis={analysis} title="Image analysis" />
              ) : isImageRecord && (analyzing || analysisStatus === 'ANALYZING' || analysisStatus === 'PENDING') ? (
                <div className="rounded-xl border border-bg-border bg-bg-elevated p-3">
                  <div className="flex items-center gap-2">
                    <Microscope size={14} className="text-dna-400" />
                    <p className="text-xs font-semibold text-white">Image analysis</p>
                    <RefreshCw size={11} className="animate-spin text-gray-500 ml-auto" />
                  </div>
                  <p className="text-2xs text-gray-500 mt-2">
                    {analysisStatus === 'PENDING' ? 'Analysis queued...' : 'Analysis in progress...'}
                  </p>
                </div>
              ) : isImageRecord && analysisStatus === 'FAILED' ? (
                <div className="rounded-xl border border-bg-border bg-bg-elevated p-3">
                  <div className="flex items-center gap-2">
                    <Microscope size={14} className="text-dna-400" />
                    <p className="text-xs font-semibold text-white">Image analysis</p>
                  </div>
                  <p className="text-2xs text-gray-500 mt-2">
                    {analysisError || "Analysis couldn't be completed."}
                  </p>
                  <button
                    type="button"
                    onClick={() => { void handleRetryImageAnalysis(); }}
                    disabled={analysisRetrying}
                    className="mt-2 text-2xs font-semibold text-dna-400 hover:text-white disabled:opacity-60"
                  >
                    {analysisRetrying ? 'Retrying…' : 'Retry analysis'}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-bg-border bg-bg-elevated p-3">
                  <div className="flex items-center gap-2">
                    <Microscope size={14} className="text-dna-400" />
                    <p className="text-xs font-semibold text-white">Image analysis</p>
                  </div>
                  <p className="text-2xs text-gray-500 mt-2">
                    {isImageRecord
                      ? 'Checking stored analysis…'
                      : 'Detailed image analysis is only shown for image files.'}
                  </p>
                </div>
              )}

              <dl className="space-y-3 text-xs">
                {[
                  ['Asset ID', record.id],
                  ['Record ID', record.dnaRecordId],
                  ['File type', resolvedMime],
                  ['Original size', formatBytes(record.originalSizeBytes)],
                  ['Stored size', formatBytes(record.encryptedSizeBytes)],
                  ['Stored at', format(new Date(record.createdAt), 'PPpp')],
                ].map(([label, value]) => (
                  <div key={label} className="bg-bg-elevated rounded-lg p-3">
                    <dt className="text-2xs text-gray-600 dark:text-gray-300 mb-1">{label}</dt>
                    <dd className={cn('break-all', label.toString().includes('ID') ? 'mono text-dna-400' : 'text-gray-900 dark:text-gray-100')}>
                      {value}
                    </dd>
                  </div>
                ))}
                <div className="bg-bg-elevated rounded-lg p-3">
                  <dt className="text-2xs text-gray-600 dark:text-gray-300 mb-1 flex items-center gap-1">
                    <MapPin size={11} className="text-dna-400" />
                    Upload GPS
                  </dt>
                  {(() => {
                    const label = record.location?.creationLabel;
                    const source = record.location?.creationSource;
                    const coords = parseCoordsFromLabel(label);
                    if (!label) {
                      return (
                        <dd className="text-gray-500 dark:text-gray-400">
                          Not shared when this file was protected
                        </dd>
                      );
                    }
                    return (
                      <>
                        <dd className="text-gray-900 dark:text-gray-100 break-all font-medium">
                          {coords ? (
                            <a
                              href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-dna-400 hover:underline"
                            >
                              {label}
                            </a>
                          ) : (
                            label
                          )}
                        </dd>
                        <p className="text-2xs text-gray-500 dark:text-gray-400 mt-1">
                          {source === 'gps'
                            ? 'Device GPS at upload'
                            : source === 'ip'
                              ? 'Approximate from network (IP)'
                              : 'Recorded at protect'}
                        </p>
                      </>
                    );
                  })()}
                </div>
                <div className="rounded-xl bg-success/5 border border-success/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Lock size={12} className="text-success" />
                    <p className="text-xs font-semibold text-success">
                      {listedOnExchange
                        ? 'Listed on Pinit Exchange'
                        : canListOnExchange
                          ? 'Protected in your vault'
                          : 'Private · Protected by Pinit HUB'}
                    </p>
                  </div>
                  <p className="text-2xs text-gray-400">
                    {listedOnExchange
                      ? 'This file is live for sale on Exchange. The original stays locked in your vault.'
                      : canListOnExchange
                      ? 'Only you can open the original. Eligible assets can be listed on Exchange.'
                      : 'This is a personal Hub asset. Having a file in HUB does not list it on Exchange.'}
                  </p>
                </div>
              </dl>
            </div>
          )}

          {tab === 'permissions' && (
            <div className="space-y-3">
              {loadingLinks ? (
                <div className="flex justify-center py-8">
                  <RefreshCw size={18} className="animate-spin text-gray-500" />
                </div>
              ) : links.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">
                  No share links yet. Use Share to create tracked access.
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
                  { icon: <ShieldCheck size={12} />, label: 'Protected downloads', value: tepPackages.length },
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
                onClick={() => gatePremium(`/timeline?vaultId=${encodeURIComponent(record.id)}`)}
                className="w-full flex items-center justify-center gap-1 text-xs text-dna-400 hover:text-white py-2"
              >
                View in Timeline <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
        </div>
        </>
      )}

        <div className={`${embedded ? 'p-0' : 'p-3 border-t border-bg-border'} space-y-2.5`}>
          {!embedded && <h3 className="text-2xs font-semibold text-gray-500 uppercase tracking-wider">Quick Actions</h3>}
          {pinitShare && !embedded && (
            <div className="rounded-xl border border-bg-border bg-bg-elevated p-3 space-y-2">
              <p className="text-2xs font-semibold text-gray-500 uppercase tracking-wider">
                Share file
              </p>
              <p className="text-xs text-white truncate">{pinitShare.filename}</p>
              <p className="text-2xs text-gray-500">
                Attach the saved .pinit file. The filename by itself is not the file.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSharePinitChannel('whatsapp')}
                  className="btn btn-secondary btn-sm text-xs justify-center"
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => handleSharePinitChannel('email')}
                  className="btn btn-secondary btn-sm text-xs justify-center"
                >
                  Email
                </button>
              </div>
            </div>
          )}
          {(latestTep?.tepCode || links[0]) && !embedded && (
          <div className="rounded-xl border border-bg-border bg-bg-elevated p-3 space-y-2">
            {latestTep?.tepCode && (
              <p className="text-2xs text-gray-500 mono">
                Track ID: {formatTrackId(latestTep.tepCode, record.id)}
              </p>
            )}
            {links[0] && (
              <p className="text-2xs text-gray-500 mono">
                Share ID: {formatShareId(links[0].token, links[0].id)} · Reshare ID: {formatReshareId(links[0].id)}
              </p>
            )}
          </div>
          )}

          {embedded ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-sky-100 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-900/40 px-3 py-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  Share & Publish
                </p>
                <div className="grid grid-cols-3 gap-1">
                  <QuickAction appearance="plain" icon={<Share2 size={22} />} label="Share Secure Link" onClick={onShare} />
                  <QuickAction
                    appearance="plain"
                    icon={sharingFile ? <RefreshCw size={22} className="animate-spin" /> : <LayoutGrid size={22} />}
                    label={sharingFile ? 'Preparing…' : 'Share File'}
                    disabled={sharingFile}
                    onClick={() => { if (!sharingFile) void handleShareFile(); }}
                  />
                  <QuickAction
                    appearance="plain"
                    icon={listingOnExchange ? <RefreshCw size={22} className="animate-spin" /> : <Store size={22} />}
                    label={
                      listingOnExchange
                        ? (listedOnExchange ? 'Opening…' : 'Listing…')
                        : listedOnExchange
                          ? 'View on Exchange'
                          : 'List on Exchange'
                    }
                    disabled={listingOnExchange}
                    onClick={() => { if (!listingOnExchange) void handleListOnExchange(); }}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40 px-3 py-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Use & Export
                </p>
                <div className="grid grid-cols-3 gap-1">
                  <QuickAction
                    appearance="plain"
                    icon={<Plus size={22} />}
                    label={inPortfolio ? 'In Portfolio' : 'Add to Portfolio'}
                    onClick={handleAddToPortfolio}
                  />
                  <QuickAction
                    appearance="plain"
                    icon={protectDownloading ? <RefreshCw size={22} className="animate-spin" /> : <Download size={22} />}
                    label={protectDownloading ? 'Preparing…' : 'Download Protected'}
                    disabled={protectDownloading}
                    onClick={() => { if (!protectDownloading) void handleProtectedDownload(); }}
                  />
                  <QuickAction
                    appearance="plain"
                    icon={<FileSearch size={22} />}
                    label="Intelligence Report"
                    onClick={() => gatePremium(`/intelligence/${record.id}`)}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-900/40 px-3 py-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                  Understand & Track
                </p>
                <div className="grid grid-cols-3 gap-1">
                  <QuickAction appearance="plain" icon={<Activity size={22} />} label="Tracking" onClick={handleAccessIntelligence} />
                  <QuickAction
                    appearance="plain"
                    icon={<Eye size={22} />}
                    label="View Timeline"
                    onClick={() => gatePremium(`/timeline?vaultId=${encodeURIComponent(record.id)}`)}
                  />
                </div>
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2.5">
            <QuickAction
              emphasis
              icon={<Plus size={18} />}
              label={inPortfolio ? 'In Portfolio' : 'Add to Portfolio'}
              hint={inPortfolio ? 'Manage in Hub' : undefined}
              onClick={handleAddToPortfolio}
            />
            <QuickAction
              emphasis
              icon={listingOnExchange ? <RefreshCw size={18} className="animate-spin" /> : <Store size={18} />}
              label={
                listingOnExchange
                  ? (listedOnExchange ? 'Opening…' : 'Listing…')
                  : listedOnExchange
                    ? 'View on Exchange'
                    : 'List on Exchange'
              }
              hint={listedOnExchange ? 'Listed on Exchange' : undefined}
              disabled={listingOnExchange}
              onClick={() => { if (!listingOnExchange) void handleListOnExchange(); }}
            />
            <QuickAction
              icon={protectDownloading ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
              label={protectDownloading ? 'Preparing…' : 'Download Protected'}
              disabled={protectDownloading}
              onClick={() => { if (!protectDownloading) void handleProtectedDownload(); }}
            />
            <QuickAction icon={<Share2 size={18} />} label="Share Secure Link" onClick={onShare} />
            <QuickAction
              icon={sharingFile ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
              label={sharingFile ? 'Preparing…' : 'Share File'}
              disabled={sharingFile}
              onClick={() => { if (!sharingFile) void handleShareFile(); }}
            />
            <QuickAction
              icon={downloadingPinit ? <RefreshCw size={18} className="animate-spin" /> : <FileDown size={18} />}
              label={downloadingPinit ? 'Preparing…' : 'Download .pinit'}
              disabled={downloadingPinit || loadingLinks}
              onClick={() => { if (!downloadingPinit && !loadingLinks) void handleDownloadPinit(); }}
            />
            <QuickAction
              icon={<FileSearch size={18} />}
              label="Intelligence Report"
              onClick={() => gatePremium(`/intelligence/${record.id}`)}
            />
            <QuickAction icon={<Activity size={18} />} label="Tracking" onClick={handleAccessIntelligence} />
            <QuickAction
              icon={<Eye size={18} />}
              label="View in Timeline"
              onClick={() => gatePremium(`/timeline?vaultId=${encodeURIComponent(record.id)}`)}
            />
          </div>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl py-2.5 disabled:opacity-60 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {deleting ? 'Removing…' : 'Remove from My Assets'}
          </button>
        </div>
    </aside>
    </>
  );
}
