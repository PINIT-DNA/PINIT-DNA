/**
 * PinIT Sentinel — Forensic Investigation Report UI
 * Matches enterprise DMCA/Sentinel document layout; data from view model only.
 */
import {
  Shield, Download, Clock, FileDown, RefreshCw, CheckCircle2,
  AlertTriangle, Fingerprint, Dna, Package, QrCode,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from './ui/utils';
import { buildEnterpriseInvestigationViewModel } from '../lib/enterprise-investigation-report-model';
import {
  downloadInvestigationReportPdf,
  downloadDnaReportPdf,
  downloadTimelineReportPdf,
  downloadEvidencePackageZip,
  downloadAdvancedExportJson,
  type InvestigationReportExport,
} from '../services/investigation-report-export';
import { InvestigationSideBySideCompare } from './InvestigationSideBySideCompare';

interface Props {
  report: Record<string, unknown>;
  probePreviewUrl?: string | null;
  probeFileName?: string;
  probeMimeType?: string;
  onReset: () => void;
}

function shortId(id: string, len = 8): string {
  if (!id || id === '—') return '—';
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function KpiCard({
  label, value, icon: Icon, tone,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: 'green' | 'red' | 'blue' | 'amber';
}) {
  const tones = {
    green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    red: 'border-red-500/40 bg-red-500/10 text-red-300',
    blue: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  };
  return (
    <div className={cn('rounded-xl border p-4 flex flex-col gap-2 min-h-[88px]', tones[tone])}>
      <div className="flex items-center gap-2 text-2xs uppercase tracking-wider opacity-80">
        <Icon size={14} />
        {label}
      </div>
      <p className="text-lg font-bold text-white leading-tight">{value}</p>
    </div>
  );
}

function EvidenceCard({
  title, subtitle, status, confidence, matched, unavailable,
}: {
  title: string;
  subtitle: string;
  status: string;
  confidence: number | null;
  matched: boolean;
  unavailable: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 flex flex-col gap-2 min-h-[140px]',
      unavailable
        ? 'border-slate-600/50 bg-slate-800/40'
        : matched
          ? 'border-emerald-500/35 bg-emerald-500/5'
          : 'border-amber-500/35 bg-amber-500/5',
    )}>
      <p className="text-xs font-bold text-white">{title}</p>
      <p className="text-2xs text-slate-400">{subtitle}</p>
      <div className="mt-auto space-y-1">
        <p className={cn(
          'text-sm font-bold',
          unavailable ? 'text-slate-500' : matched ? 'text-emerald-400' : 'text-amber-400',
        )}>
          {unavailable ? 'Unavailable' : status}
        </p>
        {confidence != null && !unavailable && (
          <p className="text-2xs text-slate-400">Confidence: {Math.round(confidence)}%</p>
        )}
      </div>
    </div>
  );
}

