/**
 * Unified Investigation — professional PDF & ZIP evidence exports
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { previewVaultFile, signReportManifest, type SignedReportManifest } from './dashboard.api';
import { buildEnterpriseInvestigationViewModel } from '../lib/enterprise-investigation-report-model';
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

function watermarkLabel(wm: InvestigationReportExport['identityProof']['watermark']): string {
  if (wm.status === 'DETECTED') return 'DETECTED';
  if (wm.status === 'DAMAGED') return 'DAMAGED';
  return 'NOT EMBEDDED';
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

function drawImageFit(
  doc: jsPDF,
  image: PdfImageAsset,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
): void {
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  doc.addImage(
    image.dataUrl,
    image.format,
    x + (boxW - w) / 2,
    y + (boxH - h) / 2,
    w,
    h,
  );
}

function drawBrandLogo(
  doc: jsPDF,
  logo: PdfImageAsset | null,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): void {
  if (!logo) return;
  const scale = Math.min(maxW / logo.width, maxH / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  doc.addImage(logo.dataUrl, logo.format, x, y, w, h);
}

function drawComparisonFrame(
  doc: jsPDF,
  params: {
    x: number;
    y: number;
    width: number;
    height: number;
    header: string;
    headerColor: [number, number, number];
    caption: string;
    image?: PdfImageAsset;
    placeholder: string;
  },
): void {
  darkPanel(doc, params.x, params.y, params.width, params.height, SENTINEL.panel2);
  doc.setFillColor(...params.headerColor);
  doc.rect(params.x, params.y, params.width, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.3);
  doc.setTextColor(...SENTINEL.bg);
  doc.text(params.header, params.x + params.width / 2, params.y + 3.7, { align: 'center' });

  const innerX = params.x + 1.5;
  const innerY = params.y + 6.5;
  const innerW = params.width - 3;
  const innerH = params.height - 12;
  doc.setFillColor(12, 20, 30);
  doc.rect(innerX, innerY, innerW, innerH, 'F');

  if (params.image) {
    drawImageFit(doc, params.image, innerX, innerY, innerW, innerH);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(params.placeholder, params.x + params.width / 2, innerY + innerH / 2, { align: 'center' });
  }

  doc.setFontSize(3.5);
  doc.setTextColor(...SENTINEL.muted);
  doc.text(params.caption, params.x + params.width / 2, params.y + params.height - 1.8, { align: 'center' });
}

// ─── Investigation Report PDF ─────────────────────────────────────────────────

const SENTINEL = {
  bg: [4, 16, 27] as [number, number, number],
  panel: [8, 27, 40] as [number, number, number],
  panel2: [11, 34, 49] as [number, number, number],
  line: [28, 68, 83] as [number, number, number],
  white: [241, 246, 248] as [number, number, number],
  muted: [151, 173, 181] as [number, number, number],
  cyan: [38, 157, 202] as [number, number, number],
  green: [55, 198, 113] as [number, number, number],
  amber: [238, 174, 55] as [number, number, number],
  red: [239, 84, 84] as [number, number, number],
};

function darkPanel(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = SENTINEL.panel,
): void {
  doc.setFillColor(...fill);
  doc.setDrawColor(...SENTINEL.line);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, width, height, 1.2, 1.2, 'FD');
}

function darkSectionTitle(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  number: string,
  title: string,
): void {
  doc.setFillColor(...SENTINEL.panel2);
  doc.rect(x, y, width, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.4);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text(`${number}.`, x + 2, y + 4);
  doc.setTextColor(...SENTINEL.white);
  doc.text(title.toUpperCase(), x + 7, y + 4);
}

function darkKeyValue(
  doc: jsPDF,
  x: number,
  y: number,
  label: string,
  value: string,
  maxWidth: number,
  valueColor = SENTINEL.white,
): void {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.2);
  doc.setTextColor(...SENTINEL.muted);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...valueColor);
  const clipped = doc.splitTextToSize(value || 'Not available', maxWidth)[0] ?? 'Not available';
  doc.text(clipped, x, y + 3);
}

function compactBullet(
  doc: jsPDF,
  x: number,
  y: number,
  text: string,
  maxWidth: number,
): void {
  doc.setFillColor(...SENTINEL.green);
  doc.circle(x + 1.2, y - 0.7, 0.8, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.3);
  doc.setTextColor(...SENTINEL.white);
  const clipped = doc.splitTextToSize(text, maxWidth - 4)[0] ?? text;
  doc.text(clipped, x + 3, y);
}

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
  const pageW = 210;
  const pageH = 297;
  const m = 8;
  const contentW = pageW - m * 2;
  const gutter = 3;
  const recovery = report.identityRecoveryReport as
    | { tepCode?: string | null; protectedDownloadDate?: string; originalFilename?: string }
    | undefined;
  const value = (candidate: unknown, fallback = 'Not available') =>
    candidate == null || candidate === '' || candidate === '—' ? fallback : String(candidate);
  const short = (candidate: unknown, length = 30) => {
    const text = value(candidate);
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const statusColor = (good: boolean) => (good ? SENTINEL.green : SENTINEL.amber);
  const riskColor = vm.summary.riskLevel === 'HIGH' || vm.summary.riskLevel === 'CRITICAL'
    ? SENTINEL.red
    : vm.summary.riskLevel === 'MEDIUM'
      ? SENTINEL.amber
      : SENTINEL.green;
  const verified = vm.originalAsset.ownershipVerified
    || /VERIFIED/i.test(vm.summary.finalVerdict)
    || vm.summary.reportState === 'VERIFIED';
  const probeBadge = verified ? 'ANALYZED' : 'UNDER REVIEW';
  const probeBadgeColor = verified ? SENTINEL.cyan : SENTINEL.amber;
  const matchTone = vm.summary.confidence >= 85 ? SENTINEL.green : SENTINEL.amber;
  const certIssued = vm.originalAsset.certificateIssued;
  const certStatusLabel = vm.originalAsset.certificateStatus;
  const probeMime = String(vm.suspectAsset.mimeType.value ?? '');
  const probeName = String(vm.suspectAsset.filename.value ?? '');
  const probeIsMedia = isImageMime(probeMime) || isVideoMime(probeMime, probeName);

  // ── Page canvas ──────────────────────────────────────────────────────────
  doc.setFillColor(...SENTINEL.bg);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Official classification strip
  doc.setFillColor(...SENTINEL.panel2);
  doc.rect(0, 0, pageW, 6, 'F');
  doc.setFillColor(...SENTINEL.cyan);
  doc.rect(0, 0, 2.2, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.2);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text('OFFICIAL FORENSIC RECORD', m, 4);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SENTINEL.muted);
  doc.text('Pinit Sentinel  ·  Chain-of-custody evidence instrument', pageW - m, 4, { align: 'right' });

  // Header
  drawBrandLogo(doc, pinithubLogo, m, 9, 18, 14);
  doc.setDrawColor(...SENTINEL.line);
  doc.setLineWidth(0.35);
  doc.line(m + 21, 10, m + 21, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...SENTINEL.white);
  doc.text('FORENSIC INVESTIGATION REPORT', m + 25, 14.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.4);
  doc.setTextColor(...SENTINEL.muted);
  doc.text('Provenance · Ownership · Integrity · Custody', m + 25, 19.5);
  doc.setFontSize(3.6);
  doc.text('Issued under Pinit Global digital evidence standards', m + 25, 23);

  // Status seal
  doc.setFillColor(...(verified ? SENTINEL.green : SENTINEL.amber));
  doc.roundedRect(pageW - m - 48, 10, 48, 7, 0.8, 0.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.4);
  doc.setTextColor(...SENTINEL.bg);
  doc.text(verified ? 'AUTHORITATIVE FINDING' : 'REVIEW REQUIRED', pageW - m - 24, 14.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.5);
  doc.setTextColor(...SENTINEL.muted);
  doc.text(`Report  ${short(report.investigationId, 22)}`, pageW - m, 21, { align: 'right' });
  doc.text(`Issued   ${new Date(report.investigatedAt || Date.now()).toLocaleString()}`, pageW - m, 24.5, { align: 'right' });

  // KPI row — aligned 4-column grid
  const kpiY = 28;
  const kpiH = 13;
  const kpiW = (contentW - gutter * 3) / 4;
  const kpis: Array<[string, string, [number, number, number]]> = [
    ['REPORT STATUS', vm.summary.status, verified ? SENTINEL.green : SENTINEL.amber],
    ['RISK LEVEL', vm.summary.riskLevel, riskColor],
    ['TRUST SCORE', `${vm.trustScore}%`, SENTINEL.green],
    ['EVIDENCE', vm.evidenceStrength, statusColor(vm.evidenceStrength === 'Strong')],
  ];
  kpis.forEach(([label, text, color], index) => {
    const x = m + index * (kpiW + gutter);
    darkPanel(doc, x, kpiY, kpiW, kpiH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.4);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(label, x + 2.5, kpiY + 4.2);
    doc.setFontSize(6.2);
    doc.setTextColor(...color);
    doc.text(doc.splitTextToSize(text, kpiW - 5)[0] ?? text, x + 2.5, kpiY + 9.8);
  });

  // Verdict banner
  const verdictY = 43.5;
  darkPanel(doc, m, verdictY, contentW, 12, SENTINEL.panel2);
  doc.setFillColor(...(verified ? SENTINEL.green : SENTINEL.amber));
  doc.rect(m, verdictY, 1.6, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(3.6);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text('FINAL VERDICT', m + 5, verdictY + 4.2);
  doc.setFontSize(8.2);
  doc.setTextColor(...SENTINEL.white);
  doc.text(vm.summary.finalVerdict, m + 5, verdictY + 9.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.5);
  doc.setTextColor(...SENTINEL.muted);
  doc.text(vm.summary.confidenceLabel.toUpperCase(), pageW - m - 4, verdictY + 4.2, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...matchTone);
  doc.text(`${vm.summary.confidence}%`, pageW - m - 4, verdictY + 9.8, { align: 'right' });

  // Asset panels — equal columns
  const assetY = 58;
  const assetH = 44;
  const assetW = (contentW - gutter) / 2;
  const leftX = m;
  const rightX = m + assetW + gutter;

  darkPanel(doc, leftX, assetY, assetW, assetH);
  darkPanel(doc, rightX, assetY, assetW, assetH);
  darkSectionTitle(doc, leftX, assetY, assetW, '01', 'Original Asset (Rights Holder)');
  darkSectionTitle(doc, rightX, assetY, assetW, '02', 'Detected Asset (Probe)');

  // Badges
  doc.setFillColor(...SENTINEL.green);
  doc.roundedRect(leftX + 3, assetY + 8, 22, 4.6, 0.6, 0.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(3.3);
  doc.setTextColor(...SENTINEL.bg);
  doc.text(vm.originalAsset.ownershipVerified ? 'VERIFIED' : 'CANDIDATE', leftX + 14, assetY + 11.1, { align: 'center' });

  doc.setFillColor(...probeBadgeColor);
  doc.roundedRect(rightX + 3, assetY + 8, 26, 4.6, 0.6, 0.6, 'F');
  doc.text(probeBadge, rightX + 16, assetY + 11.1, { align: 'center' });

  const colA1 = leftX + 3;
  const colA2 = leftX + assetW / 2 + 1;
  const colB1 = rightX + 3;
  const colB2 = rightX + assetW / 2 + 1;
  const rowW = assetW / 2 - 5;

  darkKeyValue(doc, colA1, assetY + 16.5, 'Asset Title', value(vm.originalAsset.originalFilename.value), rowW);
  darkKeyValue(doc, colA2, assetY + 16.5, 'Owner', value(vm.originalAsset.ownerName.value), rowW);
  darkKeyValue(doc, colA1, assetY + 24, 'Vault ID', short(vm.originalAsset.vaultId.value, 28), rowW);
  darkKeyValue(doc, colA2, assetY + 24, 'Pinit DNA ID', short(vm.originalAsset.dnaId.value, 28), rowW);
  darkKeyValue(
    doc,
    colA1,
    assetY + 31.5,
    'Certificate ID',
    short(vm.originalAsset.certificateId.value, 28),
    rowW,
    certIssued ? SENTINEL.green : SENTINEL.cyan,
  );
  darkKeyValue(
    doc,
    colA2,
    assetY + 31.5,
    'Certificate Status',
    certStatusLabel,
    rowW,
    certIssued ? SENTINEL.green : SENTINEL.amber,
  );
  darkKeyValue(doc, colA1, assetY + 39, 'TEP Code', value(recovery?.tepCode, 'Not embedded'), rowW);
  darkKeyValue(doc, colA2, assetY + 39, 'Original SHA-256', short(report.identityRecoveryReport?.originalHash, 26), rowW);

  darkKeyValue(doc, colB1, assetY + 16.5, 'Uploaded File', value(vm.suspectAsset.filename.value), rowW);
  darkKeyValue(doc, colB2, assetY + 16.5, 'MIME Type', value(vm.suspectAsset.mimeType.value), rowW);
  darkKeyValue(doc, colB1, assetY + 24, 'Current SHA-256', short(vm.suspectAsset.sha256.value, 36), assetW - 8);
  darkKeyValue(doc, colB1, assetY + 31.5, 'Similarity Score', `${vm.summary.confidence}%`, rowW, matchTone);
  darkKeyValue(doc, colB2, assetY + 31.5, 'Confidence Basis', vm.summary.confidenceLabel, rowW, matchTone);
  darkKeyValue(
    doc,
    colB1,
    assetY + 39,
    'Tamper Status',
    vm.tamper.primaryVector.replace(/_/g, ' '),
    assetW - 8,
    riskColor,
  );

  // Evidence analysis
  const evidenceY = assetY + assetH + 2.5;
  const evidenceH = 34;
  darkPanel(doc, m, evidenceY, contentW, evidenceH);
  darkSectionTitle(doc, m, evidenceY, contentW, '03', 'Evidence Analysis');
  const evW = (contentW - gutter * 4 - 4) / 5;
  vm.evidenceCards.slice(0, 5).forEach((card, index) => {
    const x = m + 2 + index * (evW + gutter);
    const y = evidenceY + 8;
    darkPanel(doc, x, y, evW, 23, SENTINEL.panel2);
    const good = card.matched && card.availability === 'available';
    doc.setFillColor(...(good ? SENTINEL.green : SENTINEL.amber));
    doc.rect(x, y, 1.2, 23, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.8);
    doc.setTextColor(...(good ? SENTINEL.green : SENTINEL.amber));
    doc.text(card.title.toUpperCase(), x + 3, y + 4.5, { maxWidth: evW - 5 });
    darkKeyValue(doc, x + 3, y + 8.5, 'Method', card.subtitle, evW - 5);
    darkKeyValue(
      doc,
      x + 3,
      y + 15,
      'Status',
      card.availability === 'unavailable' ? 'Not measured' : card.statusLabel,
      evW - 5,
      good ? SENTINEL.green : SENTINEL.amber,
    );
    if (card.confidence != null) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(4.2);
      doc.setTextColor(...SENTINEL.white);
      doc.text(`${Math.round(card.confidence)}%`, x + evW - 2.5, y + 21, { align: 'right' });
    }
  });

  // Side-by-side comparison
  const compareY = evidenceY + evidenceH + 2.5;
  const compareH = 48;
  darkPanel(doc, m, compareY, contentW, compareH);
  darkSectionTitle(doc, m, compareY, contentW, '04', 'Side-by-Side Comparison');
  const frameW = (contentW - gutter - 4) / 2;
  const frameH = 34;
  const frameY = compareY + 8;

  drawComparisonFrame(doc, {
    x: m + 2,
    y: frameY,
    width: frameW,
    height: frameH,
    header: 'ORIGINAL ASSET',
    headerColor: SENTINEL.green,
    caption: short(vm.originalAsset.originalFilename.value, 40),
    image: comparisonImages.original,
    placeholder: comparisonImages.original ? '' : 'Media preview unavailable',
  });
  drawComparisonFrame(doc, {
    x: m + 2 + frameW + gutter,
    y: frameY,
    width: frameW,
    height: frameH,
    header: vm.tamper.overallScore > 0 ? 'PROBE / VARIANT' : 'PROBE FILE',
    headerColor: verified ? SENTINEL.cyan : SENTINEL.amber,
    caption: short(vm.suspectAsset.filename.value, 40),
    image: probeIsMedia ? comparisonImages.probe : comparisonImages.probe,
    placeholder: comparisonImages.probe
      ? ''
      : (probeIsMedia ? 'Probe preview unavailable' : 'Preview not applicable'),
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.setTextColor(...matchTone);
  doc.text(
    `${vm.summary.confidence}% IDENTITY MATCH`,
    m + contentW / 2,
    compareY + compareH - 2.2,
    { align: 'center' },
  );

  // Provenance
  const provenanceY = compareY + compareH + 2.5;
  const provenanceH = 26;
  darkPanel(doc, m, provenanceY, contentW, provenanceH);
  darkSectionTitle(doc, m, provenanceY, contentW, '05', 'DNA & Provenance Verification');
  const provenanceRows: Array<[string, string, [number, number, number]]> = [
    ['15-Layer DNA', vm.layersAvailability === 'available' ? `${vm.layers.length} layers analysed` : 'Live recovery evidence', SENTINEL.white],
    ['Vault Identity', value(vm.originalAsset.vaultId.value, 'Not resolved'), SENTINEL.white],
    [
      'Certificate ID',
      `${value(vm.originalAsset.certificateId.value)}${certIssued ? '' : '  (derived reference)'}`,
      certIssued ? SENTINEL.green : SENTINEL.cyan,
    ],
    ['Certificate Status', certStatusLabel, certIssued ? SENTINEL.green : SENTINEL.amber],
    ['TEP / Protected Export', value(recovery?.tepCode, 'Not embedded'), SENTINEL.white],
    ['Watermark', watermarkLabel(report.identityProof.watermark), SENTINEL.white],
  ];
  const leftRows = provenanceRows.slice(0, 3);
  const rightRows = provenanceRows.slice(3);
  leftRows.forEach(([label, text, color], index) => {
    const yy = provenanceY + 9.5 + index * 4.6;
    doc.setFillColor(...SENTINEL.green);
    doc.circle(m + 4, yy - 0.9, 0.75, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.7);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(label, m + 7, yy);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(short(text, 42), m + 42, yy);
  });
  rightRows.forEach(([label, text, color], index) => {
    const yy = provenanceY + 9.5 + index * 4.6;
    doc.setFillColor(...SENTINEL.green);
    doc.circle(m + contentW / 2 + 2, yy - 0.9, 0.75, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.7);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(label, m + contentW / 2 + 5, yy);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(short(text, 36), m + contentW / 2 + 40, yy);
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(...SENTINEL.green);
  doc.text(`TRUST  ${vm.trustScore}%`, pageW - m - 3, provenanceY + provenanceH - 2.5, { align: 'right' });

  // Chain of custody
  const custodyY = provenanceY + provenanceH + 2.5;
  const custodyH = 18;
  darkPanel(doc, m, custodyY, contentW, custodyH);
  darkSectionTitle(doc, m, custodyY, contentW, '06', 'Chain of Custody Timeline');
  const custody = (vm.custodySteps.length
    ? vm.custodySteps
    : vm.evidenceTimeline.map((event) => ({
      label: event.label,
      date: event.timestamp,
      detail: event.detail,
    }))).slice(0, 5);
  const steps = custody.length > 0 ? custody : [
    { label: 'Asset registered', date: report.investigatedAt, detail: undefined },
    { label: 'Probe submitted', date: report.investigatedAt, detail: undefined },
    { label: 'DNA matched', date: report.investigatedAt, detail: undefined },
    { label: 'Report issued', date: report.investigatedAt, detail: undefined },
  ];
  const timelineW = (contentW - 6) / Math.max(steps.length, 1);
  steps.forEach((event, index) => {
    const x = m + 4 + index * timelineW;
    doc.setDrawColor(...SENTINEL.line);
    doc.setLineWidth(0.4);
    if (index < steps.length - 1) doc.line(x + 3, custodyY + 10, x + timelineW - 1, custodyY + 10);
    doc.setFillColor(...(index === steps.length - 1 ? SENTINEL.cyan : SENTINEL.green));
    doc.circle(x + 2.5, custodyY + 10, 1.3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.4);
    doc.setTextColor(...SENTINEL.white);
    doc.text(short(event.label, 16), x, custodyY + 14.5, { maxWidth: timelineW - 3 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(2.9);
    doc.setTextColor(...SENTINEL.muted);
    if (event.date) doc.text(new Date(event.date).toLocaleDateString(), x, custodyY + 17.2);
  });

  // Bottom row — declaration / actions / package / QR (tight, no overflow)
  const bottomY = custodyY + custodyH + 2.5;
  const bottomH = 32;
  const col1 = 72;
  const col2 = 42;
  const col3 = 40;
  const col4 = contentW - col1 - col2 - col3 - gutter * 3;
  const x1 = m;
  const x2 = x1 + col1 + gutter;
  const x3 = x2 + col2 + gutter;
  const x4 = x3 + col3 + gutter;
  darkPanel(doc, x1, bottomY, col1, bottomH);
  darkPanel(doc, x2, bottomY, col2, bottomH);
  darkPanel(doc, x3, bottomY, col3, bottomH);
  darkPanel(doc, x4, bottomY, col4, bottomH);
  darkSectionTitle(doc, x1, bottomY, col1, '07', 'Legal Declaration');
  darkSectionTitle(doc, x2, bottomY, col2, '08', 'Recommended Actions');
  darkSectionTitle(doc, x3, bottomY, col3, '09', 'Output Package');
  darkSectionTitle(doc, x4, bottomY, col4, '10', 'Verify');

  const declaration = `This instrument records forensic evidence produced by Pinit Sentinel for the referenced investigation. Verdict: ${vm.summary.finalVerdict}. Policy: ${value(vm.acceptance.policyVersion.value)}.`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.6);
  doc.setTextColor(...SENTINEL.white);
  doc.text(doc.splitTextToSize(declaration, col1 - 5), x1 + 2.5, bottomY + 9);
  doc.setTextColor(...SENTINEL.muted);
  doc.setFontSize(3.2);
  doc.text(`Rights holder: ${short(vm.originalAsset.ownerName.value, 28)}`, x1 + 2.5, bottomY + 22);
  doc.text(`PINIT ID: ${short(vm.originalAsset.ownerPinitId.value, 28)}`, x1 + 2.5, bottomY + 25.5);
  doc.setDrawColor(...SENTINEL.line);
  doc.line(x1 + 2.5, bottomY + 28.5, x1 + 34, bottomY + 28.5);
  doc.text('Authorized forensic signature', x1 + 2.5, bottomY + 30.8);

  vm.recommendedActions.slice(0, 4).forEach((action, index) => {
    compactBullet(doc, x2 + 2, bottomY + 10 + index * 5, action, col2 - 4);
  });
  [
    'Investigation Report PDF',
    '15-Layer DNA Report',
    'Evidence Package ZIP',
    'Signed Manifest',
  ].forEach((item, index) => {
    compactBullet(doc, x3 + 2, bottomY + 10 + index * 5, item, col3 - 4);
  });

  const preliminaryBlob = pdfBlobOut(doc);
  const manifest = await signPdfBlob(preliminaryBlob, report, 'INVESTIGATION');
  if (manifest) {
    const qr = await QRCode.toDataURL(manifest.verifyUrl, {
      margin: 1,
      width: 220,
      color: { dark: '#04101b', light: '#ffffff' },
    });
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x4 + 4, bottomY + 8, col4 - 8, 18, 0.8, 0.8, 'F');
    doc.addImage(qr, 'PNG', x4 + 6, bottomY + 9, col4 - 12, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.3);
    doc.setTextColor(...SENTINEL.white);
    doc.text('SCAN TO AUTHENTICATE', x4 + col4 / 2, bottomY + 28, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(2.8);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(short(manifest.reportId, 16), x4 + col4 / 2, bottomY + 30.5, { align: 'center' });
  } else {
    doc.setFontSize(3.5);
    doc.setTextColor(...SENTINEL.muted);
    doc.text('Verification QR\nunavailable', x4 + col4 / 2, bottomY + 18, { align: 'center' });
  }

  // Official footer band
  doc.setFillColor(...SENTINEL.panel2);
  doc.rect(0, 284, pageW, 13, 'F');
  doc.setFillColor(...SENTINEL.cyan);
  doc.rect(0, 284, pageW, 0.6, 'F');
  drawBrandLogo(doc, pinithubLogo, m, 286, 11, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text('Pinit Sentinel', m + 14, 290);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.4);
  doc.setTextColor(...SENTINEL.muted);
  doc.text('Authoritative digital provenance record  ·  Protecting rights. Preserving trust.', m + 14, 293.5);
  doc.text(`© ${new Date().getFullYear()} Pinit Global`, pageW - m, 291.5, { align: 'right' });

  while (doc.getNumberOfPages() > 1) doc.deletePage(doc.getNumberOfPages());
  return pdfBlobOut(doc);
}

export async function downloadInvestigationReportPdf(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<void> {
  const blob = await buildInvestigationReportPdf(report, options);
  const filename = `InvestigationReport-${report.investigationId.slice(0, 8)}.pdf`;
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
    ['Original File', report.dnaComparison?.fileA?.filename ?? String(report.owner.originalFilename ?? '—')],
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
  const filename = `DNAReport-${report.investigationId.slice(0, 8)}.pdf`;
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
  const filename = `TimelineReport-${report.investigationId.slice(0, 8)}.pdf`;
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
  const id = report.investigationId.slice(0, 8);

  const invPdf = await buildInvestigationReportPdf(report, options);
  const dnaPdf = await buildDnaReportPdf(report);
  const timelinePdf = await buildTimelineReportPdf(report);

  zip.file('InvestigationReport.pdf', invPdf);
  zip.file('DNAReport.pdf', dnaPdf);
  zip.file('TimelineReport.pdf', timelinePdf);
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
  const zipName = `EvidencePackage-${id}.zip`;

  // Store individual PDFs + ZIP so Forensic Reports can re-open any of them later.
  await Promise.all([
    persistForensicExport(report.investigationId, 'investigation', invPdf, `InvestigationReport-${id}.pdf`),
    persistForensicExport(report.investigationId, 'dna', dnaPdf, `DNAReport-${id}.pdf`),
    persistForensicExport(report.investigationId, 'timeline', timelinePdf, `TimelineReport-${id}.pdf`),
    persistForensicExport(report.investigationId, 'evidence_zip', blob, zipName),
  ]);

  downloadBlob(blob, zipName);
}

export async function downloadAdvancedExportJson(report: InvestigationReportExport): Promise<void> {
  const filename = `investigation-advanced-${report.investigationId.slice(0, 8)}.json`;
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
  const id = report.investigationId.slice(0, 8);
  const [invPdf, dnaPdf, timelinePdf] = await Promise.all([
    buildInvestigationReportPdf(report, options),
    buildDnaReportPdf(report),
    buildTimelineReportPdf(report),
  ]);
  const jsonBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  await Promise.all([
    persistForensicExport(report.investigationId, 'investigation', invPdf, `InvestigationReport-${id}.pdf`),
    persistForensicExport(report.investigationId, 'dna', dnaPdf, `DNAReport-${id}.pdf`),
    persistForensicExport(report.investigationId, 'timeline', timelinePdf, `TimelineReport-${id}.pdf`),
    persistForensicExport(report.investigationId, 'json', jsonBlob, `investigation-advanced-${id}.json`),
  ]);
}
