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
    originalHash?: string;
    currentHash?: string;
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
  doc.text('PinIT SENTINEL', MARGIN, 12);
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
      `PinIT Sentinel · Forensic Investigation · Page ${i}/${pages}`,
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
  a.click();
  URL.revokeObjectURL(url);
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

async function blobToPdfImage(blob: Blob): Promise<PdfImageAsset> {
  const mime = (blob.type || '').toLowerCase();
  if (mime.includes('png')) {
    const dataUrl = await blobToDataUrl(blob);
    const size = await readImageSize(dataUrl);
    return { dataUrl, format: 'PNG', ...size };
  }
  if (mime.includes('jpeg') || mime.includes('jpg')) {
    const dataUrl = await blobToDataUrl(blob);
    const size = await readImageSize(dataUrl);
    return { dataUrl, format: 'JPEG', ...size };
  }

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const size = await readImageSize(dataUrl);
  return { dataUrl, format: 'JPEG', ...size };
}

function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = dataUrl;
  });
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

  if (vaultId) {
    try {
      original = await blobToPdfImage(await previewVaultFile(vaultId));
    } catch {
      original = undefined;
    }
  }

  if (options?.probeFile) {
    try {
      probe = await blobToPdfImage(options.probeFile);
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
  const m = 4;
  const contentW = pageW - m * 2;
  const recovery = report.identityRecoveryReport as
    | { tepCode?: string | null; protectedDownloadDate?: string }
    | undefined;
  const value = (candidate: unknown, fallback = 'Not available') =>
    candidate == null || candidate === '' || candidate === '—' ? fallback : String(candidate);
  const short = (candidate: unknown, length = 30) => {
    const text = value(candidate);
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const statusColor = (good: boolean) => good ? SENTINEL.green : SENTINEL.amber;
  const riskColor = vm.summary.riskLevel === 'HIGH' || vm.summary.riskLevel === 'CRITICAL'
    ? SENTINEL.red
    : vm.summary.riskLevel === 'MEDIUM'
      ? SENTINEL.amber
      : SENTINEL.green;

  doc.setFillColor(...SENTINEL.bg);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Header — PinIT Hub logo + Sentinel report title.
  drawBrandLogo(doc, pinithubLogo, 5, 3, 24, 18);
  doc.setDrawColor(...SENTINEL.line);
  doc.line(31, 4, 31, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(...SENTINEL.white);
  doc.text('FORENSIC INVESTIGATION REPORT', 35, 9.5);
  doc.setFontSize(5);
  doc.text('& PROVENANCE VERIFICATION', 35, 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SENTINEL.muted);
  doc.setFontSize(4);
  doc.text('Comprehensive evidence report for identity, ownership, integrity and chain-of-custody verification.', 35, 19);

  doc.setFillColor(...(vm.submissionReady ? SENTINEL.green : SENTINEL.amber));
  doc.roundedRect(151, 4, 54, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.6);
  doc.setTextColor(...SENTINEL.bg);
  doc.text(vm.submissionReady ? 'READY FOR SUBMISSION' : 'REVIEW REQUIRED', 178, 9, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SENTINEL.muted);
  doc.setFontSize(3.8);
  doc.text(`Report ID  ${short(report.investigationId, 26)}`, 151, 17);
  doc.text(`Generated  ${new Date(report.investigatedAt || Date.now()).toLocaleString()}`, 151, 22);

  // Four KPI cards.
  const kpis = [
    ['REPORT STATUS', vm.summary.status, vm.submissionReady ? SENTINEL.green : SENTINEL.amber],
    ['RISK LEVEL', vm.summary.riskLevel, riskColor],
    ['OVERALL TRUST SCORE', `${vm.trustScore}%`, SENTINEL.green],
    ['EVIDENCE STRENGTH', vm.evidenceStrength, statusColor(vm.evidenceStrength === 'Strong')],
  ] as const;
  const kpiY = 27;
  const kpiW = (contentW - 3) / 4;
  kpis.forEach(([label, text, color], index) => {
    const x = m + index * (kpiW + 1);
    darkPanel(doc, x, kpiY, kpiW, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.7);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(label, x + 3, kpiY + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...color);
    doc.text(doc.splitTextToSize(text, kpiW - 6)[0] ?? text, x + 3, kpiY + 10.5);
  });

  // Verdict strip.
  darkPanel(doc, m, 43, contentW, 14, SENTINEL.panel2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.8);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text('FINAL VERDICT', 7, 48);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...SENTINEL.white);
  doc.text(vm.summary.finalVerdict, 7, 54);
  doc.setFontSize(3.8);
  doc.setTextColor(...SENTINEL.muted);
  doc.text(vm.summary.confidenceLabel, 201, 48, { align: 'right' });
  doc.setFontSize(9);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text(`${vm.summary.confidence}%`, 201, 54.5, { align: 'right' });

  // Original and detected asset panels.
  const assetY = 59;
  const assetW = (contentW - 2) / 2;
  [m, m + assetW + 2].forEach((x) => darkPanel(doc, x, assetY, assetW, 47));
  darkSectionTitle(doc, m, assetY, assetW, '1', 'Original Asset (Rights Holder)');
  darkSectionTitle(doc, m + assetW + 2, assetY, assetW, '2', 'Detected Asset (Probe)');
  doc.setFillColor(...SENTINEL.green);
  doc.roundedRect(8, 68, 23, 5, 1, 1, 'F');
  doc.setFontSize(3.5);
  doc.setTextColor(...SENTINEL.bg);
  doc.text(vm.originalAsset.ownershipVerified ? 'VERIFIED' : 'CANDIDATE', 19.5, 71.5, { align: 'center' });
  doc.setFillColor(...SENTINEL.red);
  doc.roundedRect(111, 68, 28, 5, 1, 1, 'F');
  doc.text('UNDER INVESTIGATION', 125, 71.5, { align: 'center' });

  darkKeyValue(doc, 8, 78, 'Asset Title', value(vm.originalAsset.originalFilename.value), 42);
  darkKeyValue(doc, 53, 78, 'Owner', value(vm.originalAsset.ownerName.value), 43);
  darkKeyValue(doc, 8, 86, 'Vault ID', short(vm.originalAsset.vaultId.value), 42);
  darkKeyValue(doc, 53, 86, 'PinIT DNA ID', short(vm.originalAsset.dnaId.value), 43);
  darkKeyValue(doc, 8, 94, 'Certificate ID', short(vm.originalAsset.certificateId.value), 42);
  darkKeyValue(doc, 53, 94, 'TEP Code', value(recovery?.tepCode, 'Not embedded'), 43);
  darkKeyValue(doc, 8, 102, 'Original SHA-256', short(report.identityRecoveryReport?.originalHash, 38), 88);

  darkKeyValue(doc, 111, 78, 'Uploaded File', value(vm.suspectAsset.filename.value), 42);
  darkKeyValue(doc, 156, 78, 'MIME Type', value(vm.suspectAsset.mimeType.value), 43);
  darkKeyValue(doc, 111, 86, 'Current SHA-256', short(vm.suspectAsset.sha256.value, 38), 88);
  darkKeyValue(doc, 111, 94, 'Similarity Score', `${vm.summary.confidence}%`, 42, SENTINEL.red);
  darkKeyValue(doc, 156, 94, 'Confidence', vm.summary.confidenceLabel, 43, SENTINEL.red);
  darkKeyValue(doc, 111, 102, 'Tamper Status', vm.tamper.primaryVector.replace(/_/g, ' '), 88, riskColor);

  // Evidence analysis five-card row.
  const evidenceY = 108;
  darkPanel(doc, m, evidenceY, contentW, 38);
  darkSectionTitle(doc, m, evidenceY, contentW, '3', 'Evidence Analysis');
  const evW = (contentW - 8) / 5;
  vm.evidenceCards.slice(0, 5).forEach((card, index) => {
    const x = 6 + index * (evW + 2);
    darkPanel(doc, x, 116, evW, 27, SENTINEL.panel2);
    const good = card.matched && card.availability === 'available';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.3);
    doc.setTextColor(...(good ? SENTINEL.green : SENTINEL.amber));
    doc.text(card.title.toUpperCase(), x + 2, 121, { maxWidth: evW - 4 });
    darkKeyValue(doc, x + 2, 127, 'Method', card.subtitle, evW - 4);
    darkKeyValue(
      doc,
      x + 2,
      135,
      'Status',
      card.availability === 'unavailable' ? 'Not measured' : card.statusLabel,
      evW - 4,
      good ? SENTINEL.green : SENTINEL.amber,
    );
    if (card.confidence != null) {
      doc.setFontSize(3.8);
      doc.text(`${Math.round(card.confidence)}%`, x + evW - 2, 140, { align: 'right' });
    }
  });

  // Side-by-side comparison — full-width image preview like Sentinel mockup.
  const compareY = 148;
  const compareH = 52;
  darkPanel(doc, m, compareY, contentW, compareH);
  darkSectionTitle(doc, m, compareY, contentW, '4', 'Side-by-Side Comparison');
  const frameGap = 2;
  const frameW = (contentW - frameGap - 4) / 2;
  const frameH = 38;
  const frameY = compareY + 8;
  const probeMime = String(vm.suspectAsset.mimeType.value);
  const probeIsImage = isImageMime(probeMime);

  drawComparisonFrame(doc, {
    x: 6,
    y: frameY,
    width: frameW,
    height: frameH,
    header: 'ORIGINAL ASSET',
    headerColor: SENTINEL.green,
    caption: short(vm.originalAsset.originalFilename.value, 34),
    image: comparisonImages.original,
    placeholder: 'Vault preview unavailable',
  });
  drawComparisonFrame(doc, {
    x: 6 + frameW + frameGap,
    y: frameY,
    width: frameW,
    height: frameH,
    header: vm.tamper.overallScore > 0 ? 'TAMPERED / PROBE FILE' : 'PROBE FILE',
    headerColor: SENTINEL.red,
    caption: short(vm.suspectAsset.filename.value, 34),
    image: probeIsImage ? comparisonImages.probe : undefined,
    placeholder: probeIsImage ? 'Probe preview unavailable' : 'Non-image probe file',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(...SENTINEL.green);
  doc.text(
    `${vm.summary.confidence}% IDENTITY MATCH`,
    m + contentW / 2,
    compareY + compareH - 2.5,
    { align: 'center' },
  );

  const provenanceY = compareY + compareH + 2;
  const provenanceH = 24;
  const provenanceX = m;
  const provenanceW = contentW;
  darkPanel(doc, provenanceX, provenanceY, provenanceW, provenanceH);
  darkSectionTitle(doc, provenanceX, provenanceY, provenanceW, '5', 'DNA & Provenance Verification');
  const provenanceRows = [
    ['15-Layer DNA', vm.layersAvailability === 'available' ? `${vm.layers.length} layers present` : 'Live recovery evidence'],
    ['Vault Identity', value(vm.originalAsset.vaultId.value, 'Not resolved')],
    ['Certificate', value(vm.originalAsset.certificateId.value, 'Not issued')],
    ['TEP / Protected Export', value(recovery?.tepCode, 'Not embedded')],
    ['Watermark', watermarkLabel(report.identityProof.watermark)],
    ['Tamper Analysis', `${vm.tamper.overallScore}% · ${vm.tamper.primaryVector.replace(/_/g, ' ')}`],
  ];
  provenanceRows.forEach(([label, text], index) => {
    const yy = provenanceY + 9 + index * 3.8;
    doc.setFillColor(...SENTINEL.green);
    doc.circle(8, yy - 1, 0.7, 'F');
    doc.setFontSize(3.8);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(label, 11, yy);
    doc.setTextColor(...SENTINEL.white);
    doc.text(short(text, 52), 52, yy);
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...SENTINEL.green);
  doc.text(`TRUST SCORE  ${vm.trustScore}%`, provenanceX + provenanceW - 4, provenanceY + provenanceH - 3, { align: 'right' });

  // Chain of custody.
  const custodyY = provenanceY + provenanceH + 2;
  const custodyH = 20;
  darkPanel(doc, m, custodyY, contentW, custodyH);
  darkSectionTitle(doc, m, custodyY, contentW, '6', 'Chain of Custody Timeline');
  const custody = (vm.custodySteps.length
    ? vm.custodySteps
    : vm.evidenceTimeline.map((event) => ({
      label: event.label,
      date: event.timestamp,
      detail: event.detail,
    }))).slice(0, 6);
  const timelineW = contentW / Math.max(custody.length, 1);
  custody.forEach((event, index) => {
    const x = 7 + index * timelineW;
    doc.setDrawColor(...SENTINEL.line);
    if (index < custody.length - 1) doc.line(x + 4, custodyY + 12, x + timelineW, custodyY + 12);
    doc.setFillColor(...(index === custody.length - 1 ? SENTINEL.red : SENTINEL.green));
    doc.circle(x + 3, custodyY + 12, 1.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.6);
    doc.setTextColor(...SENTINEL.white);
    doc.text(short(event.label, 18), x, custodyY + 17, { maxWidth: timelineW - 2 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.1);
    doc.setTextColor(...SENTINEL.muted);
    if (event.date) doc.text(new Date(event.date).toLocaleDateString(), x, custodyY + 20);
  });

  // Bottom declaration, actions, package and QR verification.
  const bottomY = custodyY + custodyH + 2;
  const bottomH = 28;
  const col1 = 77;
  const col2 = 46;
  const col3 = 45;
  const col4 = contentW - col1 - col2 - col3 - 3;
  const x1 = m;
  const x2 = x1 + col1 + 1;
  const x3 = x2 + col2 + 1;
  const x4 = x3 + col3 + 1;
  darkPanel(doc, x1, bottomY, col1, bottomH);
  darkPanel(doc, x2, bottomY, col2, bottomH);
  darkPanel(doc, x3, bottomY, col3, bottomH);
  darkPanel(doc, x4, bottomY, col4, bottomH);
  darkSectionTitle(doc, x1, bottomY, col1, '7', 'Legal Declaration');
  darkSectionTitle(doc, x2, bottomY, col2, '8', 'Recommended Actions');
  darkSectionTitle(doc, x3, bottomY, col3, '9', 'Output Package');
  darkSectionTitle(doc, x4, bottomY, col4, '', 'Scan to Verify');

  const declaration = `I declare that this report faithfully records the forensic evidence available to PinIT Sentinel. Verdict: ${vm.summary.finalVerdict}. Policy: ${value(vm.acceptance.policyVersion.value)}.`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.1);
  doc.setTextColor(...SENTINEL.white);
  doc.text(doc.splitTextToSize(declaration, col1 - 6), x1 + 3, bottomY + 12);
  doc.setTextColor(...SENTINEL.muted);
  doc.text(`Report owner: ${value(vm.originalAsset.ownerName.value)}`, x1 + 3, bottomY + 30);
  doc.text(`PINIT ID: ${value(vm.originalAsset.ownerPinitId.value)}`, x1 + 3, bottomY + 35);
  doc.setDrawColor(...SENTINEL.muted);
  doc.line(x1 + 3, bottomY + 43, x1 + 34, bottomY + 43);
  doc.text('Authorized signature', x1 + 3, bottomY + 46);

  vm.recommendedActions.slice(0, 7).forEach((action, index) => {
    compactBullet(doc, x2 + 2, bottomY + 12 + index * 5, action, col2 - 4);
  });
  [
    'Investigation Report PDF',
    '15-Layer DNA Report',
    'Evidence Package ZIP',
    'Signed Manifest',
    'Hash & Metadata Report',
    'Chain-of-Custody PDF',
  ].forEach((item, index) => {
    compactBullet(doc, x3 + 2, bottomY + 12 + index * 5, item, col3 - 4);
  });

  // Sign the completed evidence content, then place its verification QR in the reserved block.
  const preliminaryBlob = pdfBlobOut(doc);
  const manifest = await signPdfBlob(preliminaryBlob, report, 'INVESTIGATION');
  if (manifest) {
    const qr = await QRCode.toDataURL(manifest.verifyUrl, {
      margin: 1,
      width: 240,
      color: { dark: '#04101b', light: '#ffffff' },
    });
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x4 + 7, bottomY + 9, col4 - 14, 26, 1, 1, 'F');
    doc.addImage(qr, 'PNG', x4 + 9, bottomY + 11, col4 - 18, 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.8);
    doc.setTextColor(...SENTINEL.white);
    doc.text('VERIFY AUTHENTICITY', x4 + col4 / 2, bottomY + 39, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.1);
    doc.setTextColor(...SENTINEL.muted);
    doc.text(short(manifest.reportId, 18), x4 + col4 / 2, bottomY + 44, { align: 'center' });
  } else {
    doc.setFontSize(4);
    doc.setTextColor(...SENTINEL.muted);
    doc.text('Verification QR unavailable', x4 + col4 / 2, bottomY + 27, { align: 'center' });
  }

  // Branded footer.
  doc.setFillColor(...SENTINEL.panel2);
  doc.rect(0, 280, pageW, 17, 'F');
  drawBrandLogo(doc, pinithubLogo, 6, 282, 14, 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(...SENTINEL.cyan);
  doc.text('PinIT Sentinel', 22, 287);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4);
  doc.setTextColor(...SENTINEL.muted);
  doc.text('Protecting Digital Rights. Preserving Trust.', 22, 291);
  doc.text(`© ${new Date().getFullYear()} PinIT Global. All rights reserved.`, 205, 289, { align: 'right' });

  // Explicitly guarantee the requested single-page document.
  while (doc.getNumberOfPages() > 1) doc.deletePage(doc.getNumberOfPages());
  return pdfBlobOut(doc);
}

export async function downloadInvestigationReportPdf(
  report: InvestigationReportExport,
  options?: InvestigationReportPdfOptions,
): Promise<void> {
  const blob = await buildInvestigationReportPdf(report, options);
  downloadBlob(blob, `InvestigationReport-${report.investigationId.slice(0, 8)}.pdf`);
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
  downloadBlob(blob, `DNAReport-${report.investigationId.slice(0, 8)}.pdf`);
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
  downloadBlob(blob, `TimelineReport-${report.investigationId.slice(0, 8)}.pdf`);
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
  downloadBlob(blob, `EvidencePackage-${id}.zip`);
}

export function downloadAdvancedExportJson(report: InvestigationReportExport): void {
  downloadBlob(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    `investigation-advanced-${report.investigationId.slice(0, 8)}.json`,
  );
}