function DocSection({
  num, title, children, className,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-slate-700/60 bg-slate-900/60 overflow-hidden', className)}>
      <div className="px-5 py-3 border-b border-slate-700/60 bg-slate-800/80 flex items-center gap-2">
        <span className="text-2xs font-bold text-sky-400 mono">{num}</span>
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EnterpriseInvestigationReport({
  report,
  probePreviewUrl,
  probeFileName,
  probeMimeType,
  onReset,
}: Props) {
  const vm = useMemo(() => buildEnterpriseInvestigationViewModel(report), [report]);
  const [exporting, setExporting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'investigation' | 'dna' | 'timeline' | null>(null);
  const exportPayload = report as unknown as InvestigationReportExport;

  const vaultId = vm.originalAsset.vaultId.availability === 'available'
    ? String(vm.originalAsset.vaultId.value)
    : undefined;

  const riskTone = vm.summary.riskLevel === 'HIGH' || vm.summary.riskLevel === 'CRITICAL'
    ? 'red' as const
    : vm.summary.riskLevel === 'MEDIUM'
      ? 'amber' as const
      : 'green' as const;

  const strengthTone = vm.evidenceStrength === 'Strong'
    ? 'green' as const
    : vm.evidenceStrength === 'Medium'
      ? 'amber' as const
      : 'blue' as const;

  return (
    <div className="sentinel-report -mx-2 sm:mx-0">
      {/* Document shell — Sentinel dark document */}
      <div className="rounded-2xl border border-slate-700/80 bg-[#0c1222] shadow-2xl overflow-hidden">
        {/* Header banner */}
        <header className="relative bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#0a1628] px-5 sm:px-8 py-6 border-b border-sky-900/50">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center">
                <Shield size={24} className="text-sky-300" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-[0.2em] text-sky-300/90">PinIT SENTINEL</p>
                <h1 className="text-xl sm:text-2xl font-bold text-white mt-0.5">
                  Forensic Investigation Report
                </h1>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={cn(
                'text-2xs font-bold px-3 py-1 rounded-full border uppercase tracking-wide',
                vm.submissionReady
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'bg-amber-500/20 border-amber-400/50 text-amber-300',
              )}>
                {vm.submissionReady ? 'Ready for Submission' : 'Review Required'}
              </span>
              <p className="text-2xs text-slate-400 mono">Report ID: {vm.summary.investigationId.slice(0, 8)}…</p>
              <p className="text-2xs text-slate-500">
                Generated: {new Date(vm.summary.investigatedAt).toLocaleString()}
              </p>
            </div>
          </div>
        </header>

        <div className="p-5 sm:p-8 space-y-6">
          {/* KPI row — like mockup */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Report Status" value={vm.summary.status} icon={FileDown} tone="green" />
            <KpiCard label="Risk Level" value={vm.summary.riskLevel} icon={AlertTriangle} tone={riskTone} />
            <KpiCard label="Overall Trust Score" value={`${vm.trustScore}%`} icon={Shield} tone="blue" />
            <KpiCard label="Evidence Strength" value={vm.evidenceStrength} icon={Fingerprint} tone={strengthTone} />
          </div>

          {/* Verdict strip */}
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-2xs text-sky-400 uppercase tracking-wider">Final Verdict</p>
              <p className="text-lg font-bold text-white">{vm.summary.finalVerdict}</p>
            </div>
            <div className="text-right">
              <p className="text-2xs text-slate-500">{vm.summary.confidenceLabel}</p>
              <p className="text-2xl font-bold text-sky-300 mono">{vm.summary.confidence}%</p>
            </div>
          </div>

          {(vm.summary.decisionReason || vm.summary.message) && (
            <p className="text-sm text-slate-400 border-l-2 border-amber-500/50 pl-3">
              {vm.summary.decisionReason ?? vm.summary.message}
            </p>
          )}

          {/* 1 & 2 Original + Suspect */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DocSection num="01" title="Original Asset (Vault)">
              <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                  'text-2xs font-bold px-2 py-0.5 rounded-full border',
                  vm.originalAsset.ownershipVerified
                    ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                    : 'border-amber-500/50 text-amber-400 bg-amber-500/10',
                )}>
                  {vm.originalAsset.ownershipVerified ? 'VERIFIED' : 'CANDIDATE'}
                </span>
              </div>
              <dl className="space-y-2 text-xs">
                {[
                  ['Asset Title', String(vm.originalAsset.originalFilename.value)],
                  ['Vault ID', shortId(String(vm.originalAsset.vaultId.value), 16)],
                  ['PinIT DNA ID', shortId(String(vm.originalAsset.dnaId.value), 16)],
                  ['Certificate ID', shortId(String(vm.originalAsset.certificateId.value), 20)],
                  ['Certificate Status', vm.originalAsset.certificateStatus],
                  ['Owner', String(vm.originalAsset.ownerName.value)],
                  ['PINIT ID', String(vm.originalAsset.ownerPinitId.value)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 py-1 border-b border-slate-800/80">
                    <dt className="text-slate-500 shrink-0">{k}</dt>
                    <dd className="text-white mono text-right truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            </DocSection>

            <DocSection num="02" title="Suspect Asset (Probe)">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xs font-bold px-2 py-0.5 rounded-full border border-orange-500/50 text-orange-300 bg-orange-500/10">
                  UNDER INVESTIGATION
                </span>
              </div>
              <dl className="space-y-2 text-xs">
                {[
                  ['Uploaded File', probeFileName ?? String(vm.suspectAsset.filename.value)],
                  ['MIME Type', probeMimeType ?? String(vm.suspectAsset.mimeType.value)],
                  ['SHA-256', shortId(String(vm.suspectAsset.sha256.value), 24)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 py-1 border-b border-slate-800/80">
                    <dt className="text-slate-500 shrink-0">{k}</dt>
                    <dd className="text-white mono text-right truncate max-w-[60%]">{v}</dd>
                  </div>
                ))}
              </dl>
              {vm.tamper.overallScore > 0 && (
                <p className="text-2xs text-orange-400 mt-3">
                  Tamper score: {vm.tamper.overallScore}% · {vm.tamper.primaryVector.replace(/_/g, ' ')}
                </p>
              )}
            </DocSection>
          </div>

          {/* 3 Evidence Analysis — 5 cards */}
          <DocSection num="03" title="Evidence Analysis">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {vm.evidenceCards.map((c) => (
                <EvidenceCard
                  key={c.id}
                  title={c.title}
                  subtitle={c.subtitle}
                  status={c.statusLabel}
                  confidence={c.confidence}
                  matched={c.matched}
                  unavailable={c.availability === 'unavailable'}
                />
              ))}
            </div>
          </DocSection>

          {/* 4 Side-by-side */}
          {vaultId && (
            <DocSection num="04" title="Side-by-Side Comparison">
              <InvestigationSideBySideCompare
                vaultId={vaultId}
                probePreviewUrl={probePreviewUrl}
                probeFileName={probeFileName ?? String(vm.suspectAsset.filename.value)}
                probeMimeType={probeMimeType}
                originalFilename={
                  vm.originalAsset.originalFilename.availability === 'available'
                    ? String(vm.originalAsset.originalFilename.value)
                    : undefined
                }
                ownerPinitId={
                  vm.originalAsset.ownerPinitId.availability === 'available'
                    ? String(vm.originalAsset.ownerPinitId.value)
                    : null
                }
                dnaMatchPercent={
                  typeof (report.summary as { dnaMatchPercent?: number })?.dnaMatchPercent === 'number'
                    ? (report.summary as { dnaMatchPercent: number }).dnaMatchPercent
                    : undefined
                }
                matchConfidence={vm.summary.confidence}
                reportState={(report.summary as { reportState?: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE' })?.reportState}
                dnaRecordId={
                  vm.originalAsset.dnaId.availability === 'available'
                    ? String(vm.originalAsset.dnaId.value)
                    : undefined
                }
                certificateId={
                  vm.originalAsset.certificateIssued
                    ? String(vm.originalAsset.certificateId.value)
                    : (vm.originalAsset.certificateId.availability === 'available'
                      ? String(vm.originalAsset.certificateId.value)
                      : null)
                }
              />
            </DocSection>
          )}

          {/* 5 DNA / Provenance */}
          <DocSection num="05" title="DNA Provenance & Integrity">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-2xs text-slate-500 uppercase">15-Layer DNA</p>
                {vm.layersAvailability === 'available' ? (
                  <p className="text-sm text-white">
                    {vm.layers.length} layers compared · overall {vm.summary.confidence}%
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">{vm.layersNote}</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-2xs text-slate-500 uppercase">C2PA Content Credentials</p>
                <p className="text-sm text-slate-500">Not available — PinIT DNA certificate used when present</p>
              </div>
            </div>
            {vm.layersAvailability === 'available' && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {vm.layers.map((l) => (
                  <div key={l.layer} className="flex items-center gap-2 text-2xs py-1 px-2 rounded bg-slate-800/60">
                    <span className="text-slate-500 mono w-6">L{l.layer}</span>
                    <span className="text-white flex-1 truncate">{l.name}</span>
                    <span className="text-sky-300 mono">{l.score}%</span>
                  </div>
                ))}
              </div>
            )}
          </DocSection>

          {/* 6 Chain of custody — horizontal */}
          <DocSection num="06" title="Chain of Custody Timeline">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {vm.custodySteps.map((step, i) => (
                <div key={`${step.label}-${i}`} className="shrink-0 min-w-[120px] max-w-[160px]">
                  <div className="flex items-center gap-1 mb-2">
                    <div className="w-6 h-6 rounded-full bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-2xs font-bold text-sky-300">
                      {i + 1}
                    </div>
                    {i < vm.custodySteps.length - 1 && (
                      <div className="h-px flex-1 bg-slate-600 min-w-[20px]" />
                    )}
                  </div>
                  <p className="text-2xs font-semibold text-white leading-tight">{step.label}</p>
                  {step.date && (
                    <p className="text-2xs text-slate-500 mono mt-0.5">
                      {new Date(step.date).toLocaleDateString()}
                    </p>
                  )}
                  {step.detail && <p className="text-2xs text-slate-600 mt-0.5 truncate">{step.detail}</p>}
                </div>
              ))}
            </div>
          </DocSection>

          {/* 7 Legal */}
          <DocSection num="07" title="Investigation Declaration">
            <p className="text-xs text-slate-400 leading-relaxed">
              This forensic investigation report was generated by the PinIT Sentinel Enterprise Investigation Engine.
              Findings are based solely on deterministic DNA comparison, vault retrieval, watermark recovery,
              and acceptance policy {String(vm.acceptance.policyVersion.value)}.
              {vm.originalAsset.ownershipVerified
                ? ' Ownership has been verified under acceptance rules.'
                : ' Ownership has not been verified — manual review is required before legal action.'}
            </p>
            <p className="text-2xs text-slate-600 mt-3 mono">
              Verdict: {String(vm.acceptance.verdict.value).replace(/_/g, ' ')} ·
              {' '}{String(vm.acceptance.reason.value)}
            </p>
          </DocSection>

          {/* 8 Actions */}
          <DocSection num="08" title="Recommended Actions">
            <ul className="space-y-2">
              {vm.recommendedActions.map((a) => (
                <li key={a} className="flex items-start gap-2 text-xs text-slate-300">
                  <CheckCircle2 size={14} className="text-sky-400 shrink-0 mt-0.5" />
                  {a}
                </li>
              ))}
            </ul>
          </DocSection>

  {/* 9 Package + exports */}
          <DocSection num="09" title="Output Package">
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={!!pdfBusy || exporting}
                onClick={async () => {
                  setPdfBusy('investigation');
                  try {
                    await downloadInvestigationReportPdf(exportPayload);
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              >
                {pdfBusy === 'investigation'
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Download size={12} />}
                {pdfBusy === 'investigation' ? ' Building PDF…' : ' Investigation Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={!!pdfBusy || exporting}
                onClick={async () => {
                  setPdfBusy('dna');
                  try {
                    await downloadDnaReportPdf(exportPayload);
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              >
                {pdfBusy === 'dna'
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Dna size={12} />}
                {pdfBusy === 'dna' ? ' Building PDF…' : ' DNA Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={!!pdfBusy || exporting}
                onClick={async () => {
                  setPdfBusy('timeline');
                  try {
                    await downloadTimelineReportPdf(exportPayload);
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              >
                {pdfBusy === 'timeline'
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Clock size={12} />}
                {pdfBusy === 'timeline' ? ' Building PDF…' : ' Timeline Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={exporting || !!pdfBusy}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await downloadEvidencePackageZip(exportPayload);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Package size={12} />}
                {exporting ? ' Building ZIP…' : ' Evidence Package (ZIP)'}
              </button>
              <button type="button" className="btn btn-ghost text-xs border border-slate-600" disabled={!!pdfBusy || exporting} onClick={() => { void downloadAdvancedExportJson(exportPayload); }}>
                <FileDown size={12} /> JSON Export
              </button>
            </div>
            {(pdfBusy || exporting) && (
              <p className="text-2xs text-sky-400 mb-3">
                {pdfBusy
                  ? 'Generating PDF… download starts when ready.'
                  : 'Building evidence ZIP…'}
              </p>
            )}
            <ul className="text-2xs text-slate-500 space-y-1">
              <li>• Investigation Report PDF (Sentinel layout)</li>
              <li>• 15-Layer DNA Forensic Report PDF</li>
              <li>• Timeline &amp; chain-of-custody PDF</li>
              <li>• Evidence ZIP with JSON artifacts + signed manifest</li>
            </ul>
          </DocSection>
        </div>

        {/* Footer */}
        <footer className="border-t border-slate-700/60 bg-slate-900/80 px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-2xs text-slate-500">
            <QrCode size={14} className="text-sky-500" />
            <span>Scan signed PDF QR to verify report authenticity</span>
          </div>
          <p className="text-2xs text-slate-600">
            PinIT Sentinel · Protecting Digital Rights · {new Date().getFullYear()}
          </p>
          <button type="button" onClick={onReset} className="btn btn-secondary text-xs">
            <RefreshCw size={12} /> New Investigation
          </button>
        </footer>
      </div>
    </div>
  );
}
