/**
 * Unified Investigation — professional PDF & ZIP evidence exports
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { previewVaultFile, signReportManifest, type SignedReportManifest } from './dashboard.api';
import { buildEnterpriseInvestigationViewModel } from '../lib/enterprise-investigation-report-model';
import {
  forensicExportBaseName,
  forensicReportFilename,
  investigatedAssetName,
} from '../lib/forensic-report-filename';
import {
  drawEvidenceVerification,
  drawInvestigationEvidencePdf,
} from './investigation-evidence-pdf';
import { BRAND } from '../config/brand.config';
import {
  saveForensicPdfArtifact,
  type ForensicPdfKind,
} from '../lib/forensic-pdf-artifacts';
import { attachForensicPdfArtifactMeta } from '../lib/forensic-reports-storage';

// ─── Report shape (matches API) ───────────────────────────────────────────────

export interface InvestigationReportExport {
  success: boolean;
  investigationId: string;
  investigatedAt: string;
  pipeline: Array<{ id: string; label: string; status: string; detail?: string }>;
  summary: {
    ownershipConfidence: number;
    dnaMatchPercent: number;
    certificateStatus: string;
    identityStatus: string;
    tamperSeverity: string;
    riskLevel: string;
    retrievalConfidence?: number;
    reportState?: string;
    acceptanceVerdict?: string;
    acceptanceConfidence?: number;
    acceptancePolicyVersion?: string;
    decisionReason?: string;
  };
  owner: Record<string, string | null | undefined>;
  recipientAttribution: Record<string, unknown>;
  layerAnalysis: Array<{
    layer: number;
    name: string;
    matchPercent: number;
    status: string;
    explanation: string;
  }>;
  tamperAnalysis: {
    primaryVector: string;
    overallTamperScore: number;
    vectors: Array<{ label: string; detected: boolean }>;
    description?: string;
    changesVsOriginal?: Array<{ type: string; detected: boolean; confidence: number; detail: string }>;
  };
  timeline: Array<{ stage: string; timestamp?: string; detail?: string }>;
  accessIntelligence: Array<Record<string, string | undefined>>;
  leakIntelligence: { hasPublicLeak: boolean; message: string };
  identityProof: {
    vaultId?: string;
    dnaRecordId?: string;
    certificateId?: string;
    ownerPinitId?: string;
    digitalSignatureValid: boolean;
    identityVerification: string;
    watermark: {
      status: 'DETECTED' | 'DAMAGED' | 'NOT_EMBEDDED';
      reason?: string;
      code?: string;
      vaultId?: string;
      ownerPinitId?: string;
      confidence?: number;
      extractionMethod?: string;
    };
  };
  dnaComparison?: {
    layerComparisons?: Array<{
      layer: number;
      name: string;
      implementation: string;
      similarityPercent: number;
      matched: boolean;
      changed: boolean;
      fingerprintA: string;
      fingerprintB: string;
      changeDescription: string;
    }>;
    classification?: string;
    overallConfidenceScore?: number;
    fileA?: { filename: string; mimeType: string; sizeBytes: number };
    fileB?: { filename: string; mimeType: string; sizeBytes: number };
  } | null;
  message?: string;
  currentFileHash?: string;
  candidateRanking?: Array<{
    rank: number;
    vaultId: string;
    dnaRecordId: string;
    compositeScore: number;
    method: string;
    signals: string[];
    selected?: boolean;
  }>;
  forensicEvidence?: {
    matchReasons?: Array<{ signal: string; label: string; percent: number; matched: boolean }>;
    aiEdited?: boolean;
    aiEditConfidence?: number;
    aiEditReason?: string;
  };
  identityRecovery?: {
    signals: Array<{ label: string; score: number; status: string; detail?: string }>;
  };
  identityRecoveryReport?: {
    vaultId?: string;
    originalHash?: string;
    currentHash?: string;
    originalFilename?: string;
    tepCode?: string | null;
  };
  pipelineAudit?: {
    vaultRecordsLoaded?: number;
    candidateRanking?: Array<{ rank?: number; vaultId: string; dnaRecordId: string; selected?: boolean; scores?: { composite?: number } }>;
  };
  progressTimeline?: Array<{ label?: string; stepId?: string; status: string; detail?: string }>;
  evidenceTimeline?: Array<{ eventType?: string; summary?: string; timestamp?: string }>;
}

const MARGIN = 14;
const W = 210;

function sectionHeader(doc: jsPDF, title: string, y: number): number {
  doc.setFillColor(240, 242, 248);
  doc.rect(MARGIN, y - 1, W - MARGIN * 2, 7, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(title, MARGIN + 2, y + 4);
  return y + 10;
}

function coverHeader(doc: jsPDF, title: string, investigationId: string, submissionReady?: boolean) {
  doc.setFillColor(10, 22, 40);
  doc.rect(0, 0, W, 48, 'F');
  doc.setTextColor(125, 211, 252);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Pinit SENTINEL', MARGIN, 12);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(title, MARGIN, 22);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 200, 220);
  doc.text(
    'Comprehensive forensic evidence report for ownership verification and tamper analysis.',
    MARGIN,
    29,
    { maxWidth: W - MARGIN * 2 - 58 },
  );
  doc.setTextColor(200, 210, 220);
  doc.setFontSize(8);
  doc.text(`Report ID: ${investigationId}`, MARGIN, 38);
  doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, 43);
  if (submissionReady != null) {
    doc.setFillColor(submissionReady ? 16 : 180, submissionReady ? 120 : 120, submissionReady ? 80 : 40);
    doc.roundedRect(W - MARGIN - 58, 10, 58, 10, 2, 2, 'F');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text(submissionReady ? 'READY FOR SUBMISSION' : 'REVIEW REQUIRED', W - MARGIN - 55, 16.5);
    doc.setFont('helvetica', 'normal');
  }
  doc.setTextColor(30, 30, 30);
  return 56;
}

function footer(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Pinit Sentinel · Forensic Investigation · Page ${i}/${pages}`,
      W / 2,
      292,
      { align: 'center' },
    );
  }
}

function table(doc: jsPDF, startY: number, body: string[][]): number {
  autoTable(doc, {
    startY,
    head: [],
    body,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 55, fillColor: [240, 242, 248] },
      1: { cellWidth: 115 },
    },
    theme: 'plain',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY + 8;
}

async function finalizeSignedPdf(
  doc: jsPDF,
  report: InvestigationReportExport,
  reportType: 'INVESTIGATION' | 'DNA' | 'TIMELINE' | 'EVIDENCE_PACKAGE',
): Promise<Blob> {
  footer(doc);
  let blob = pdfBlobOut(doc);
  const manifest = await signPdfBlob(blob, report, reportType);
  if (manifest) {
    const qr = await QRCode.toDataURL(manifest.verifyUrl, { margin: 1, width: 180 });
    applySignedFooter(doc, manifest, qr);
    footer(doc);
    blob = pdfBlobOut(doc);
  }
  return blob;
}

function pdfBlobOut(doc: jsPDF): Blob {
  return doc.output('blob');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Must be in the DOM for Safari/Chromium to reliably start the download.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download for larger PDFs (embedded images).
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Persist a generated export into Forensic Reports (IndexedDB + metadata). */
async function persistForensicExport(
  investigationId: string,
  kind: ForensicPdfKind,
  blob: Blob,
  filename: string,
): Promise<void> {
  try {
    const meta = await saveForensicPdfArtifact(investigationId, kind, blob, filename);
    attachForensicPdfArtifactMeta(investigationId, meta);
  } catch {
    // Storage failures must not block the user download.
  }
}

