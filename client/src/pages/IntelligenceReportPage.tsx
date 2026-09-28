import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { Badge } from '../components/ui/Badge';
import { fetchIntelView, type IntelFact, type IntelView, type SourceKind } from '../lib/intelligence-bundle';
import { downloadIntelligenceReportPdf } from '../services/intelligence-report-pdf';

const SOURCE_LABEL: Record<SourceKind, string> = {
  recorded: 'Recorded',
  derived: 'Derived',
  ai: 'AI interpretation',
  verified: 'Verified',
  unavailable: 'Not recorded',
};

function SourceChip({ source }: { source: SourceKind }) {
  const tone =
    source === 'verified' || source === 'recorded'
      ? 'text-emerald-600 bg-emerald-50'
      : source === 'ai'
        ? 'text-violet-600 bg-violet-50'
        : source === 'derived'
          ? 'text-sky-600 bg-sky-50'
          : 'text-slate-400 bg-slate-50';
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone}`}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

function copyValue(value?: string) {
  if (!value) return;
  void navigator.clipboard.writeText(value).then(
    () => toast.success('Copied'),
    () => toast.error('Could not copy'),
  );
}

function FactRow({ fact }: { fact: IntelFact }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 dark:border-bg-border">
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">{fact.label}</p>
        <p className="text-[13px] text-slate-800 break-all">{fact.value}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <SourceChip source={fact.source} />
        {fact.copy && fact.source !== 'unavailable' && (
          <button type="button" onClick={() => copyValue(fact.copy)} className="p-1 text-slate-400 hover:text-dna-500" aria-label={`Copy ${fact.label}`}>
            <Copy size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  kicker,
  children,
  action,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-bg-card p-5 shadow-sm dark:border-bg-border">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          {kicker && <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dna-500 mb-0.5">{kicker}</p>}
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusDot({ ok, warn, bad }: { ok?: boolean; warn?: boolean; bad?: boolean }) {
  const color = bad ? 'bg-rose-500' : warn ? 'bg-amber-500' : ok ? 'bg-emerald-500' : 'bg-slate-300';
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

export function IntelligenceReportPage({ adminMode = false }: { adminMode?: boolean }) {
  const { vaultId } = useParams<{ vaultId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<IntelView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const load = async () => {
    if (!vaultId) return;
    setLoading(true);
    setError(null);
    try {
      setView(await fetchIntelView(vaultId, adminMode));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, adminMode]);

  const handleDownload = async () => {
    if (!view) return;
    setDownloading(true);
    try {
      await downloadIntelligenceReportPdf(view);
      toast.success('Intelligence report downloaded');
    } catch {
      toast.error('Could not download report');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24">
        <div className="w-8 h-8 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Opening asset intelligence…</p>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24">
        <AlertTriangle size={28} className="text-rose-500" />
        <p className="text-sm text-rose-600">{error ?? 'Report not found'}</p>
        <button type="button" onClick={() => navigate(-1)} className="btn btn-secondary btn-sm">Go back</button>
      </div>
    );
  }

  const dnaOk = /complete|protected|active/i.test(view.dnaStatus);
  const tamperBad = view.tamperStatus === 'TAMPERED';
  const tamperOk = view.tamperStatus === 'VERIFIED';
  const aiWarn = /signal|probability [1-9]|AI generation/i.test(view.aiLabel) && !/not run/i.test(view.aiLabel);

  return (
    <div className="max-w-[1100px] mx-auto pb-24 space-y-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            if (adminMode) navigate(-1);
            else navigate(`/vault/${view.vaultId}`);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-dna-500"
        >
          <ArrowLeft size={14} /> {adminMode ? 'Back' : 'Living Asset'}
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="btn-ghost btn-icon" title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="btn btn-primary btn-sm gap-1.5"
          >
            <Download size={14} />
            {downloading ? 'Preparing…' : 'Download Full Intelligence Report'}
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-violet-50 p-5 shadow-sm dark:border-bg-border dark:from-bg-card dark:to-violet-950/20">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-dna-500">Asset Intelligence</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-neutral-950 aspect-[4/3]">
            <VaultFileThumbnail
              vaultId={view.previewVaultId}
              fileName={view.filename}
              mimeType={view.mimeType}
              variant="gallery"
              fit="cover"
            />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 break-words">{view.filename}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{view.fileTypeLabel} · {view.mimeType}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tamperOk && <Badge variant="success"><StatusDot ok /> Verified Original</Badge>}
              <Badge variant={dnaOk ? 'success' : 'muted'}><StatusDot ok={dnaOk} /> {dnaOk ? 'Protected' : view.dnaStatus}</Badge>
              <Badge variant="success"><StatusDot ok /> DNA Registered</Badge>
              <Badge variant={tamperBad ? 'danger' : tamperOk ? 'success' : 'muted'}>
                <StatusDot ok={tamperOk} warn={!tamperOk && !tamperBad} bad={tamperBad} /> {view.tamperLabel}
              </Badge>
              <Badge variant={aiWarn ? 'warning' : /not run/i.test(view.aiLabel) ? 'muted' : 'success'}>
                <StatusDot ok={!aiWarn && !/not run/i.test(view.aiLabel)} warn={aiWarn} /> {view.aiLabel}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-slate-400">First seen</p>
                <p className="font-medium text-slate-800">{view.firstSeen}</p>
              </div>
              <div>
                <p className="text-slate-400">Last activity</p>
                <p className="font-medium text-slate-800">{view.lastActivity || 'None recorded'}</p>
              </div>
              <div>
                <p className="text-slate-400">Owner</p>
                <p className="font-medium text-slate-800">{view.ownerName || view.ownerShortId || 'Unavailable'}</p>
              </div>
              <div>
                <p className="text-slate-400">Origin</p>
                <p className="font-medium text-slate-800">{view.captureSource || 'PinIT Vault'}</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-slate-500 font-mono break-all">Origin ID {view.originId}</p>
          </div>
        </div>
      </section>

      {view.leakIndicators.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">Attention</p>
          {view.leakIndicators.map((ind) => <p key={ind}>• {ind}</p>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Asset Identity" kicker="Exact identifiers">
          {view.identity.map((f) => <FactRow key={f.label} fact={f} />)}
        </Card>
        <Card
          title="Original Capture"
          kicker="Recorded from the original file / device"
          action={<SourceChip source="recorded" />}
        >
          {view.capture.map((f) => <FactRow key={f.label} fact={f} />)}
        </Card>
      </div>

      <Card
        title="Camera Forensics"
        kicker="Sensor correlation — not user identity"
        action={<SourceChip source={view.camera.present ? 'derived' : 'unavailable'} />}
      >
        <p className="text-sm text-slate-700 leading-relaxed mb-3">{view.camera.conclusion}</p>
        {view.camera.facts.map((f) => <FactRow key={f.label} fact={f} />)}
        <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">{view.camera.disclaimer}</p>
      </Card>

      <Card title="Content Understanding" kicker="AI-generated interpretation" action={<SourceChip source="ai" />}>
        {!view.content.analyzed && !view.content.summary ? (
          <p className="text-sm text-slate-500">No AI content analysis is stored for this file.</p>
        ) : (
          <div className="space-y-3">
            {view.content.verdict && (
              <p className="text-sm"><span className="text-slate-500">Scene / verdict · </span><span className="font-medium">{view.content.verdict}</span></p>
            )}
            {view.content.summary && <p className="text-sm text-slate-700 leading-relaxed">{view.content.summary}</p>}
            {view.content.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {view.content.reasons.map((reason) => (
                  <span key={reason} className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700">{reason}</span>
                ))}
              </div>
            )}
            {view.content.ocrWords > 0 && (
              <p className="text-xs text-slate-500">OCR · {view.content.ocrWords} words{view.content.ocrLanguage ? ` · ${view.content.ocrLanguage}` : ''}</p>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Environment at Capture" kicker="Only values the system stored">
          {view.environment.map((f) => <FactRow key={f.label} fact={f} />)}
        </Card>
        <Card title="Protection & Authenticity">
          {view.protection.map((f) => <FactRow key={f.label} fact={f} />)}
        </Card>
      </div>

      <Card title="What Happened to This Asset?" kicker="Recorded journey">
        {view.journey.length === 0 ? (
          <p className="text-sm text-slate-500">No journey events yet.</p>
        ) : (
          <ol className="space-y-2">
            {view.journey.map((ev, i) => {
              const key = `${ev.at}-${ev.title}-${i}`;
              const open = openEvent === key;
              return (
                <li key={key} className="rounded-xl border border-slate-100 dark:border-bg-border">
                  <button
                    type="button"
                    onClick={() => setOpenEvent(open ? null : key)}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="mt-1 h-2 w-2 rounded-full bg-violet-500 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">{ev.category}</span>
                      <p className="text-sm font-medium text-slate-800">{ev.title}</p>
                      <p className="text-[11px] text-slate-500">{format(new Date(ev.at), 'd MMM yyyy · h:mm a')}</p>
                    </span>
                    <ChevronDown size={14} className={`mt-1 text-slate-400 ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && <p className="px-8 pb-3 text-xs text-slate-600">{ev.detail}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card title="Where Has This Asset Gone?" kicker="Exposure — not a share action">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {[
            ['Views', view.exposure.views],
            ['Shares', view.exposure.shares],
            ['Downloads', view.exposure.downloads],
            ['Verifications', view.exposure.verifications],
            ['Matches', view.exposure.matches],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl bg-sky-50 dark:bg-sky-950/20 px-2 py-2 text-center">
              <p className="text-lg font-semibold text-sky-700">{v}</p>
              <p className="text-[10px] text-slate-500">{k}</p>
            </div>
          ))}
        </div>
        {view.exposure.countries.length > 0 && (
          <p className="text-xs text-slate-600 mb-2">Countries · {view.exposure.countries.join(', ')}</p>
        )}
        {view.exposure.recipients.length > 0 && (
          <p className="text-xs text-slate-600 mb-2">People recorded · {view.exposure.recipients.join(', ')}</p>
        )}
        {view.exposure.events.length === 0 ? (
          <p className="text-sm text-slate-500">No share or access events recorded yet.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1">
            {view.exposure.events.map((ev, i) => (
              <div key={`${ev.at}-${i}`} className="flex gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-bg-elevated">
                <span className="text-slate-400 shrink-0">{format(new Date(ev.at), 'd MMM HH:mm')}</span>
                <span className="font-medium text-slate-800">{ev.title}</span>
                <span className="text-slate-500 truncate">{ev.detail}</span>
              </div>
            ))}
          </div>
        )}
        {view.exposure.matchesList.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Online matches</p>
            {view.exposure.matchesList.map((m) => (
              <a key={m.url} href={m.url} target="_blank" rel="noreferrer" className="block text-xs text-dna-500 truncate hover:underline">
                {m.matchType.replace(/_/g, ' ')} · {m.url}
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Investigations & Verification"
        action={<Link to="/reports" className="text-[11px] font-medium text-dna-500">Open Evidence</Link>}
      >
        {view.investigations.length === 0 ? (
          <p className="text-sm text-slate-500">No investigations or evidence records are stored for this asset.</p>
        ) : (
          <ul className="space-y-2">
            {view.investigations.map((ev, i) => (
              <li key={`${ev.at}-${i}`} className="rounded-xl border border-slate-100 px-3 py-2 dark:border-bg-border">
                <p className="text-[10px] uppercase tracking-wide text-violet-500">{ev.category}</p>
                <p className="text-sm font-medium">{ev.title}</p>
                <p className="text-xs text-slate-500">{format(new Date(ev.at), 'd MMM yyyy · h:mm a')} · {ev.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="rounded-2xl border border-slate-200/80 bg-bg-card shadow-sm dark:border-bg-border">
        <button type="button" onClick={() => setDnaOpen((o) => !o)} className="w-full flex items-center justify-between px-5 py-4">
          <div className="text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dna-500">Deeper evidence</p>
            <h2 className="text-sm font-semibold text-slate-800">Full DNA & Forensic Analysis</h2>
          </div>
          <ChevronDown size={16} className={dnaOpen ? 'rotate-180 text-slate-400' : 'text-slate-400'} />
        </button>
        {dnaOpen && (
          <div className="px-5 pb-5 grid gap-2 sm:grid-cols-2">
            {view.layers.map((layer) => (
              <div key={layer.key} className="rounded-xl border border-slate-100 px-3 py-2 dark:border-bg-border">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <StatusDot ok={layer.present} />
                  {layer.name}
                  <span className="text-[11px] text-slate-400">{layer.present ? 'Present' : 'Not present'}</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{layer.note}</p>
              </div>
            ))}
            <p className="sm:col-span-2 text-[11px] text-slate-400">
              Only layers actually stored on this DNA record are marked present. This page does not invent independent analysis for missing layers.
            </p>
          </div>
        )}
      </section>

      <Card title="Asset Snapshot" kicker="What the system knows">
        <p className="text-sm leading-relaxed text-slate-700">{view.snapshot}</p>
        <p className="mt-3 text-[11px] text-slate-400">Report generated {format(new Date(view.generatedAt), 'd MMM yyyy, h:mm a')}</p>
      </Card>
    </div>
  );
}
