import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Archive,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileSearch,
  Fingerprint,
  Globe,
  Heart,
  Infinity as InfinityIcon,
  Lock,
  MapPin,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Route,
  Share2,
  ShieldCheck,
  Sparkles,
  Trophy,
  User,
  Volume2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { VaultDetailSidePanel } from '../components/VaultDetailSidePanel';
import { ShareLinkDialog } from '../components/share/ShareLinkDialog';
import { Badge } from '../components/ui/Badge';
import { SkeletonCard } from '../components/ui/Skeleton';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api.config';
import { BRAND } from '../config/brand.config';
import {
  api,
  deleteVaultRecord,
  getExchangeListedAssets,
  getVaultContentAnalysis,
  getVaultRecord,
  getVaultTracking,
  getPortfolioContainsVault,
  renameVaultRecord,
  createLivingShare,
  getPublicLivingStory,
  type VaultTrackingDashboard,
} from '../services/dashboard.api';
import type { VaultContentAnalysis, VaultRecord } from '../types/dashboard.types';
import { formatBytes } from '../hooks/useApi';
import { getVaultFileTypeDisplay } from '../lib/file-type-utils';
import { bestCoordsFromLocation } from '../lib/parse-location-label';
import { buildLiveBriefing, firstName, readCreatorNote, storyHighlights, writeCreatorNote, type BriefingEvent } from '../lib/asset-story-voice';
import { getLivingAssetBrief, type LivingAssetBrief } from '../services/ask-pinit.api';
import { vaultSourceCaption } from '../lib/source-platform';
import { fetchIntelView } from '../lib/intelligence-bundle';
import { downloadIntelligenceReportPdf } from '../services/intelligence-report-pdf';
import {
  FORENSIC_REPORTS_UPDATED_EVENT,
  listForensicReports,
  type StoredForensicReport,
} from '../lib/forensic-reports-storage';
import { LivingPageGuestTracker } from '../components/LivingPageGuestTracker';
import {
  investigationDisplayScore,
  investigationVerdictLabel,
  resolveInvestigationOwner,
} from '../lib/forensic-report-display';

type IntelLite = {
  provenance?: {
    capturedAt?: string | null;
    deviceModel?: string | null;
    software?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
  };
  integrity?: {
    sha256Hash?: string | null;
    normalizedHash?: string | null;
    dnaStatus?: string;
    tamperStatus?: string;
    layersComplete?: number;
    lastVerification?: { passed: boolean; at: string } | null;
  };
  distribution?: {
    totalShareLinks?: number;
    totalViews?: number;
    totalDownloads?: number;
    recipients?: string[];
    timeline?: Array<{ action: string; at: string; country: string | null; device: string | null }>;
  };
};

