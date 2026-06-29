/**
 * Unified Investigation — professional PDF & ZIP evidence exports
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { signReportManifest, type SignedReportManifest } from './dashboard.api';

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

function coverHeader(doc: jsPDF, title: string, investigationId: string) {
  doc.setFillColor(22, 33, 62);
  doc.rect(0, 0, W, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('PINIT-DNA', MARGIN, 16);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(title, MARGIN, 24);
  doc.setFontSize(9);
  doc.text(`Investigation ID: ${investigationId}`, MARGIN, 31);
  doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, 37);
  doc.setTextColor(30, 30, 30);
  return 50;
}

function footer(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `PINIT-DNA Forensic Investigation · Confidential · Page ${i}/${pages}`,
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

// ─── Investigation Report PDF ─────────────────────────────────────────────────

export async function buildInvestigationReportPdf(report: InvestigationReportExport): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = coverHeader(doc, 'Unified Forensic Investigation Report', report.investigationId);

  y = sectionHeader(doc, 'INVESTIGATION SUMMARY', y);
  y = table(doc, y, [
    ['Ownership Confidence', `${report.summary.ownershipConfidence}%`],
    ['DNA Match', `${report.summary.dnaMatchPercent}%`],
    ['Certificate Status', report.summary.certificateStatus],
    ['Identity Status', report.summary.identityStatus],
    ['Tamper Severity', report.summary.tamperSeverity],
    ['Risk Level', report.summary.riskLevel],
    ['Investigated At', new Date(report.investigatedAt).toLocaleString()],
  ]);

  y = sectionHeader(doc, 'ORIGINAL OWNER', y);
  y = table(doc, y, [
    ['Owner Name', String(report.owner.ownerName ?? '—')],
    ['PINIT ID', String(report.owner.ownerPinitId ?? '—')],
    ['Vault ID', String(report.owner.vaultId ?? '—')],
    ['DNA Record ID', String(report.owner.dnaRecordId ?? '—')],
    ['Certificate ID', String(report.owner.certificateId ?? '—')],
    ['Original Filename', String(report.owner.originalFilename ?? '—')],
    ['Created', report.owner.createdAt ? new Date(String(report.owner.createdAt)).toLocaleString() : '—'],
  ]);

  y = sectionHeader(doc, 'TAMPER ANALYSIS', y);
  y = table(doc, y, [
    ['Overall Tamper Score', `${report.tamperAnalysis.overallTamperScore}%`],
    ['Primary Vector', report.tamperAnalysis.primaryVector],
    ['Description', report.tamperAnalysis.description ?? '—'],
  ]);

  const detectedVectors = report.tamperAnalysis.vectors.filter((v) => v.detected).map((v) => v.label);
  if (detectedVectors.length) {
    y = table(doc, y, [['Detected Vectors', detectedVectors.join(', ')]]);
  }

  if (y > 220) { doc.addPage(); y = 20; }
  y = sectionHeader(doc, 'TIMELINE (SUMMARY)', y);
  const timelineRows = report.timeline.slice(0, 12).map((ev) => [
    ev.stage,
    ev.timestamp ? new Date(ev.timestamp).toLocaleString() : (ev.detail ?? '—'),
  ]);
  if (timelineRows.length) {
    autoTable(doc, {
      startY: y,
      head: [['Stage', 'Timestamp / Detail']],
      body: timelineRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      theme: 'striped',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  if (y > 220) { doc.addPage(); y = 20; }
  y = sectionHeader(doc, 'IDENTITY PROOF', y);
  const wm = report.identityProof.watermark;
  y = table(doc, y, [
    ['Digital Signature', report.identityProof.digitalSignatureValid ? 'VALID' : 'INVALID'],
    ['Identity Verification', report.identityProof.identityVerification],
    ['Watermark Status', watermarkLabel(wm)],
    ...(wm.status === 'DETECTED'
      ? [
          ['Watermark Code', wm.code ?? '—'],
          ['Owner PINIT ID', wm.ownerPinitId ?? '—'],
          ['Confidence', wm.confidence != null ? `${wm.confidence}%` : '—'],
        ]
      : [['Reason', wm.reason ?? '—']]),
  ]);

  if (report.message) {
    if (y > 240) { doc.addPage(); y = 20; }
    y = sectionHeader(doc, 'NOTES', y);
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(report.message, W - MARGIN * 2);
    doc.text(lines, MARGIN, y);
  }

  footer(doc);
  let pdfBlob = pdfBlobOut(doc);
  const manifest = await signPdfBlob(pdfBlob, report, 'INVESTIGATION');
  if (manifest) {
    const qr = await QRCode.toDataURL(manifest.verifyUrl, { margin: 1, width: 180 });
    applySignedFooter(doc, manifest, qr);
    footer(doc);
    pdfBlob = pdfBlobOut(doc);
  }
  return pdfBlob;
}

export async function downloadInvestigationReportPdf(report: InvestigationReportExport): Promise<void> {
  const blob = await buildInvestigationReportPdf(report);
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
    engine: 'PINIT-DNA Unified Investigation Center',
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

export async function downloadEvidencePackageZip(report: InvestigationReportExport): Promise<void> {
  const zip = new JSZip();
  const id = report.investigationId.slice(0, 8);

  const invPdf = await buildInvestigationReportPdf(report);
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