async function sha256HexBuffer(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signPdfBlob(
  blob: Blob,
  report: InvestigationReportExport,
  reportType: 'INVESTIGATION' | 'DNA' | 'TIMELINE' | 'EVIDENCE_PACKAGE',
): Promise<SignedReportManifest | null> {
  const hash = await sha256HexBuffer(await blob.arrayBuffer());
  return signReportManifest({
    investigationId: report.investigationId,
    reportType,
    reportHash: hash,
    certificateStatus: report.summary.certificateStatus,
  });
}

function applySignedFooter(doc: jsPDF, manifest: SignedReportManifest, qrDataUrl?: string) {
  const pages = doc.getNumberOfPages();
  doc.setPage(pages);
  doc.setFontSize(7);
  doc.setTextColor(100);
  doc.text(`Report ID: ${manifest.reportId}`, MARGIN, 278);
  doc.text(`Hash: ${manifest.reportHash.slice(0, 32)}…`, MARGIN, 283);
  doc.text(`Signed: ${new Date(manifest.issuedAt).toLocaleString()}`, MARGIN, 288);
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', W - MARGIN - 22, 268, 22, 22);
  }
  doc.text('Scan QR to verify authenticity', W - MARGIN - 22, 292, { align: 'center', maxWidth: 30 });
}

