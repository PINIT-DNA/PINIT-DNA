import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ShieldCheck, AlertTriangle, Globe, Clock,
  Hash, FileSearch,
  Wifi, Activity, ChevronDown, ChevronUp,
  ArrowLeft, RefreshCw, CheckCircle2, XCircle, Minus,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api.config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntelReport {
  generatedAt: string;
  vaultId: string;
  identity: {
    ownerUserId: string; uploaderId: string; mfid: string;
    dnaRecordId: string; filename: string; mimeType: string;
    fileSize: number; encryptedSize: number; fileType: string; engineVersion: string;
  };
  provenance: {
    uploadedAt: string; vaultedAt: string; capturedAt: string | null;
    gpsLatitude: number | null; gpsLongitude: number | null;
    accessGpsLat: number | null; accessGpsLng: number | null; accessGpsCity: string | null;
    country: string | null; city: string | null;
    deviceModel: string | null; software: string | null;
  };
  integrity: {
    sha256Hash: string | null; normalizedHash: string | null;
    dnaStatus: string; layersComplete: number; tamperStatus: string;
    lastVerification: { passed: boolean; confidenceScore: number; at: string } | null;
  };
  discovery: {
    monitoringActive: boolean; scanType: string | null;
    totalRuns: number; totalMatches: number;
    exactMatches: number; highMatches: number; possibleMatches: number;
    recentMatches: { url: string; matchType: string; similarity: number; foundAt: string }[];
    ocrIndexed: boolean; ocrWordCount: number; ocrLanguage: string | null;
  };
  distribution: {
    totalShareLinks: number; activeLinks: number;
    totalViews: number; totalDownloads: number; totalEvents: number;
    uniqueCountries: string[]; uniqueDevices: string[]; uniqueBrowsers: string[]; recipients: string[];
    timeline: { action: string; at: string; country: string | null; device: string | null; browser: string | null; riskLevel: string | null }[];
  };
  risk: {
    riskScore: number; riskLevel: string; evidenceCount: number;
    suspiciousEvents: number; leakIndicators: string[];
    recentEvidence: { code: string; type: string; description: string; at: string }[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}
function shortHash(h: string | null) {
  if (!h) return '—';
  return h.slice(0, 16) + '…' + h.slice(-8);
}

const RISK_COLOR: Record<string, string> = {
  LOW:      'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  MEDIUM:   'text-yellow-400  bg-yellow-400/10  border-yellow-400/30',
  HIGH:     'text-orange-400  bg-orange-400/10  border-orange-400/30',
  CRITICAL: 'text-red-400     bg-red-400/10     border-red-400/30',
};
const MATCH_COLOR: Record<string, string> = {
  EXACT_MATCH:    'text-red-400',
  DUPLICATE:      'text-red-400',
  HIGH_MATCH:     'text-orange-400',
  NEAR_MATCH:     'text-orange-400',
  POSSIBLE_MATCH: 'text-yellow-400',
  POSSIBLE:       'text-yellow-400',
  NO_MATCH:       'text-gray-500',
};
const TAMPER_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  VERIFIED:   { icon: CheckCircle2, color: 'text-emerald-400', label: 'Verified — Unmodified' },
  UNVERIFIED: { icon: Minus,        color: 'text-gray-400',    label: 'Not Yet Verified'      },
  TAMPERED:   { icon: XCircle,      color: 'text-red-400',     label: 'Tamper Detected'       },
};

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon, title, accent, children,
}: { icon: React.ElementType; title: string; accent: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-bg-border bg-bg-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-5 py-4 border-b border-bg-border hover:bg-bg-elevated transition-colors`}
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon size={16} />
        </div>
        <span className="font-semibold text-white text-sm flex-1 text-left">{title}</span>
        {open ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function Row({ label, value, mono = false, accent }: { label: string; value: React.ReactNode; mono?: boolean; accent?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-bg-border/50 last:border-0">
      <span className="text-xs text-gray-500 shrink-0 w-40">{label}</span>
      <span className={`text-xs text-right break-all ${mono ? 'font-mono' : ''} ${accent ?? 'text-gray-200'}`}>{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function IntelligenceReportPage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const navigate    = useNavigate();
  const [report, setReport] = useState<IntelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = async () => {
    if (!vaultId) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${API_BASE_URL}/intelligence/report/${vaultId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Failed to load report');
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [vaultId]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 py-32">
      <div className="w-10 h-10 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-400 text-sm">Generating intelligence report…</p>
    </div>
  );

  if (error || !report) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 py-32">
      <AlertTriangle size={40} className="text-red-400" />
      <p className="text-red-300 text-sm">{error ?? 'Report not found'}</p>
      <button onClick={() => navigate(-1)} className="btn btn-secondary btn-sm">Go Back</button>
    </div>
  );

  const r = report;
  const tamper = TAMPER_CONFIG[r.integrity.tamperStatus] ?? TAMPER_CONFIG['UNVERIFIED'];
  const TamperIcon = tamper.icon;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/vault')} className="p-2 rounded-lg hover:bg-bg-elevated transition-colors">
            <ArrowLeft size={18} className="text-gray-400" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <FileSearch size={20} className="text-dna-400" />
              Document Intelligence Report
            </h1>
            <p className="text-xs text-gray-500 mt-0.5 font-mono truncate max-w-xs">{r.identity.filename}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${RISK_COLOR[r.risk.riskLevel] ?? RISK_COLOR.LOW}`}>
            {r.risk.riskLevel} RISK
          </span>
          <button onClick={load} className="p-2 rounded-lg hover:bg-bg-elevated transition-colors" title="Refresh">
            <RefreshCw size={16} className="text-gray-400" />
          </button>
        </div>
      </div>

      {/* ── Risk score banner ─────────────────────────────────────────────── */}
      {r.risk.leakIndicators.length > 0 && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-orange-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-orange-300">Risk Indicators Detected</p>
            {r.risk.leakIndicators.map((ind, i) => (
              <p key={i} className="text-xs text-orange-200/70">• {ind}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── 6-stat summary bar ────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: 'Risk Score',    value: `${r.risk.riskScore}`,          sub: '/100',    color: r.risk.riskScore > 50 ? 'text-red-400' : 'text-emerald-400' },
          { label: 'Views',         value: `${r.distribution.totalViews}`,   sub: 'total',   color: 'text-dna-400' },
          { label: 'Events',        value: `${r.distribution.totalEvents}`,  sub: 'tracked', color: 'text-blue-400' },
          { label: 'Countries',     value: r.distribution.uniqueCountries.length > 0 ? `${r.distribution.uniqueCountries.length}` : '—', sub: 'reached', color: 'text-blue-400' },
          { label: 'Online Matches',value: `${r.discovery.totalMatches}`,  sub: 'found',   color: r.discovery.totalMatches > 0 ? 'text-orange-400' : 'text-gray-400' },
          { label: 'Evidence',      value: `${r.risk.evidenceCount}`,      sub: 'records', color: r.risk.evidenceCount > 0 ? 'text-yellow-400' : 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="bg-bg-card border border-bg-border rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}<span className="text-xs text-gray-500 font-normal"> {s.sub}</span></p>
            <p className="text-2xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── 1. Identity Intelligence ──────────────────────────────────────── */}
      <Section icon={ShieldCheck} title="Identity Intelligence" accent="bg-dna-500/20 text-dna-400">
        <Row label="Owner User ID"   value={r.identity.ownerUserId}  mono accent="text-dna-400" />
        <Row label="Uploader ID"     value={r.identity.uploaderId}   mono accent="text-dna-400" />
        <Row label="MFID (Vault ID)" value={r.identity.mfid}         mono accent="text-purple-400" />
        <Row label="DNA Record ID"   value={r.identity.dnaRecordId}  mono accent="text-dna-400" />
        <Row label="Filename"        value={r.identity.filename} />
        <Row label="MIME Type"       value={r.identity.mimeType}     mono />
        <Row label="File Type"       value={r.identity.fileType} />
        <Row label="Engine"          value={r.identity.engineVersion} mono />
        <Row label="Original Size"   value={fmt(r.identity.fileSize)} />
        <Row label="Encrypted Size"  value={fmt(r.identity.encryptedSize)} />
      </Section>

      {/* ── 2. Provenance Intelligence ────────────────────────────────────── */}
      <Section icon={Clock} title="Provenance Intelligence" accent="bg-blue-500/20 text-blue-400">
        <Row label="Uploaded At"  value={fmtDate(r.provenance.uploadedAt)} />
        <Row label="Vaulted At"   value={fmtDate(r.provenance.vaultedAt)} />
        {r.provenance.capturedAt  && <Row label="File Created"  value={fmtDate(r.provenance.capturedAt)} />}
        {r.provenance.deviceModel && <Row label="Device Model"  value={r.provenance.deviceModel} />}
        {r.provenance.software    && <Row label="Software"      value={r.provenance.software} />}
        <Row label="Country"      value={r.provenance.country ?? '—'} />
        <Row label="City"         value={r.provenance.city    ?? '—'} />
        {r.provenance.accessGpsCity && <Row label="Access City" value={r.provenance.accessGpsCity} />}

        {/* Advanced Forensics — GPS (sensitive, collapsed by default) */}
        {(r.provenance.gpsLatitude !== null || r.provenance.accessGpsLat !== null) && (
          <details className="mt-3">
            <summary className="text-2xs text-gray-500 cursor-pointer hover:text-gray-300 select-none">
              Advanced Forensics — GPS Metadata
            </summary>
            <div className="mt-2 space-y-1">
              {r.provenance.gpsLatitude !== null && (
                <Row label="File GPS"
                  value={`${r.provenance.gpsLatitude.toFixed(2)}°, ${r.provenance.gpsLongitude?.toFixed(2)}°`} />
              )}
              {r.provenance.accessGpsLat !== null && (
                <Row label="Access GPS"
                  value={`${r.provenance.accessGpsLat.toFixed(2)}°, ${r.provenance.accessGpsLng?.toFixed(2)}°`} />
              )}
            </div>
          </details>
        )}
      </Section>

      {/* ── 3. Integrity Intelligence ─────────────────────────────────────── */}
      <Section icon={Hash} title="Integrity Intelligence" accent="bg-emerald-500/20 text-emerald-400">
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-bg-elevated">
          <TamperIcon size={18} className={tamper.color} />
          <span className={`text-sm font-semibold ${tamper.color}`}>{tamper.label}</span>
          {r.integrity.lastVerification && (
            <span className="ml-auto text-2xs text-gray-500">
              {Math.round(r.integrity.lastVerification.confidenceScore * 100)}% confidence
            </span>
          )}
        </div>
        <Row label="DNA Status"       value={r.integrity.dnaStatus} />
        <Row label="Layers Complete"  value={`${r.integrity.layersComplete}/6`} accent="text-emerald-400" />
        <Row label="SHA-256 Hash"      value={shortHash(r.integrity.sha256Hash)} mono />
        <Row label="Normalized Hash"   value={shortHash(r.integrity.normalizedHash)} mono />
        {r.integrity.lastVerification && (
          <Row label="Last Verified" value={fmtDate(r.integrity.lastVerification.at)} />
        )}
      </Section>

      {/* ── 4. Discovery Intelligence ─────────────────────────────────────── */}
      <Section icon={Wifi} title="Discovery Intelligence" accent="bg-orange-500/20 text-orange-400">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Exact Matches',    value: r.discovery.exactMatches,    color: r.discovery.exactMatches > 0    ? 'text-red-400'    : 'text-gray-400' },
            { label: 'High Matches',     value: r.discovery.highMatches,     color: r.discovery.highMatches > 0     ? 'text-orange-400' : 'text-gray-400' },
            { label: 'Possible Matches', value: r.discovery.possibleMatches, color: r.discovery.possibleMatches > 0 ? 'text-yellow-400' : 'text-gray-400' },
            { label: 'Total Runs',       value: r.discovery.totalRuns,       color: 'text-gray-300' },
          ].map(s => (
            <div key={s.label} className="bg-bg-elevated rounded-lg p-3 text-center">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-2xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
        <Row label="Monitoring Status" value={
          r.discovery.monitoringActive
            ? <span className="text-emerald-400 font-semibold">Active ({r.discovery.scanType})</span>
            : <span className="text-gray-500">Not Active</span>
        } />
        <Row label="OCR Indexed"   value={r.discovery.ocrIndexed ? 'Yes' : 'No'} accent={r.discovery.ocrIndexed ? 'text-emerald-400' : 'text-gray-500'} />
        <Row label="OCR Words"     value={r.discovery.ocrWordCount > 0 ? `${r.discovery.ocrWordCount} words (${r.discovery.ocrLanguage ?? 'unknown'})` : '—'} />
        {r.discovery.recentMatches.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-2xs text-gray-500 uppercase tracking-wide font-semibold">Recent Online Matches</p>
            {r.discovery.recentMatches.map((m, i) => (
              <div key={i} className="flex items-start gap-3 bg-bg-elevated rounded-lg px-3 py-2">
                <span className={`text-xs font-semibold shrink-0 ${MATCH_COLOR[m.matchType] ?? 'text-gray-400'}`}>
                  {m.matchType.replace('_', ' ')}
                </span>
                <a href={m.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-dna-400 truncate flex-1 hover:underline">
                  {m.url.length > 60 ? m.url.slice(0, 60) + '…' : m.url}
                </a>
                <span className="text-2xs text-gray-500 shrink-0">{Math.round(m.similarity * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 5. Distribution Intelligence ──────────────────────────────────── */}
      <Section icon={Globe} title="Distribution Intelligence" accent="bg-purple-500/20 text-purple-400">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Share Links',   value: r.distribution.totalShareLinks, sub: `${r.distribution.activeLinks} active` },
            { label: 'Total Views',   value: r.distribution.totalViews,      sub: 'all time' },
            { label: 'Total Events',  value: r.distribution.totalEvents,     sub: 'tracked' },
            { label: 'Countries',     value: r.distribution.uniqueCountries.length || '—', sub: 'reached' },
          ].map(s => (
            <div key={s.label} className="bg-bg-elevated rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-dna-400">{s.value}</p>
              <p className="text-2xs text-gray-500">{s.label}</p>
              <p className="text-2xs text-gray-600">{s.sub}</p>
            </div>
          ))}
        </div>
        {r.distribution.uniqueCountries.length > 0 && (
          <Row label="Countries" value={
            <div className="flex flex-wrap gap-1 justify-end">
              {r.distribution.uniqueCountries.map(c => (
                <span key={c} className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-0.5">{c}</span>
              ))}
            </div>
          } />
        )}
        {r.distribution.uniqueDevices.length > 0 && (
          <Row label="Device Types" value={
            <div className="flex flex-wrap gap-1 justify-end">
              {r.distribution.uniqueDevices.map(d => (
                <span key={d} className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-0.5 capitalize">{d}</span>
              ))}
            </div>
          } />
        )}
        {r.distribution.uniqueBrowsers.length > 0 && (
          <Row label="Browsers" value={
            <div className="flex flex-wrap gap-1 justify-end">
              {r.distribution.uniqueBrowsers.map(b => (
                <span key={b} className="text-2xs bg-bg-elevated border border-bg-border rounded px-2 py-0.5">{b}</span>
              ))}
            </div>
          } />
        )}
        {r.distribution.recipients.length > 0 && (
          <Row label="Recipients" value={r.distribution.recipients.join(', ')} />
        )}
        {r.distribution.timeline.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-2xs text-gray-500 uppercase tracking-wide font-semibold">Access Timeline</p>
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {r.distribution.timeline.map((ev, i) => (
                <div key={i} className="flex items-center gap-3 bg-bg-elevated rounded px-3 py-1.5">
                  <span className={`text-2xs font-mono shrink-0 ${ev.riskLevel === 'HIGH' || ev.riskLevel === 'CRITICAL' ? 'text-red-400' : 'text-gray-400'}`}>
                    {new Date(ev.at).toLocaleDateString()} {new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-gray-200 flex-1">{ev.action.replace(/_/g, ' ')}</span>
                  {ev.country && <span className="text-2xs text-gray-500 shrink-0">{ev.country}</span>}
                  {ev.device  && <span className="text-2xs text-gray-600 shrink-0">{ev.device}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── 6. Risk Intelligence ──────────────────────────────────────────── */}
      <Section icon={Activity} title="Risk Intelligence" accent="bg-red-500/20 text-red-400">
        {/* Risk score bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Risk Score</span>
            <span className={`text-sm font-bold ${RISK_COLOR[r.risk.riskLevel]?.split(' ')[0] ?? 'text-gray-400'}`}>
              {r.risk.riskScore}/100 — {r.risk.riskLevel}
            </span>
          </div>
          <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                r.risk.riskScore >= 75 ? 'bg-red-500'
                : r.risk.riskScore >= 50 ? 'bg-orange-500'
                : r.risk.riskScore >= 25 ? 'bg-yellow-500'
                : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.max(r.risk.riskScore, 2)}%` }}
            />
          </div>
        </div>
        <Row label="Evidence Records"   value={`${r.risk.evidenceCount}`} />
        <Row label="Suspicious Events"  value={`${r.risk.suspiciousEvents}`} accent={r.risk.suspiciousEvents > 0 ? 'text-orange-400' : 'text-gray-400'} />
        {r.risk.leakIndicators.length > 0 ? (
          <div className="mt-3 space-y-1">
            <p className="text-2xs text-gray-500 uppercase tracking-wide font-semibold">Leak Indicators</p>
            {r.risk.leakIndicators.map((ind, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-orange-200/80">
                <AlertTriangle size={11} className="text-orange-400 shrink-0" />
                {ind}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 size={14} />
            No leak indicators detected
          </div>
        )}
        {r.risk.recentEvidence.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-2xs text-gray-500 uppercase tracking-wide font-semibold">Recent Evidence</p>
            {r.risk.recentEvidence.map((ev, i) => (
              <div key={i} className="bg-bg-elevated rounded-lg px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-dna-400 font-mono">{ev.code}</span>
                  <span className="text-2xs text-gray-500">{ev.type.replace(/_/g, ' ')}</span>
                  <span className="ml-auto text-2xs text-gray-600">{new Date(ev.at).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-gray-300">{ev.description}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="text-center py-4 space-y-1">
        <p className="text-2xs text-gray-600">Report generated at {fmtDate(r.generatedAt)}</p>
        <p className="text-2xs text-gray-700">PINIT-DNA Universal File DNA Engine — Vault ID: {r.vaultId}</p>
      </div>
    </div>
  );
}