function Card({
  title,
  kicker,
  action,
  children,
  className = '',
}: {
  title: string;
  kicker?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`h-full rounded-2xl border border-slate-200/80 bg-bg-card p-4 shadow-sm dark:border-bg-border flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {kicker && <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dna-500 mb-0.5">{kicker}</p>}
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-2.5 flex-1 min-h-0">{children}</div>
    </section>
  );
}

function splitFileName(name: string) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

function Fact({ label, value }: { label: string; value: string }) {
  const v = value.trim();
  if (!v || /^not recorded$/i.test(v) || /^not independently/i.test(v) || /^not set$/i.test(v) || v === '—') return null;
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <p className="text-[11px] text-slate-500 shrink-0">{label}</p>
      <p className="text-[12px] text-slate-800 text-right break-words min-w-0">{v}</p>
    </div>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  const known = value !== '—' && value !== 'See full DNA report' && !/^not /i.test(value) && value !== 'Not run yet' && !value.startsWith('Open the');
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] text-slate-800 truncate">{value}</span>
        {known && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
      </span>
    </div>
  );
}

function classifyJourney(label: string, title: string) {
  const t = `${label} ${title}`.toLowerCase();
  if (/edit|bright/.test(t)) return { badge: 'EDITED', ring: 'bg-emerald-400', Icon: Sparkles };
  if (/exchange|list|publish/.test(t)) return { badge: 'PUBLISHED', ring: 'bg-rose-400', Icon: Globe };
  if (/share|sent|view|open/.test(t)) return { badge: 'SHARED', ring: 'bg-orange-400', Icon: Share2 };
  if (/verif/.test(t)) return { badge: 'VERIFIED', ring: 'bg-violet-500', Icon: Eye };
  if (/vault|protect|preserv|encrypt|stored/.test(t)) return { badge: 'PRESERVED', ring: 'bg-sky-500', Icon: Archive };
  return { badge: 'BIRTH', ring: 'bg-violet-500', Icon: Camera };
}

const LIKED_KEY = (vaultId: string) => `pinit_vault_liked_${vaultId}`;

function readLiked(vaultId: string): boolean {
  try {
    return localStorage.getItem(LIKED_KEY(vaultId)) === '1';
  } catch {
    return false;
  }
}

function writeLiked(vaultId: string, liked: boolean) {
  try {
    if (liked) localStorage.setItem(LIKED_KEY(vaultId), '1');
    else localStorage.removeItem(LIKED_KEY(vaultId));
  } catch {
    /* ignore */
  }
}

const HIGHLIGHT_ICONS = [ShieldCheck, Fingerprint, Heart, Route, Lock, InfinityIcon] as const;
const HIGHLIGHT_TONES = [
  'bg-violet-50 text-violet-500 dark:bg-violet-950/40',
  'bg-fuchsia-50 text-fuchsia-500 dark:bg-fuchsia-950/40',
  'bg-pink-50 text-pink-500 dark:bg-pink-950/40',
  'bg-sky-50 text-sky-500 dark:bg-sky-950/40',
  'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40',
  'bg-indigo-50 text-indigo-500 dark:bg-indigo-950/40',
];

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500">{children}</p>;
}

function IntroFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Camera;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/80 text-violet-500 shadow-sm ring-1 ring-violet-100 dark:bg-violet-950/40 dark:ring-violet-800/40">
        <Icon size={14} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className="mt-0.5 text-[13px] font-semibold text-slate-800 leading-snug break-words">{value}</p>
      </div>
    </div>
  );
}

function reportsForThisAsset(
  reports: StoredForensicReport[],
  vaultId: string,
  dnaRecordId?: string | null,
  fileName?: string | null,
): StoredForensicReport[] {
  const name = (fileName || '').toLowerCase();
  return reports.filter((r) => {
    if (r.kind === 'investigation') {
      const o = resolveInvestigationOwner(r.data);
      if (o.vaultId && o.vaultId === vaultId) return true;
      if (dnaRecordId && o.dnaRecordId && o.dnaRecordId === dnaRecordId) return true;
      if (name && o.originalFilename && o.originalFilename.toLowerCase() === name) return true;
      if (name && r.filename.toLowerCase() === name) return true;
      return false;
    }
    const a = r.data.fileA?.filename?.toLowerCase();
    const b = r.data.fileB?.filename?.toLowerCase();
    return Boolean(name && (a === name || b === name));
  });
}

function shortHash(h: string | null | undefined) {
  if (!h) return null;
  if (h.length < 20) return h;
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}

export function VaultAssetStoryPage() {
  const { vaultId: routeVaultId, token: liveToken } = useParams<{ vaultId?: string; token?: string }>();
  const guestMode = Boolean(liveToken);
  const [livingBlocked, setLivingBlocked] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [record, setRecord] = useState<VaultRecord | null>(null);
  const vaultId = routeVaultId || record?.id;
  const [tracking, setTracking] = useState<VaultTrackingDashboard | null>(null);
  const [analysis, setAnalysis] = useState<VaultContentAnalysis | null>(null);
  const [intel, setIntel] = useState<IntelLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const autoPlayTried = useRef(false);
  const [livingBrief, setLivingBrief] = useState<LivingAssetBrief | null>(null);
  const [livingBriefReady, setLivingBriefReady] = useState(false);

  useEffect(() => {
    autoPlayTried.current = false;
    setLivingBrief(null);
    setLivingBriefReady(false);
  }, [vaultId]);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [listed, setListed] = useState<{ listingId: string } | null>(null);
  const [inPortfolio, setInPortfolio] = useState(false);
  const [liked, setLiked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [creatorNote, setCreatorNote] = useState('');
  const [creatorNoteAt, setCreatorNoteAt] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [shareEvents, setShareEvents] = useState<
    Array<{ id: string; action: string; country: string | null; device: string | null; createdAt: string }>
  >([]);
  const [shareLinks, setShareLinks] = useState<
    Array<{ token: string; isActive?: boolean; viewCount?: number; createdAt?: string }>
  >([]);
  const [shareLinkCount, setShareLinkCount] = useState(0);
  const [assetReports, setAssetReports] = useState<StoredForensicReport[]>([]);

  useEffect(() => () => window.speechSynthesis.cancel(), []);

  useEffect(() => {
    if (!vaultId) return;
    const saved = readCreatorNote(vaultId);
    setCreatorNote(saved.text);
    setCreatorNoteAt(saved.updatedAt);
    setEditingNote(false);
    setNoteDraft(saved.text);
  }, [vaultId]);

  useEffect(() => {
    if (!vaultId || !record) return;
    const load = () => {
      setAssetReports(reportsForThisAsset(
        listForensicReports(),
        vaultId,
        record.dnaRecordId,
        record.originalFileName,
      ));
    };
    load();
    window.addEventListener(FORENSIC_REPORTS_UPDATED_EVENT, load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener(FORENSIC_REPORTS_UPDATED_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, [vaultId, record]);

  useEffect(() => {
    if (guestMode) {
      if (!liveToken) return;
      let cancelled = false;
      setLoading(true);
      setRecord(null);
      setTracking(null);
      setIntel(null);
      setShareLinks([]);
      setShareEvents([]);
      setShareLinkCount(0);
      setListed(null);

      void getPublicLivingStory(liveToken)
        .then((story) => {
          if (cancelled) return;
          const row = story.record as VaultRecord & {
            dnaRecord?: { filename?: string; imageFilename?: string; id: string; status: string };
          };
          setRecord({
            ...row,
            dnaRecord: {
              id: row.dnaRecord?.id ?? row.dnaRecordId,
              status: row.dnaRecord?.status ?? 'COMPLETE',
              filename: row.dnaRecord?.filename ?? row.originalFileName,
            },
          });
          if (story.tracking) setTracking(story.tracking);
          setShareLinkCount(story.shareLinkCount ?? 0);
          setIntel(story.intel ?? null);
          setAnalysis((row.contentAnalysis as VaultContentAnalysis | null) ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          toast.error('This living page is no longer available');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    if (!routeVaultId) return;
    let cancelled = false;
    setLoading(true);
    setRecord(null);
    setTracking(null);
    setIntel(null);
    setShareLinks([]);
    setShareEvents([]);
    setShareLinkCount(0);
    setListed(null);

    void getVaultRecord(routeVaultId)
      .then((vault) => {
        if (cancelled) return;
        const row = vault as VaultRecord & {
          dnaRecord?: { filename?: string; imageFilename?: string; id: string; status: string };
        };
        setRecord({
          ...row,
          dnaRecord: {
            id: row.dnaRecord?.id ?? row.dnaRecordId,
            status: row.dnaRecord?.status ?? 'COMPLETE',
            filename: row.dnaRecord?.filename ?? row.dnaRecord?.imageFilename ?? row.originalFileName,
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Could not open this file');
        navigate('/vault', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void getVaultTracking(routeVaultId).then((t) => {
      if (!cancelled) setTracking(t);
    }).catch(() => { /* story still opens */ });

    void getExchangeListedAssets().then((listedRes) => {
      if (cancelled) return;
      const hit = listedRes.listed?.find((x) => x.vaultId === routeVaultId);
      setListed(hit ? { listingId: hit.listingId } : null);
    }).catch(() => { /* optional */ });

    void api.get(`${API_BASE_URL}/share/vault/${routeVaultId}`).then((shares) => {
      if (cancelled) return;
      const links = (shares.data as {
        links?: Array<{
          token: string;
          isActive?: boolean;
          viewCount?: number;
          createdAt?: string;
          accessLogs?: typeof shareEvents;
        }>;
      }).links ?? [];
      setShareLinks(links.filter((l) => Boolean(l.token)));
      setShareLinkCount(links.length);
      setShareEvents(links.flatMap((l) => l.accessLogs ?? []));
    }).catch(() => { /* optional */ });

    void api.get(`${API_BASE_URL}/intelligence/report/${routeVaultId}`).then((intelRes) => {
      if (cancelled) return;
      setIntel(
        (intelRes.data as { report?: IntelLite }).report
        ?? (intelRes.data as IntelLite),
      );
    }).catch(() => { /* optional */ });

    return () => {
      cancelled = true;
    };
  }, [guestMode, liveToken, routeVaultId, navigate]);

  useEffect(() => {
    if (guestMode) return;
    if (!vaultId || !record) return;
    if (!(record.originalMimeType || '').startsWith('image/')) return;
    let cancelled = false;
    void getVaultContentAnalysis(vaultId)
      .then((snap) => {
        if (!cancelled) setAnalysis(snap.contentAnalysis ?? record.contentAnalysis ?? null);
      })
      .catch(() => {
        if (!cancelled) setAnalysis(record.contentAnalysis ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [guestMode, vaultId, record]);

  useEffect(() => {
    if (guestMode) return;
    if (!record?.id) return;
    setLiked(readLiked(record.id));
    void getPortfolioContainsVault(record.id).then(setInPortfolio).catch(() => setInPortfolio(false));
  }, [guestMode, record?.id]);

  const loc = tracking?.location ?? record?.location;
  const coords = bestCoordsFromLocation(loc ?? undefined);
  const intelLat = intel?.provenance?.gpsLatitude;
  const intelLng = intel?.provenance?.gpsLongitude;
  const lat = coords?.lat ?? (typeof intelLat === 'number' ? intelLat : undefined);
  const lng = coords?.lng ?? (typeof intelLng === 'number' ? intelLng : undefined);
  const locSource = record?.location?.creationSource ?? (loc as { creationSource?: string } | undefined)?.creationSource;
  const locationLabel =
    loc?.creationLabel || loc?.presentLabel || loc?.lastKnownLabel || coords?.label || null;
  const ownerName = tracking?.owner?.fullName || user?.name || null;
  const views = intel?.distribution?.totalViews ?? tracking?.summary.downloadCount ?? shareEvents.length;
  const downloads = intel?.distribution?.totalDownloads ?? tracking?.summary.downloadCount ?? 0;
  const shares = intel?.distribution?.totalShareLinks ?? shareLinkCount;
  const rawTamper = String(intel?.integrity?.tamperStatus || '').toUpperCase();
  const contentVerdict = analysis?.verdictDisplay || analysis?.labelDisplay || '';
  const contentIsPending = !contentVerdict || /unverified|not yet|pending/i.test(contentVerdict);
  /** UNVERIFIED from intelligence means no re-check yet — not that the original is fake. */
  const tamperLabel =
    rawTamper === 'TAMPERED'
      ? 'Tampered'
      : rawTamper === 'VERIFIED' || (analysis?.scores && analysis.scores.tamperScore < 15)
        ? 'Authentic'
        : contentIsPending
          ? 'Protected'
          : contentVerdict;
  const showTamperBadge = rawTamper === 'TAMPERED';
  const hasIdentity = Boolean(record?.dnaRecordId || record?.assetId);

  const briefing = useMemo(() => {
    if (!record) {
      return { about: [] as string[], activity: [] as string[], spoken: '', latest: [] as { at: string; title: string; detail?: string; kind: 'activity' | 'investigation' | 'origin' }[] };
    }
    const events: BriefingEvent[] = [
      { at: record.createdAt, title: 'Captured & protected', kind: 'origin' },
    ];
    for (const c of tracking?.chainOfCustody ?? []) {
      events.push({
        at: c.timestamp,
        title: (c.summary || c.step || c.eventType || 'Activity').replace(/_/g, ' '),
        detail: c.locationLabel,
        kind: /investigat|evidence|tamper/i.test(`${c.step} ${c.eventType} ${c.summary}`) ? 'investigation' : 'activity',
      });
    }
    for (const ev of shareEvents) {
      events.push({
        at: ev.createdAt,
        title: (ev.action || 'Share event').replace(/_/g, ' '),
        detail: [ev.device, ev.country].filter(Boolean).join(' · ') || undefined,
        kind: 'activity',
      });
    }
    for (const ev of intel?.distribution?.timeline ?? []) {
      events.push({
        at: ev.at,
        title: (ev.action || 'Access').replace(/_/g, ' '),
        kind: 'activity',
      });
    }
    if (intel?.integrity?.lastVerification?.at) {
      events.push({
        at: intel.integrity.lastVerification.at,
        title: intel.integrity.lastVerification.passed ? 'Asset verified' : 'Verification failed',
        kind: 'investigation',
      });
    }
    for (const d of tracking?.downloads ?? []) {
      events.push({ at: d.timestamp, title: d.summary || 'Downloaded', kind: 'activity' });
    }
    const scene = !contentIsPending && (analysis?.summary || analysis?.verdictDisplay) ? (analysis?.summary || analysis?.verdictDisplay || null) : null;
    return buildLiveBriefing({
      createdAt: record.createdAt,
      ownerName,
      locationLabel,
      tracking,
      hasIdentity,
      shareCount: shares,
      viewCount: views,
      downloadCount: downloads,
      mimeType: record.originalMimeType,
      fileName: record.originalFileName,
      deviceModel: intel?.provenance?.deviceModel || null,
      captureMethod: record ? vaultSourceCaption(record) : null,
      sceneLabel: scene,
      tamperLabel,
      tamperVerified: rawTamper === 'VERIFIED' || tamperLabel === 'Authentic',
      events,
    });
  }, [record, tracking, ownerName, locationLabel, hasIdentity, shares, views, downloads, intel, shareEvents, analysis, contentIsPending, tamperLabel, rawTamper]);

  const aboutLines = (() => {
    const desc = livingBrief
      ? [livingBrief.line1, livingBrief.line2].filter(Boolean).slice(0, 2)
      : [];
    const when = record ? format(new Date(record.createdAt), 'd MMMM yyyy') : '';
    const who = firstName(ownerName);
    const place = locationLabel && !/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+/.test(locationLabel) ? locationLabel : null;
    const origin = who
      ? `I was protected by ${who}${when ? ` on ${when}` : ''}${place ? ` in ${place}` : ''} and preserved in PinIT Vault.`
      : `I was preserved in PinIT Vault${when ? ` on ${when}` : ''}${place ? ` in ${place}` : ''}.`;
    return [...desc, origin].filter(Boolean);
  })();
  const spoken = aboutLines.slice(0, 3).join(' ').trim();
  const highlights = storyHighlights({
    hasIdentity,
    hasLocation: Boolean(locationLabel || (lat != null && lng != null)),
    hasShares: shares > 0 || views > 0,
    isProtected: true,
  });

  const journey = useMemo(() => {
    if (!record) return [];
    const steps: { at: string; label: string; title: string; detail: string }[] = [
      {
        at: record.createdAt,
        label: 'Captured',
        title: `Protected by ${firstName(ownerName)}`,
        detail: format(new Date(record.createdAt), 'd MMM yyyy · h:mm a'),
      },
      {
        at: record.createdAt,
        label: 'Protected',
        title: 'Saved to PINIT Vault',
        detail: 'Encrypted and given a protection record',
      },
    ];
    for (const c of tracking?.chainOfCustody ?? []) {
      const label = (c.step || c.eventType || 'Event').replace(/_/g, ' ');
      if (/protect|captur|vault/i.test(label) && steps.length <= 2) continue;
      steps.push({
        at: c.timestamp,
        label,
        title: c.summary,
        detail: [c.locationLabel, c.tepCode].filter(Boolean).join(' · ') || format(new Date(c.timestamp), 'd MMM yyyy · h:mm a'),
      });
    }
    for (const ev of shareEvents.slice(0, 8)) {
      steps.push({
        at: ev.createdAt,
        label: ev.action || 'Shared',
        title: ev.action || 'Interaction',
        detail: [ev.device, ev.country].filter(Boolean).join(' · ') || format(new Date(ev.createdAt), 'd MMM yyyy · h:mm a'),
      });
    }
    return steps
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(0, 10);
  }, [record, tracking, ownerName, shareEvents]);

  const peopleMet = useMemo(() => {
    const fromIntel = (intel?.distribution?.recipients ?? []).filter(Boolean);
    if (fromIntel.length) return fromIntel;
    const labels = shareEvents
      .map((ev) => [ev.device, ev.country].filter(Boolean).join(' · '))
      .filter(Boolean);
    return [...new Set(labels)];
  }, [intel, shareEvents]);

  const stopVoice = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setVoicePaused(false);
    if (vaultId) sessionStorage.setItem(`pinit_story_stop_${vaultId}`, '1');
  }, [vaultId]);

  const startVoice = useCallback((replay = false) => {
    if (!spoken) return;
    if (replay && vaultId) sessionStorage.removeItem(`pinit_story_stop_${vaultId}`);
    const twoLineSpoken = spoken.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3).join(' ');
    const u = new SpeechSynthesisUtterance(twoLineSpoken);
    u.rate = 0.96;
    u.onend = () => {
      setSpeaking(false);
      setVoicePaused(false);
    };
    u.onerror = () => {
      setSpeaking(false);
      setVoicePaused(false);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
    setVoicePaused(false);
  }, [spoken, vaultId]);

  const pauseVoice = useCallback(() => {
    if (!speaking) return;
    if (voicePaused) {
      window.speechSynthesis.resume();
      setVoicePaused(false);
      return;
    }
    window.speechSynthesis.pause();
    setVoicePaused(true);
  }, [speaking, voicePaused]);

  useEffect(() => () => window.speechSynthesis.cancel(), []);

  useEffect(() => {
    if (guestMode || !vaultId) {
      setLivingBriefReady(true);
      return;
    }
    let cancelled = false;
    setLivingBriefReady(false);
    void getLivingAssetBrief(vaultId)
      .then((brief) => {
        if (cancelled) return;
        setLivingBrief(brief);
        setLivingBriefReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLivingBrief(null);
        setLivingBriefReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [guestMode, vaultId]);

  useEffect(() => {
    if (!spoken || !vaultId || loading || !livingBriefReady) return;
    if (!guestMode && !livingBrief) return;
    if (autoPlayTried.current) return;
    autoPlayTried.current = true;
    if (sessionStorage.getItem(`pinit_story_stop_${vaultId}`)) return;
    if (sessionStorage.getItem(`pinit_living_brief_played_${vaultId}`)) return;
    sessionStorage.setItem(`pinit_living_brief_played_${vaultId}`, '1');
    try {
      startVoice();
    } catch {
      setSpeaking(false);
    }
  }, [spoken, vaultId, loading, livingBriefReady, startVoice]);

  const applyDisplayName = (nextName: string) => {
    setRecord((prev) => (prev ? { ...prev, originalFileName: nextName } : prev));
  };

  const startRename = () => {
    if (!record) return;
    setRenameDraft(splitFileName(record.originalFileName).base);
    setRenaming(true);
  };

  const applyRename = async () => {
    if (!record) return;
    const { ext } = splitFileName(record.originalFileName);
    const base = renameDraft.trim().replace(/[<>:"/\\|?*]/g, '').slice(0, 120);
    if (!base) {
      toast.error('Enter a valid file name');
      return;
    }
    const nextName = `${base}${ext}`;
    if (nextName === record.originalFileName) {
      setRenaming(false);
      return;
    }
    setRenameSaving(true);
    try {
      const result = await renameVaultRecord(record.id, nextName);
      applyDisplayName(result.originalFileName);
      setRenaming(false);
      toast.success('File renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!record) return;
    if (!window.confirm(`Remove "${record.originalFileName}" from My Assets?`)) return;
    setDeleting(true);
    try {
      await deleteVaultRecord(record.id);
      toast.success('File removed');
      navigate('/vault');
    } catch {
      toast.error('Failed to delete file');
    } finally {
      setDeleting(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!record) return;
    setDownloadingReport(true);
    try {
      const view = await fetchIntelView(record.id);
      await downloadIntelligenceReportPdf(view);
      toast.success('Intelligence report downloaded');
    } catch {
      toast.error('Could not download report');
    } finally {
      setDownloadingReport(false);
    }
  };

  const shareLivingPage = async () => {
    if (!record) return;
    try {
      const created = await createLivingShare(record.id);
      const url = created.shareUrl.startsWith('http')
        ? created.shareUrl
        : `${window.location.origin}/s/${created.token}/live`;
      const title = record.originalFileName || 'Living asset';
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title, text: 'PinIT Living Asset', url });
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Read-only living page link copied');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not share living page');
    }
  };

  if (loading || !record) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const source = vaultSourceCaption(record);
  const captureTime = intel?.provenance?.capturedAt || record.createdAt;
  const sha = shortHash(intel?.integrity?.sha256Hash ?? analysis?.signals?.sha256 ?? null);
  const phash = shortHash(intel?.integrity?.normalizedHash ?? null);
  const env = (tracking as { environment?: Record<string, unknown> } | null)?.environment;
  const envVal = (key: string) => {
    const v = env?.[key];
    if (v == null || String(v).trim() === '') return 'Not recorded';
    return String(v);
  };
  const envKeys = ['weather', 'temperature', 'light', 'direction', 'humidity', 'atmosphere'] as const;
  const hasEnv = envKeys.some((k) => envVal(k) !== 'Not recorded');
  const investigationCount = tracking?.summary.investigationCount ?? 0;

  return (
    <div className={`${guestMode ? 'min-h-screen bg-bg-base px-4 pt-6' : ''} max-w-[1180px] mx-auto pb-8 text-[13px] space-y-3`}>
      {guestMode && liveToken && (
        <LivingPageGuestTracker
          token={liveToken}
          ready={Boolean(record)}
          onBlockedChange={setLivingBlocked}
        />
      )}
      {!(guestMode && livingBlocked) && (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {guestMode ? (
          <p className="text-xs font-medium text-slate-500">PinIT · Read-only living asset</p>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/vault')}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-dna-500"
          >
            <ArrowLeft size={14} /> My Assets
          </button>
        )}
        {!guestMode && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void shareLivingPage()} className="btn btn-secondary btn-sm gap-1.5">
            <Share2 size={14} /> Share
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadReport()}
            disabled={downloadingReport}
            className="btn btn-secondary btn-sm gap-1.5"
          >
            <Download size={14} /> {downloadingReport ? 'Preparing…' : 'Download Report'}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="btn-ghost btn-icon"
              aria-label="More"
            >
              <MoreHorizontal size={18} />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-bg-border bg-bg-card shadow-sm p-1">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-50 dark:hover:bg-bg-elevated"
                  onClick={() => { setMoreOpen(false); startRename(); }}
                >
                  Rename file
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-50 dark:hover:bg-bg-elevated"
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(`/profile?tab=portfolio&addVault=${encodeURIComponent(record.id)}`);
                  }}
                >
                  {inPortfolio ? 'Open in portfolio' : 'Add to portfolio'}
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-50 dark:hover:bg-bg-elevated"
                  onClick={async () => {
                    setMoreOpen(false);
                    try {
                      await navigator.clipboard.writeText(record.assetId || record.dnaRecordId);
                      toast.success('Origin ID copied');
                    } catch {
                      toast.error('Could not copy');
                    }
                  }}
                >
                  Copy origin ID
                </button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {!guestMode && renaming && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-bg-border bg-bg-card p-2">
          <input
            type="text"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void applyRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="input text-sm flex-1 min-w-[160px]"
            autoFocus
            disabled={renameSaving}
            aria-label="New file name"
          />
          <span className="text-xs text-slate-500">{splitFileName(record.originalFileName).ext}</span>
          <button type="button" onClick={() => void applyRename()} disabled={renameSaving} className="btn-primary btn-sm" aria-label="Save name">
            <Check size={14} />
          </button>
          <button type="button" onClick={() => setRenaming(false)} disabled={renameSaving} className="btn-ghost btn-sm" aria-label="Cancel rename">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.95fr)] lg:items-stretch">
        <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm dark:border-bg-border bg-neutral-950 shrink-0">
          <div className="relative flex w-full items-center justify-center">
            <VaultFileThumbnail
              vaultId={record.id}
              fileName={record.originalFileName}
              mimeType={record.originalMimeType}
              variant="gallery"
              quality="original"
              fit="contain"
              sizeToImage
              publicFileUrl={guestMode && liveToken ? `${API_BASE_URL}/share/${encodeURIComponent(liveToken)}/file` : undefined}
            />
            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              <Badge variant="success">Verified Original</Badge>
              {showTamperBadge && <Badge variant="warning">Tampered</Badge>}
              {!showTamperBadge && tamperLabel === 'Authentic' && <Badge variant="success">Tamper Proof</Badge>}
              {listed && <Badge variant="orange">On Exchange</Badge>}
            </div>
            {!guestMode && (
            <div className="absolute right-3 top-3 flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const next = !liked;
                  setLiked(next);
                  writeLiked(record.id, next);
                }}
                className={`h-8 w-8 rounded-full bg-white/90 flex items-center justify-center ${liked ? 'text-rose-500' : 'text-slate-600'}`}
                aria-label={liked ? 'Unlike' : 'Like'}
                title={liked ? 'Unlike' : 'Like'}
              >
                <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
              </button>
            </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-between gap-2 p-3 ink-photo">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">
                <MapPin size={12} />
                {locationLabel || (lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Location unavailable')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">
                {format(new Date(captureTime), 'd MMM yyyy')}
                <span className="opacity-80">{format(new Date(captureTime), 'h:mm a')}</span>
              </span>
            </div>
          </div>
        </div>
        <p className="px-0.5 text-sm font-medium text-slate-800 truncate" title={record.originalFileName}>
          {record.originalFileName}
        </p>

        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200/80 bg-bg-card p-3.5 shadow-sm dark:border-bg-border">
          <div className="flex items-end justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">What makes me special?</h2>
            <p className="text-[11px] text-slate-400 hidden sm:block">Identity, history, purpose</p>
          </div>
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {highlights.map((h, i) => {
              const Icon = HIGHLIGHT_ICONS[i] ?? ShieldCheck;
              return (
                <div key={h.title} className="text-center px-0.5">
                  <span className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${HIGHLIGHT_TONES[i] ?? 'bg-dna-500/10 text-dna-500'}`}>
                    <Icon size={16} />
                  </span>
                  <p className="mt-1.5 text-[11px] font-semibold text-slate-800 leading-tight">{h.title}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500 leading-snug">{h.detail}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5 dark:border-bg-border dark:bg-amber-950/10">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Personal Note</h2>
              {!guestMode && !editingNote && (
                <button
                  type="button"
                  onClick={() => {
                    setNoteDraft(creatorNote);
                    setEditingNote(true);
                  }}
                  className="h-7 w-7 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center justify-center border border-amber-200/80 shrink-0"
                  aria-label="Write a personal note"
                  title="Write a personal note"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
            {editingNote ? (
              <div className="mt-1.5">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  maxLength={600}
                  rows={2}
                  autoFocus
                  placeholder="Write a personal note about this moment…"
                  className="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-amber-300"
                />
                <div className="mt-1.5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNote(false);
                      setNoteDraft(creatorNote);
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    <X size={12} /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!vaultId) return;
                      const saved = writeCreatorNote(vaultId, noteDraft);
                      setCreatorNote(saved.text);
                      setCreatorNoteAt(saved.updatedAt);
                      setEditingNote(false);
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-600 px-2.5 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    <Check size={12} /> Save
                  </button>
                </div>
              </div>
            ) : creatorNote ? (
              <p className="mt-1 text-[12px] leading-snug text-slate-700 italic truncate">
                “{creatorNote}”
                <span className="not-italic text-[11px] text-slate-500 ml-1.5">
                  — {firstName(ownerName)}
                  {creatorNoteAt ? ` · ${format(new Date(creatorNoteAt), 'd MMM yyyy')}` : ''}
                </span>
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNoteDraft('');
                  setEditingNote(true);
                }}
                className="mt-0.5 text-[12px] text-amber-800/80 hover:text-amber-900"
              >
                Add a personal note
              </button>
            )}
          </div>
        </div>
        </div>

        <div className="flex h-full min-h-0 flex-col">
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-5 sm:p-6 shadow-sm dark:border-violet-900/40 dark:from-violet-950/40 dark:via-bg-card dark:to-sky-950/20">
          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-violet-200/40 blur-3xl dark:bg-violet-600/10" />
          <div className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-600/10" />

          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Sparkles size={15} className="text-violet-500" /> Let me introduce myself
              </p>
              <p className="mt-1 text-xs text-slate-500">Your asset’s live story</p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-600 ring-1 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-800">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              Living Asset
            </span>
          </div>

          <div className="relative mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <IntroFact
              icon={Camera}
              label="Captured"
              value={`${format(new Date(captureTime), 'd MMM yyyy')} · ${format(new Date(captureTime), 'h:mm a')}`}
            />
            {ownerName?.trim() && (
              <IntroFact icon={User} label="Protected by" value={ownerName.trim()} />
            )}
            <IntroFact
              icon={Archive}
              label="Origin"
              value={source ? `${source} · PinIT Vault` : 'Captured and preserved in PinIT Vault'}
            />
            {hasIdentity && (
              <IntroFact
                icon={Fingerprint}
                label="Identity"
                value={shortHash(record.assetId || record.dnaRecordId) || 'Unique PinIT Origin ID'}
              />
            )}
            <IntroFact
              icon={ShieldCheck}
              label="Protection"
              value={
                showTamperBadge
                  ? 'Tampered'
                  : tamperLabel === 'Authentic'
                    ? 'Original · Tamper Protected'
                    : 'Protected in PinIT Vault'
              }
            />
            <IntroFact
              icon={Route}
              label="Journey"
              value={[
                'Preserved',
                shares > 0 ? 'Shared' : null,
                tamperLabel === 'Authentic' || rawTamper === 'VERIFIED' ? 'Verified' : null,
              ].filter((bit): bit is string => Boolean(bit)).join(' · ')}
            />
          </div>

          <div className="relative mt-3 rounded-xl border border-violet-100/80 bg-white/70 px-4 py-3 dark:border-violet-800/40 dark:bg-violet-950/20">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500 mb-2">About me</p>
            <div className="space-y-1.5 border-l-2 border-violet-200 pl-3 dark:border-violet-700">
              {!livingBriefReady && !guestMode ? (
                <>
                  <p className="text-[13px] leading-relaxed text-slate-400">Describing this asset…</p>
                  <p className="text-[13px] leading-relaxed text-slate-400">Who protected it and where will appear with the description.</p>
                </>
              ) : (
                aboutLines.map((line) => (
                  <p key={line} className="text-[13px] leading-relaxed text-slate-600">{line}</p>
                ))
              )}
            </div>
            {briefing.activity.length > 0 && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-600 mt-3 mb-2">What happened to me</p>
                <div className="space-y-1.5 border-l-2 border-sky-200 pl-3 dark:border-sky-800">
                  {briefing.activity.map((line) => (
                    <p key={line} className="text-[13px] leading-relaxed text-slate-600">{line}</p>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => (speaking ? pauseVoice() : startVoice())}
            className="relative mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:from-violet-500 hover:to-indigo-400"
          >
            {speaking && !voicePaused ? <Pause size={16} /> : speaking && voicePaused ? <Play size={16} /> : <Volume2 size={16} />}
            {speaking && !voicePaused ? 'Playing…' : speaking && voicePaused ? 'Resume story' : 'Hear My Story'}
          </button>
          <div className="relative mt-1.5 flex items-center justify-center gap-3 text-[11px] text-slate-500">
            <button type="button" onClick={pauseVoice} disabled={!speaking} className="hover:text-violet-600 disabled:opacity-40">Pause</button>
            <span>·</span>
            <button type="button" onClick={stopVoice} className="hover:text-violet-600">Stop</button>
            <span>·</span>
            <button type="button" onClick={() => startVoice(true)} className="inline-flex items-center gap-1 hover:text-violet-600">
              <RotateCcw size={11} /> Replay
            </button>
          </div>
          <p className="relative mt-2 text-center text-[11px] text-slate-400">
            Voice · Device speech · Recorded facts only
          </p>
        </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 items-stretch">
        <Card title="Asset details">
          <Fact label="Name" value={record.originalFileName} />
          <Fact label="Type" value={getVaultFileTypeDisplay(record.originalMimeType, record.originalFileName)} />
          {record.originalMimeType && record.originalMimeType !== getVaultFileTypeDisplay(record.originalMimeType, record.originalFileName) && (
            <Fact label="Format" value={record.originalMimeType} />
          )}
          <Fact label="Size" value={record.originalSizeBytes != null ? formatBytes(record.originalSizeBytes) : ''} />
          <Fact label="Encryption" value={record.encryptionAlgorithm || ''} />
          {listed && <Fact label="Exchange" value="Listed" />}
          {inPortfolio && <Fact label="Portfolio" value="Added" />}
          {(tracking?.summary.countriesSeen?.length ?? 0) > 0 && (
            <Fact label="Seen in" value={tracking!.summary.countriesSeen.slice(0, 4).join(', ')} />
          )}
          {(tracking?.summary.devicesSeen?.length ?? 0) > 0 && (
            <Fact label="Devices" value={tracking!.summary.devicesSeen.slice(0, 3).join(', ')} />
          )}
        </Card>

        <Card title="Location">
          {lat != null && lng != null ? (
            <>
              <iframe
                title="Map"
                className="w-full h-24 rounded-xl border border-bg-border mb-2"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.03}%2C${lat - 0.03}%2C${lng + 0.03}%2C${lat + 0.03}&layer=mapnik&marker=${lat}%2C${lng}`}
              />
              <Fact label="Location" value={locationLabel || `${lat.toFixed(5)}, ${lng.toFixed(5)}`} />
              <Fact label="Latitude / longitude" value={`${lat.toFixed(5)}, ${lng.toFixed(5)}`} />
              <Fact label="Location source" value={locSource === 'gps' ? 'Device GPS' : locSource === 'ip' ? 'Network' : locSource || 'Recorded at protect'} />
            </>
          ) : (
            <EmptyLine>Location unavailable</EmptyLine>
          )}
        </Card>

        <Card
          title="Investigation reports"
          action={!guestMode ? (
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to={`${BRAND.investigationPath}?vaultId=${encodeURIComponent(record.id)}`}
                className="text-[11px] font-medium text-dna-500 inline-flex items-center gap-1"
              >
                <FileSearch size={12} /> Investigate
              </Link>
              <Link to="/reports" className="text-[11px] font-medium text-dna-500">Open Evidence</Link>
            </div>
          ) : undefined}
        >
          {assetReports.length === 0 && investigationCount === 0 ? (
            <p className="text-xs text-slate-500">No investigation reports for this asset yet.</p>
          ) : assetReports.length === 0 ? (
            <p className="text-xs text-slate-500">{investigationCount} investigation{investigationCount === 1 ? '' : 's'} on record for this asset.</p>
          ) : (
            <ul className="space-y-2">
              {assetReports.slice(0, 3).map((entry) => {
                if (entry.kind === 'investigation') {
                  const verdict = investigationVerdictLabel(entry.data);
                  const score = investigationDisplayScore(entry.data);
                  return (
                    <li key={entry.id}>
                      <Link
                        to="/reports"
                        className="block rounded-xl border border-slate-100 px-2.5 py-2 hover:border-violet-200 dark:border-bg-border"
                      >
                        <p className="text-[12px] font-medium text-slate-800 truncate">{entry.filename}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {format(new Date(entry.savedAt), 'd MMM yyyy · h:mm a')}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold text-slate-600">{verdict} · {score}%</span>
                          <span className="text-[11px] font-semibold text-violet-600 shrink-0">View</span>
                        </div>
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={entry.id}>
                    <Link
                      to="/reports"
                      className="block rounded-xl border border-slate-100 px-2.5 py-2 hover:border-violet-200 dark:border-bg-border"
                    >
                      <p className="text-[12px] font-medium text-slate-800 truncate">Comparison · {entry.data.classification}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{format(new Date(entry.savedAt), 'd MMM yyyy · h:mm a')}</p>
                      <div className="mt-1 flex justify-end">
                        <span className="text-[11px] font-semibold text-violet-600">View</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Shared links"
          action={!guestMode ? (
            <Link
              to={record.assetId ? `/tracking/${encodeURIComponent(record.assetId)}` : `/timeline?vaultId=${encodeURIComponent(record.id)}`}
              className="text-[11px] font-medium text-dna-500"
            >
              Open tracking
            </Link>
          ) : undefined}
        >
          {shareLinks.length === 0 ? (
            <p className="text-xs text-slate-500">No share links yet for this asset.</p>
          ) : (
            <ul className="space-y-1">
              {shareLinks.slice(0, 4).map((link, i) => (
                <li key={link.token}>
                  <Link
                    to={record.assetId ? `/tracking/${encodeURIComponent(record.assetId)}` : `/timeline?vaultId=${encodeURIComponent(record.id)}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-bg-elevated"
                  >
                    <span className="text-[12px] font-medium text-slate-800 truncate">
                      Link {i + 1}
                      {link.isActive === false ? ' · stopped' : ''}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {link.viewCount ?? 0} views
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {hasEnv && (
        <Card title="Environment">
          <Fact label="Weather" value={envVal('weather')} />
          <Fact label="Temperature" value={envVal('temperature')} />
          <Fact label="Light" value={envVal('light')} />
          <Fact label="Direction" value={envVal('direction')} />
          <Fact label="Humidity" value={envVal('humidity')} />
          <Fact label="Atmosphere" value={envVal('atmosphere')} />
        </Card>
        )}
      </div>

      <Card title="My Life Journey (From Birth Till Now)">
        <div className="flex items-center justify-between gap-2 -mt-1 mb-4">
          <p className="text-[11px] text-slate-500">A record of everything that has happened to me</p>
          {!guestMode && (
          <Link to={`/timeline?vaultId=${encodeURIComponent(record.id)}`} className="text-xs font-medium text-dna-500 shrink-0">
            View Full Timeline
          </Link>
          )}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {journey.length === 0 ? (
          <EmptyLine>No journey events yet. Activity appears as this file is shared and verified.</EmptyLine>
        ) : (
          <div className="min-w-0 flex-1 overflow-x-auto pb-1">
            <ol className="flex min-w-max items-start">
              {journey.map((j, i) => {
                const kind = classifyJourney(j.label, j.title);
                const Icon = kind.Icon;
                return (
                  <li key={`${j.at}-${i}`} className="flex items-start">
                    <div className="w-[150px] px-2 text-center">
                      <span className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-white ${kind.ring}`}>
                        <Icon size={15} />
                      </span>
                      <p className="mt-2 text-[10px] text-slate-500">{format(new Date(j.at), 'd MMM yyyy')}</p>
                      <p className="text-[10px] text-slate-400">{format(new Date(j.at), 'h:mm a')}</p>
                      <p className="mt-1 text-[11px] font-medium text-slate-800 leading-snug">{j.title}</p>
                      <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{kind.badge}</p>
                    </div>
                    {i < journey.length - 1 && <span className="mt-4 h-px w-8 shrink-0 bg-slate-200 dark:bg-bg-border" />}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <aside className="flex w-full shrink-0 flex-col items-center justify-center rounded-2xl border border-amber-100 bg-amber-50/80 px-5 py-6 text-center dark:border-amber-900/30 dark:bg-amber-950/15 lg:w-[240px]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">
            <Trophy size={20} />
          </span>
          {Number(views) > 0 || Number(shares) > 0 || Number(downloads) > 0 || peopleMet.length > 0 ? (
            <>
              <p className="mt-3 text-sm font-semibold leading-snug text-slate-800">
                I have touched people and created impact.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {[
                  Number(views) > 0 ? `${views} views` : null,
                  Number(shares) > 0 ? `${shares} shares` : null,
                  peopleMet.length > 0 ? `${peopleMet.length} people` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Thank you for giving me a purpose.'}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Thank you for giving me a purpose.</p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-semibold leading-snug text-slate-800">
                I have not reached people yet.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Views, shares, and named people will appear here when this file is shared.
              </p>
            </>
          )}
          <Heart size={16} className="mt-4 text-slate-300" />
        </aside>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3 items-stretch">
        <Card title="DNA & Proof (My Identity)">
          {!guestMode && (
          <div className="flex justify-end -mt-7 mb-2">
            <Link to={`/intelligence/${record.id}`} className="text-[11px] font-medium text-dna-500">View Full DNA Report</Link>
          </div>
          )}
          <ProofRow label="SHA-256" value={sha || '—'} />
          <ProofRow label="Perceptual Hash" value={phash || '—'} />
          <ProofRow label="Structural Hash" value="See full DNA report" />
          <ProofRow label="Metadata Provenance" value={intel?.provenance?.software || locSource || 'Recorded at protect'} />
          <ProofRow label="Tamper Status" value={tamperLabel} />
          <ProofRow
            label="AI Manipulation Check"
            value={contentIsPending ? 'Not run yet' : (analysis?.verdictDisplay || analysis?.labelDisplay || 'See intelligence report')}
          />
          <ProofRow label="First Seen On" value={format(new Date(record.createdAt), 'd MMM yyyy, h:mm a')} />
        </Card>

        <Card title="Encounters (Who interacted with me)">
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              ['Views', views],
              ['Shares', shares],
              ['Downloads', downloads],
              ['Verifications', intel?.integrity?.layersComplete ?? '—'],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 px-2 py-2 text-center">
                <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">{v}</p>
                <p className="text-[10px] text-slate-500">{k}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">People I met</p>
          {peopleMet.length === 0 ? (
            <EmptyLine>No named people yet. Recipients appear here when Hub has them.</EmptyLine>
          ) : (
            <ul className="space-y-0.5">
              {peopleMet.slice(0, 8).map((p) => (
                <li key={p} className="text-xs text-slate-700">{p}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Image analysis" className="overflow-hidden">
          <div className="h-full overflow-hidden">
            {!(record.originalMimeType || '').startsWith('image/') ? (
              <EmptyLine>Image classification is stored for photographs.</EmptyLine>
            ) : contentIsPending || !analysis ? (
              <EmptyLine>Image analysis has not been stored for this asset yet.</EmptyLine>
            ) : (
              <>
                <Fact label="Content" value={analysis.verdictDisplay || analysis.labelDisplay || analysis.verdict || analysis.label} />
                {analysis.scores && (
                  <>
                    <div className="py-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Authenticity</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{Math.round(analysis.scores.authenticityScore)}%</span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-slate-100 overflow-hidden dark:bg-bg-elevated">
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, analysis.scores.authenticityScore))}%` }} />
                      </div>
                    </div>
                    <div className="py-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Tamper</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{Math.round(analysis.scores.tamperScore)}%</span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-slate-100 overflow-hidden dark:bg-bg-elevated">
                        <div className="h-full bg-amber-500" style={{ width: `${Math.max(0, Math.min(100, analysis.scores.tamperScore))}%` }} />
                      </div>
                    </div>
                    <div className="py-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">AI probability</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{Math.round(analysis.scores.aiProbability)}%</span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-slate-100 overflow-hidden dark:bg-bg-elevated">
                        <div className="h-full bg-rose-500" style={{ width: `${Math.max(0, Math.min(100, analysis.scores.aiProbability))}%` }} />
                      </div>
                    </div>
                    {analysis.scores.confidenceLevel && (
                      <Fact label="Confidence" value={`${Math.round(analysis.scores.confidence <= 1 ? analysis.scores.confidence * 100 : analysis.scores.confidence)}% · ${analysis.scores.confidenceLevel}`} />
                    )}
                  </>
                )}
                {analysis.composition && (
                  <Fact
                    label="Mix"
                    value={[
                      analysis.composition.manualPercent > 0 ? `Original ${Math.round(analysis.composition.manualPercent)}%` : null,
                      analysis.composition.aiGeneratedPercent > 0 ? `AI ${Math.round(analysis.composition.aiGeneratedPercent)}%` : null,
                      analysis.composition.editedPercent > 0 ? `Edited ${Math.round(analysis.composition.editedPercent)}%` : null,
                      analysis.composition.screenshotPercent > 0 ? `Screenshot ${Math.round(analysis.composition.screenshotPercent)}%` : null,
                      (analysis.composition.tamperedPercent ?? 0) > 0 ? `Tampered ${Math.round(analysis.composition.tamperedPercent ?? 0)}%` : null,
                    ].filter(Boolean).join(' · ')}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {!guestMode && (
      <div className="rounded-2xl border border-slate-200/80 bg-bg-card p-5 shadow-sm dark:border-bg-border">
        <h2 className="text-base font-semibold text-slate-800">What you can do with me</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">Your asset is protected. Now decide where its story goes.</p>
        <VaultDetailSidePanel
          layout="embedded"
          record={record}
          listedOnExchange={Boolean(listed)}
          exchangeListingId={listed?.listingId ?? null}
          onClose={() => navigate('/vault')}
          onShare={() => setSharing(true)}
          onDelete={() => void handleDelete()}
          onRenamed={(_id, name) => applyDisplayName(name)}
          deleting={deleting}
        />
      </div>
      )}

      {sharing && (
        <ShareLinkDialog
          vaultId={record.id}
          filename={record.originalFileName}
          sizeBytes={record.originalSizeBytes}
          onClose={() => setSharing(false)}
        />
      )}
      </>
      )}
    </div>
  );
}