export interface InvestigationReportPdfOptions {
  probeFile?: File | Blob | null;
  vaultId?: string | null;
}

type PdfImageAsset = {
  dataUrl: string;
  format: 'JPEG' | 'PNG';
  width: number;
  height: number;
};

let cachedPinithubLogo: PdfImageAsset | null = null;

const PDF_IMAGE_MAX_EDGE = 1024;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Decode + downscale so PDF embed stays fast (full vault originals can be multi‑MB). */
async function blobToPdfImage(blob: Blob): Promise<PdfImageAsset> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, PDF_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mime = (blob.type || '').toLowerCase();
  const preferPng = mime.includes('png') && scale === 1;
  const dataUrl = preferPng
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.82);
  return {
    dataUrl,
    format: preferPng ? 'PNG' : 'JPEG',
    width,
    height,
  };
}

async function loadPinithubLogo(): Promise<PdfImageAsset | null> {
  if (cachedPinithubLogo) return cachedPinithubLogo;
  try {
    const res = await fetch('/pinithub-logo.png');
    if (!res.ok) return null;
    cachedPinithubLogo = await blobToPdfImage(await res.blob());
    return cachedPinithubLogo;
  } catch {
    return null;
  }
}

function isImageMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith('image/');
}

function isVideoMime(mime?: string | null, filename?: string | null): boolean {
  if (mime && mime.startsWith('video/')) return true;
  const name = (filename ?? '').toLowerCase();
  return /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(name);
}

async function blobToVideoPoster(blob: Blob): Promise<PdfImageAsset> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = url;

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Video decode failed'));
      }),
      10_000,
      'Video load',
    );

    const seekTo = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(1, video.duration * 0.08)
      : 0.1;
    if (seekTo > 0) {
      try {
        video.currentTime = seekTo;
        await withTimeout(
          new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
          }),
          4_000,
          'Video seek',
        );
      } catch {
        /* use first decoded frame */
      }
    }

    const scale = Math.min(1, PDF_IMAGE_MAX_EDGE / Math.max(video.videoWidth || 640, video.videoHeight || 360));
    const width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
    const height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#0c141e';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);
    // Subtle film badge so video posters read clearly in print.
    ctx.fillStyle = 'rgba(4,16,27,0.72)';
    ctx.fillRect(8, height - 28, 86, 20);
    ctx.fillStyle = '#31d6c4';
    ctx.font = 'bold 12px Helvetica, Arial, sans-serif';
    ctx.fillText('VIDEO FRAME', 14, height - 14);

    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.84),
      format: 'JPEG',
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function mediaBlobToPdfImage(
  blob: Blob,
  hint?: { mimeType?: string | null; filename?: string | null },
): Promise<PdfImageAsset> {
  const mime = (hint?.mimeType || blob.type || '').toLowerCase();
  if (isVideoMime(mime, hint?.filename)) {
    return blobToVideoPoster(blob);
  }
  if (isImageMime(mime) || mime === '' || mime === 'application/octet-stream') {
    try {
      return await blobToPdfImage(blob);
    } catch {
      if (isVideoMime(mime, hint?.filename) || /\.mp4$/i.test(hint?.filename ?? '')) {
        return blobToVideoPoster(blob);
      }
      throw new Error('Preview decode failed');
    }
  }
  if (isVideoMime(mime, hint?.filename)) {
    return blobToVideoPoster(blob);
  }
  throw new Error(`Unsupported preview type: ${mime || 'unknown'}`);
}

async function loadReportComparisonImages(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<{ original?: PdfImageAsset; probe?: PdfImageAsset }> {
  const vaultId = options?.vaultId
    ?? report.identityProof.vaultId
    ?? report.owner.vaultId
    ?? report.identityRecoveryReport?.vaultId
    ?? null;

  let original: PdfImageAsset | undefined;
  let probe: PdfImageAsset | undefined;

  const originalName = report.owner.originalFilename
    ?? report.identityRecoveryReport?.originalFilename
    ?? null;
  const probeFileName = options?.probeFile instanceof File ? options.probeFile.name : null;
  const probeName = report.dnaComparison?.fileB?.filename ?? probeFileName;
  const probeMime = report.dnaComparison?.fileB?.mimeType
    ?? (options?.probeFile instanceof File ? options.probeFile.type : null)
    ?? null;

  if (vaultId) {
    try {
      const preview = await withTimeout(previewVaultFile(vaultId), 12_000, 'Vault preview');
      original = await mediaBlobToPdfImage(preview, {
        mimeType: preview.type,
        filename: originalName,
      });
    } catch {
      original = undefined;
    }
  }

  if (options?.probeFile) {
    try {
      probe = await mediaBlobToPdfImage(options.probeFile, {
        mimeType: options.probeFile instanceof File ? options.probeFile.type : probeMime,
        filename: options.probeFile instanceof File ? options.probeFile.name : probeName,
      });
    } catch {
      probe = undefined;
    }
  }

  return { original, probe };
}

export { forensicExportBaseName, forensicReportFilename };

export async function buildInvestigationReportPdf(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<Blob> {
  const vm = buildEnterpriseInvestigationViewModel(report);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const [pinithubLogo, comparisonImages] = await Promise.all([
    loadPinithubLogo(),
    loadReportComparisonImages(report, options),
  ]);

  const slot = drawInvestigationEvidencePdf(doc, {
    vm,
    assetName: investigatedAssetName(report),
    recovery: report.identityRecoveryReport,
    pinithubLogo,
    comparisonImages,
    leakMessage: report.leakIntelligence?.message ?? null,
    currentFileHash: report.currentFileHash ?? null,
  });

  const manifest = await signPdfBlob(pdfBlobOut(doc), report, 'INVESTIGATION');
  let qr: string | undefined;
  if (manifest) {
    qr = await QRCode.toDataURL(manifest.verifyUrl, {
      margin: 1,
      width: 256,
      color: { dark: '#0b1220', light: '#fffef8' },
    });
  }
  drawEvidenceVerification(doc, slot, manifest, qr);
  return pdfBlobOut(doc);
}

export async function downloadInvestigationReportPdf(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<void> {
  const blob = await buildInvestigationReportPdf(report, options);
  const filename = forensicReportFilename(report);
  await persistForensicExport(report.investigationId, 'investigation', blob, filename);
  downloadBlob(blob, filename);
}

// ─── DNA Report PDF ───────────────────────────────────────────────────────────

export async function buildDnaReportPdf(report: InvestigationReportExport): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = coverHeader(doc, '15-Layer DNA Forensic Report', report.investigationId);

  const layers = report.dnaComparison?.layerComparisons?.length
    ? report.dnaComparison.layerComparisons
    : report.layerAnalysis.map((l) => ({
        layer: l.layer,
        name: l.name,
        implementation: '—',
        similarityPercent: l.matchPercent,
        matched: l.status === 'verified',
        changed: l.status !== 'verified',
        fingerprintA: '—',
        fingerprintB: '—',
        changeDescription: l.explanation,
      }));

  y = sectionHeader(doc, 'DNA COMPARISON OVERVIEW', y);
  y = table(doc, y, [
    ['Classification', report.dnaComparison?.classification ?? '—'],
    ['Overall Confidence', `${report.summary.dnaMatchPercent}%`],
    ['Original Asset', report.dnaComparison?.fileA?.filename ?? String(report.owner.originalFilename ?? '—')],
    ['Suspected File', report.dnaComparison?.fileB?.filename ?? '—'],
  ]);

  y = sectionHeader(doc, 'LAYER-BY-LAYER ANALYSIS', y);
  autoTable(doc, {
    startY: y,
    head: [['Layer', 'Name', 'Match %', 'Status', 'Fingerprints', 'Explanation']],
    body: layers.map((l) => [
      `L${l.layer}`,
      l.name,
      `${l.similarityPercent}%`,
      l.matched ? 'PASS' : 'FAIL',
      `${truncate(l.fingerprintA)} → ${truncate(l.fingerprintB)}`,
      l.changeDescription,
    ]),
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7 },
    columnStyles: { 4: { cellWidth: 35 }, 5: { cellWidth: 40 } },
    theme: 'striped',
  });

  return finalizeSignedPdf(doc, report, 'DNA');
}

export async function downloadDnaReportPdf(report: InvestigationReportExport): Promise<void> {
  const blob = await buildDnaReportPdf(report);
  const filename = forensicReportFilename(report, 'DNA Report');
  await persistForensicExport(report.investigationId, 'dna', blob, filename);
  downloadBlob(blob, filename);
}

// ─── Timeline Report PDF ──────────────────────────────────────────────────────

export async function buildTimelineReportPdf(report: InvestigationReportExport): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = coverHeader(doc, 'Forensic Timeline Report', report.investigationId);

  y = sectionHeader(doc, 'FILE LIFECYCLE TIMELINE', y);
  const stages = [
    'Created',
    'DNA Generated',
    'Stored',
    'Shared',
    'Viewed',
    'Downloaded',
    'Screenshot',
    'Modified',
    'Investigation Time',
  ];

  const events = report.timeline.length
    ? report.timeline
    : stages.map((stage) => ({ stage, timestamp: undefined, detail: 'No event recorded' }));

  autoTable(doc, {
    startY: y,
    head: [['Stage', 'Timestamp', 'Detail']],
    body: events.map((ev) => [
      ev.stage,
      ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—',
      ev.detail ?? '—',
    ]),
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    theme: 'striped',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;

  if (report.accessIntelligence.length) {
    if (y > 200) { doc.addPage(); y = 20; }
    y = sectionHeader(doc, 'ACCESS EVENTS', y);
    autoTable(doc, {
      startY: y,
      head: [['Time', 'Action', 'IP', 'Device', 'Location']],
      body: report.accessIntelligence.slice(0, 25).map((a) => [
        a.timestamp ? new Date(a.timestamp).toLocaleString() : '—',
        a.action ?? '—',
        a.ipAddress ?? '—',
        a.device ?? a.browser ?? '—',
        [a.city, a.country].filter(Boolean).join(', ') || '—',
      ]),
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      theme: 'striped',
    });
  }

  return finalizeSignedPdf(doc, report, 'TIMELINE');
}

function truncate(s: string, max = 12): string {
  if (!s || s === '—') return '—';
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export async function downloadTimelineReportPdf(report: InvestigationReportExport): Promise<void> {
  const blob = await buildTimelineReportPdf(report);
  const filename = forensicReportFilename(report, 'Timeline Report');
  await persistForensicExport(report.investigationId, 'timeline', blob, filename);
  downloadBlob(blob, filename);
}

// ─── Evidence ZIP package ─────────────────────────────────────────────────────

function buildHashesJson(report: InvestigationReportExport): object {
  const layers = report.dnaComparison?.layerComparisons ?? [];
  const crypto = layers.find((l) => l.layer === 1);
  return {
    investigationId: report.investigationId,
    generatedAt: new Date().toISOString(),
    sha256Original: crypto?.fingerprintA ?? null,
    sha256Suspected: crypto?.fingerprintB ?? null,
    layers: layers.map((l) => ({
      layer: l.layer,
      name: l.name,
      fingerprintA: l.fingerprintA,
      fingerprintB: l.fingerprintB,
      similarityPercent: l.similarityPercent,
    })),
  };
}

function buildCertificateJson(report: InvestigationReportExport): object {
  return {
    certificateId: report.identityProof.certificateId ?? report.owner.certificateId ?? null,
    status: report.summary.certificateStatus,
    vaultId: report.identityProof.vaultId ?? report.owner.vaultId,
    dnaRecordId: report.identityProof.dnaRecordId ?? report.owner.dnaRecordId,
    ownerPinitId: report.identityProof.ownerPinitId ?? report.owner.ownerPinitId,
    issuedAt: report.investigatedAt,
    engine: `${BRAND.name} Unified Investigation Center`,
  };
}

function buildIdentityJson(report: InvestigationReportExport): object {
  return {
    ...report.identityProof,
    owner: report.owner,
    summary: {
      ownershipConfidence: report.summary.ownershipConfidence,
      identityStatus: report.summary.identityStatus,
    },
  };
}

export async function downloadEvidencePackageZip(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<void> {
  const zip = new JSZip();
  const base = forensicExportBaseName(report);
  const invName = forensicReportFilename(report);
  const dnaName = forensicReportFilename(report, 'DNA Report');
  const timelineName = forensicReportFilename(report, 'Timeline Report');

  const invPdf = await buildInvestigationReportPdf(report, options);
  const dnaPdf = await buildDnaReportPdf(report);
  const timelinePdf = await buildTimelineReportPdf(report);

  zip.file(invName, invPdf);
  zip.file(dnaName, dnaPdf);
  zip.file(timelineName, timelinePdf);
  zip.file('Identity.json', JSON.stringify(buildIdentityJson(report), null, 2));
  zip.file('Hashes.json', JSON.stringify(buildHashesJson(report), null, 2));
  zip.file('Certificate.json', JSON.stringify(buildCertificateJson(report), null, 2));
  zip.file('AccessLogs.json', JSON.stringify(report.accessIntelligence, null, 2));
  zip.file('Evidence.json', JSON.stringify(report, null, 2));
  zip.file('EnterpriseInvestigationReport.json', JSON.stringify(buildEnterpriseInvestigationViewModel(report), null, 2));

  const packageHash = await sha256HexBuffer(await zip.generateAsync({ type: 'arraybuffer' }));
  const packageManifest = await signReportManifest({
    investigationId: report.investigationId,
    reportType: 'EVIDENCE_PACKAGE',
    reportHash: packageHash,
    certificateStatus: report.summary.certificateStatus,
  });

  if (packageManifest) {
    zip.file('EvidenceManifest.json', JSON.stringify(packageManifest, null, 2));
    zip.file('DigitalSignature.sig', packageManifest.signature);
    const qrBuf = await QRCode.toBuffer(packageManifest.verifyUrl, { type: 'png', margin: 1, width: 256 });
    zip.file('QR.png', qrBuf);
  }

  zip.file(
    'Screenshots/README.txt',
    'Screenshot artifacts are captured client-side during Scan Document mode.\n',
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const zipName = `${base} - Evidence Package.zip`;

  // Store individual PDFs + ZIP so Forensic Reports can re-open any of them later.
  await Promise.all([
    persistForensicExport(report.investigationId, 'investigation', invPdf, invName),
    persistForensicExport(report.investigationId, 'dna', dnaPdf, dnaName),
    persistForensicExport(report.investigationId, 'timeline', timelinePdf, timelineName),
    persistForensicExport(report.investigationId, 'evidence_zip', blob, zipName),
  ]);

  downloadBlob(blob, zipName);
}

export async function downloadAdvancedExportJson(report: InvestigationReportExport): Promise<void> {
  const filename = `${forensicExportBaseName(report)} - Evidence Data.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  await persistForensicExport(report.investigationId, 'json', blob, filename);
  downloadBlob(blob, filename);
}

/**
 * Build and archive Investigation / DNA / Timeline PDFs (+ JSON) into Forensic Reports
 * without triggering a browser download. Called automatically when an investigation finishes.
 */
export async function archiveInvestigationForensicExports(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<void> {
  const base = forensicExportBaseName(report);
  const [invPdf, dnaPdf, timelinePdf] = await Promise.all([
    buildInvestigationReportPdf(report, options),
    buildDnaReportPdf(report),
    buildTimelineReportPdf(report),
  ]);
  const jsonBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  await Promise.all([
    persistForensicExport(report.investigationId, 'investigation', invPdf, forensicReportFilename(report)),
    persistForensicExport(report.investigationId, 'dna', dnaPdf, forensicReportFilename(report, 'DNA Report')),
    persistForensicExport(report.investigationId, 'timeline', timelinePdf, forensicReportFilename(report, 'Timeline Report')),
    persistForensicExport(report.investigationId, 'json', jsonBlob, `${base} - Evidence Data.json`),
  ]);
}
