/**
 * Forensic Evidence Report — print layout.
 *
 * Presentation only. Callers supply the enterprise view model; this module
 * does not run investigation, matching, or evidence generation.
 */
import { jsPDF } from 'jspdf';
import type { EnterpriseInvestigationViewModel } from '../lib/enterprise-investigation-report-model';

export type PdfImageAsset = {
  dataUrl: string;
  format: 'JPEG' | 'PNG';
  width: number;
  height: number;
};

export type EvidencePdfManifest = {
  reportId: string;
  reportHash: string;
  issuedAt: string;
  engineVersion: string;
  publicKeyFingerprint: string;
  verifyUrl: string;
};

export type EvidencePdfInput = {
  vm: EnterpriseInvestigationViewModel;
  assetName: string;
  recovery?: { tepCode?: string | null; protectedDownloadDate?: string };
  pinithubLogo?: PdfImageAsset | null;
  comparisonImages?: { original?: PdfImageAsset; probe?: PdfImageAsset };
  leakMessage?: string | null;
  currentFileHash?: string | null;
};

type RGB = [number, number, number];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16;
const RAIL = 7;
const FOOT = 18;
const CONTENT_L = M + RAIL;
const CONTENT_R = PAGE_W - M;
const CONTENT_W = CONTENT_R - CONTENT_L;

const C = {
  cover: [11, 18, 32] as RGB,
  coverMid: [18, 28, 48] as RGB,
  gold: [196, 154, 74] as RGB,
  goldSoft: [232, 214, 170] as RGB,
  crimson: [132, 32, 38] as RGB,
  paper: [247, 244, 236] as RGB,
  panel: [255, 253, 248] as RGB,
  ink: [22, 28, 36] as RGB,
  body: [58, 66, 78] as RGB,
  muted: [108, 116, 128] as RGB,
  rule: [214, 206, 188] as RGB,
  pass: [18, 96, 64] as RGB,
  warn: [146, 92, 18] as RGB,
  fail: [132, 32, 38] as RGB,
  na: [120, 124, 132] as RGB,
  white: [255, 255, 255] as RGB,
};

function rgb(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function fill(doc: jsPDF, c: RGB) {
  doc.setFillColor(c[0], c[1], c[2]);
}

function stroke(doc: jsPDF, c: RGB) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

function display(value: unknown, fallback = 'Not recorded'): string {
  if (value == null || value === '' || value === '—') return fallback;
  return String(value);
}

function availabilityLabel(a: string): string {
  if (a === 'available') return 'ENTERED';
  if (a === 'skipped') return 'NOT RUN';
  if (a === 'failed') return 'FAILED';
  if (a === 'partial') return 'PARTIAL';
  return 'NOT ENTERED';
}

function availabilityColor(a: string): RGB {
  if (a === 'available') return C.pass;
  if (a === 'failed') return C.fail;
  if (a === 'partial') return C.warn;
  return C.na;
}

function verdictTone(verdict: string, verified: boolean): { band: RGB; ink: RGB; label: string } {
  if (verified || /VERIFIED/i.test(verdict)) {
    return { band: C.gold, ink: C.cover, label: 'AFFIRMATIVE FINDING' };
  }
  if (/POSSIBLE/i.test(verdict)) {
    return { band: C.warn, ink: C.white, label: 'QUALIFIED FINDING' };
  }
  return { band: C.crimson, ink: C.white, label: 'NEGATIVE / INCONCLUSIVE' };
}

function wrap(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
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
  doc.addImage(image.dataUrl, image.format, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
}

function formatExaminedOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function drawInvestigationEvidencePdf(
  doc: jsPDF,
  input: EvidencePdfInput,
): { verifyPage: number; verifyY: number } {
  const { vm, assetName } = input;
  const verified = vm.originalAsset.ownershipVerified
    || /VERIFIED/i.test(vm.summary.finalVerdict)
    || vm.summary.reportState === 'VERIFIED';
  const tone = verdictTone(vm.summary.finalVerdict, verified);

  let y = 0;

  const paintInteriorGround = () => {
    fill(doc, C.paper);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
    fill(doc, C.cover);
    doc.rect(0, 0, RAIL, PAGE_H, 'F');
    fill(doc, C.gold);
    doc.rect(RAIL, 0, 0.9, PAGE_H, 'F');
  };

  const interiorHeader = () => {
    rgb(doc, C.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.text('PINIT SENTINEL  ·  FORENSIC EVIDENCE REPORT', CONTENT_L, 10);
    doc.setFont('helvetica', 'normal');
    const headName = wrap(doc, assetName.toUpperCase(), 78)[0] ?? '';
    doc.text(headName, CONTENT_R, 10, { align: 'right' });
    stroke(doc, C.gold);
    doc.setLineWidth(0.35);
    doc.line(CONTENT_L, 12.4, CONTENT_R, 12.4);
    y = 20;
  };

  const newInterior = (first = false) => {
    if (!first) doc.addPage();
    paintInteriorGround();
    interiorHeader();
  };

  const room = (needed: number) => {
    if (y + needed > PAGE_H - FOOT) newInterior();
  };

  const exhibit = (code: string, title: string) => {
    room(16);
    fill(doc, C.cover);
    doc.rect(CONTENT_L, y - 3.2, 18, 6.2, 'F');
    rgb(doc, C.gold);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(code, CONTENT_L + 9, y + 0.8, { align: 'center' });
    rgb(doc, C.cover);
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), CONTENT_L + 21, y + 0.9);
    stroke(doc, C.rule);
    doc.setLineWidth(0.25);
    doc.line(CONTENT_L, y + 4.2, CONTENT_R, y + 4.2);
    y += 11;
  };

  const bodyText = (text: string, size = 7.4) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const lines = wrap(doc, text, CONTENT_W);
    room(lines.length * 3.5 + 4);
    rgb(doc, C.body);
    lines.forEach((ln, i) => doc.text(ln, CONTENT_L, y + i * 3.5));
    y += lines.length * 3.5 + 4;
  };

  const idBlock = (label: string, value: string, mono = true) => {
    const text = display(value);
    doc.setFont(mono ? 'courier' : 'helvetica', 'normal');
    doc.setFontSize(mono ? 6.6 : 8);
    const lines = wrap(doc, text, CONTENT_W - 4);
    const h = 8 + lines.length * (mono ? 3.3 : 3.8);
    room(h + 2);
    fill(doc, C.panel);
    stroke(doc, C.rule);
    doc.setLineWidth(0.2);
    doc.roundedRect(CONTENT_L, y, CONTENT_W, h, 0.8, 0.8, 'FD');
    rgb(doc, C.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(label.toUpperCase(), CONTENT_L + 2.4, y + 4);
    rgb(doc, C.ink);
    doc.setFont(mono ? 'courier' : 'helvetica', 'normal');
    doc.setFontSize(mono ? 6.6 : 8);
    lines.forEach((ln, i) => doc.text(ln, CONTENT_L + 2.4, y + 8.2 + i * (mono ? 3.3 : 3.8)));
    y += h + 2.4;
  };

  const pairRow = (left: [string, string, boolean?], right: [string, string, boolean?] | null) => {
    const colW = right ? (CONTENT_W - 4) / 2 : CONTENT_W;
    const measure = (text: string, mono?: boolean) => {
      doc.setFont(mono ? 'courier' : 'helvetica', mono ? 'normal' : 'bold');
      doc.setFontSize(mono ? 6.6 : 8);
      return wrap(doc, display(text), colW - 4);
    };
    const lLines = measure(left[1], left[2]);
    const rLines = right ? measure(right[1], right[2]) : [];
    const h = 8 + Math.max(lLines.length, rLines.length || 1) * 3.5;
    room(h + 2);
    const drawCol = (spec: [string, string, boolean?], lines: string[], x: number) => {
      rgb(doc, C.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.4);
      doc.text(spec[0].toUpperCase(), x, y);
      rgb(doc, C.ink);
      doc.setFont(spec[2] ? 'courier' : 'helvetica', spec[2] ? 'normal' : 'bold');
      doc.setFontSize(spec[2] ? 6.6 : 8);
      lines.forEach((ln, i) => doc.text(ln, x, y + 4.2 + i * 3.5));
    };
    drawCol(left, lLines, CONTENT_L);
    if (right) drawCol(right, rLines, CONTENT_L + colW + 4);
    y += h;
  };

  // ── COVER ────────────────────────────────────────────────────────────────
  fill(doc, C.cover);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  stroke(doc, C.gold);
  doc.setLineWidth(0.55);
  doc.rect(8, 8, PAGE_W - 16, PAGE_H - 16, 'S');
  doc.setLineWidth(0.18);
  doc.rect(10.2, 10.2, PAGE_W - 20.4, PAGE_H - 20.4, 'S');

  if (input.pinithubLogo) {
    drawImageFit(doc, input.pinithubLogo, 18, 18, 16, 16);
  }
  rgb(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PINIT SENTINEL', input.pinithubLogo ? 38 : 18, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  rgb(doc, C.goldSoft);
  doc.text('DIGITAL PROVENANCE  ·  OWNERSHIP  ·  INTEGRITY', input.pinithubLogo ? 38 : 18, 30.2);

  fill(doc, C.crimson);
  doc.rect(18, 38, PAGE_W - 36, 8, 'F');
  rgb(doc, C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.text('CONTROLLED FORENSIC DOCUMENT  —  EVIDENCE CLASS F-1  —  NOT FOR PUBLIC RELEASE', PAGE_W / 2, 43.2, {
    align: 'center',
  });

  rgb(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text('FORENSIC EVIDENCE REPORT', 18, 62);

  rgb(doc, C.white);
  doc.setFontSize(22);
  const nameLines = wrap(doc, assetName, PAGE_W - 40);
  nameLines.slice(0, 3).forEach((ln, i) => doc.text(ln, 18, 74 + i * 10));
  y = 74 + Math.min(nameLines.length, 3) * 10 + 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  rgb(doc, C.goldSoft);
  doc.text('Official record of examination of a digital specimen against the Pinit protected original.', 18, y);
  y += 10;

  fill(doc, tone.band);
  doc.rect(18, y, PAGE_W - 36, 36, 'F');
  rgb(doc, tone.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.text(tone.label, 24, y + 8);
  doc.setFontSize(16);
  const vLines = wrap(doc, display(vm.summary.finalVerdict, 'INCONCLUSIVE'), PAGE_W - 88);
  vLines.slice(0, 2).forEach((ln, i) => doc.text(ln, 24, y + 18 + i * 7));
  doc.setFontSize(20);
  doc.text(`${vm.summary.confidence}%`, PAGE_W - 24, y + 18, { align: 'right' });
  doc.setFontSize(5.8);
  doc.text('CONFIDENCE', PAGE_W - 24, y + 24.5, { align: 'right' });
  y += 44;

  const metrics: Array<[string, string]> = [
    ['EXAMINATION', display(vm.summary.status)],
    ['EVIDENCE STRENGTH', vm.evidenceStrength],
    ['TRUST SCORE', `${vm.trustScore}%`],
    ['RISK', display(vm.summary.riskLevel)],
  ];
  const mw = (PAGE_W - 36 - 9) / 4;
  metrics.forEach(([label, val], i) => {
    const x = 18 + i * (mw + 3);
    stroke(doc, C.gold);
    doc.setLineWidth(0.25);
    doc.rect(x, y, mw, 16, 'S');
    rgb(doc, C.gold);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.2);
    doc.text(label, x + 2.5, y + 5.2);
    rgb(doc, C.white);
    doc.setFontSize(7.4);
    doc.text(wrap(doc, val, mw - 5)[0] ?? val, x + 2.5, y + 11.4);
  });
  y += 24;

  rgb(doc, C.goldSoft);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  bodyOnCover(
    doc,
    y,
    verified
      ? 'Determination: the examined file is linked to the named protected original. Supporting exhibits follow.'
      : 'Determination: ownership was not established to the policy threshold. Supporting exhibits and non-entered checks follow.',
  );

  rgb(doc, C.muted);
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.4);
  const coverMeta = [
    `Report reference  ${display(vm.summary.investigationId)}`,
    `Examined          ${formatExaminedOn(vm.summary.investigatedAt)}`,
    `Acceptance        ${display(vm.acceptance.verdict.value)}  ·  policy ${display(vm.acceptance.policyVersion.value, 'not recorded')}`,
    `Submission        ${vm.submissionReady ? 'READY FOR AUTHORISED SUBMISSION' : 'REVIEW REQUIRED BEFORE SUBMISSION'}`,
  ];
  coverMeta.forEach((ln, i) => {
    wrap(doc, ln, PAGE_W - 40).forEach((wln, j) => {
      doc.text(wln, 18, 248 + i * 7.2 + j * 3.2);
    });
  });

  rgb(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text('Page 1 continues with numbered exhibits. Identifiers are printed in full.', 18, PAGE_H - 16);

  // ── INTERIOR: determination ──────────────────────────────────────────────
  newInterior();
  exhibit('EXH A', 'Executive determination');
  pairRow(['Final verdict', display(vm.summary.finalVerdict)], ['Report state', display(vm.summary.reportState)]);
  pairRow(['Acceptance verdict', display(vm.acceptance.verdict.value)], ['Acceptance confidence', vm.acceptance.confidence.value != null ? `${vm.acceptance.confidence.value}%` : 'Not recorded']);
  pairRow(['Policy version', display(vm.acceptance.policyVersion.value), true], ['Retain owner', vm.acceptance.retainOwner ? 'Yes' : 'No']);
  if (vm.summary.decisionReason) {
    bodyText(`Basis of decision: ${vm.summary.decisionReason}`);
  }
  if (vm.summary.message) bodyText(vm.summary.message);
  if (vm.acceptance.reason.value && vm.acceptance.reason.availability !== 'unavailable') {
    bodyText(`Acceptance reason: ${String(vm.acceptance.reason.value)}`);
  }

  exhibit('EXH B', 'Identification registry');
  bodyText('Every identifier below is printed in full. None is abbreviated. Values that were not returned are marked Not recorded.');
  idBlock('Investigation / report reference', vm.summary.investigationId);
  idBlock('Vault identifier', display(vm.originalAsset.vaultId.value));
  idBlock('DNA record identifier', display(vm.originalAsset.dnaId.value));
  idBlock(
    vm.originalAsset.certificateIssued ? 'Certificate identifier' : 'Certificate identifier (not issued — tracking reference only)',
    display(vm.originalAsset.certificateId.value),
  );
  idBlock('Owner Pinit ID', display(vm.originalAsset.ownerPinitId.value));
  idBlock('Examined file SHA-256', display(input.currentFileHash ?? vm.suspectAsset.sha256.value));
  if (input.recovery?.tepCode) {
    idBlock('Tracked export code (TEP)', display(input.recovery.tepCode));
  }
  if (vm.retrieval.selectedVaultId.value) {
    idBlock('Selected retrieval vault', display(vm.retrieval.selectedVaultId.value));
  }

  exhibit('EXH C', 'Rights holder and original asset');
  pairRow(['Owner', display(vm.originalAsset.ownerName.value), false], ['Ownership verified', vm.originalAsset.ownershipVerified ? 'Yes' : 'No']);
  pairRow(['Original asset name', display(vm.originalAsset.originalFilename.value), false], ['Certificate status', vm.originalAsset.certificateStatus]);
  if (vm.originalAsset.ownerName.availability !== 'available') {
    bodyText(`Owner field: ${availabilityLabel(vm.originalAsset.ownerName.availability)}. ${vm.originalAsset.ownerName.note ?? ''}`);
  }

  exhibit('EXH D', 'Examined specimen');
  pairRow(['File name', display(vm.suspectAsset.filename.value), false], ['Media type', display(vm.suspectAsset.mimeType.value)]);
  pairRow(
    ['Size', vm.suspectAsset.sizeBytes.value != null ? `${vm.suspectAsset.sizeBytes.value.toLocaleString()} bytes` : 'Not recorded'],
    ['Assets searched', display(vm.retrieval.assetsSearched.value)],
  );
  pairRow(
    ['Tamper score', `${Math.round(vm.tamper.overallScore)}%`],
    ['Primary vector', !vm.tamper.primaryVector || vm.tamper.primaryVector === 'NONE' ? 'None significant' : vm.tamper.primaryVector],
  );
  if (vm.tamper.description) bodyText(vm.tamper.description);
  if (input.leakMessage) bodyText(`Leak intelligence: ${input.leakMessage}`);

  // ── Evidence table ───────────────────────────────────────────────────────
  exhibit('EXH E', 'Comparative evidence');
  const measured = vm.evidenceCards.filter((c) => c.availability === 'available');
  const notMeasured = vm.evidenceCards.filter((c) => c.availability !== 'available');

  if (measured.length) {
    measured.forEach((c) => {
      room(16);
      fill(doc, C.panel);
      doc.rect(CONTENT_L, y - 2.5, CONTENT_W, 14, 'F');
      fill(doc, c.matched ? C.pass : C.warn);
      doc.rect(CONTENT_L, y - 2.5, 1.4, 14, 'F');
      rgb(doc, C.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.text(c.title, CONTENT_L + 5, y + 2);
      rgb(doc, C.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.4);
      doc.text(wrap(doc, c.subtitle, CONTENT_W - 62)[0] ?? c.subtitle, CONTENT_L + 5, y + 6.6);
      rgb(doc, c.matched ? C.pass : C.body);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      const result = c.confidence != null ? `${c.statusLabel}  ${c.confidence}%` : c.statusLabel;
      doc.text(result, CONTENT_R - 3, y + 3.2, { align: 'right' });
      rgb(doc, availabilityColor(c.availability));
      doc.setFontSize(5.4);
      doc.text(availabilityLabel(c.availability), CONTENT_R - 3, y + 7.4, { align: 'right' });
      y += 16;
    });
  } else {
    bodyText('No comparison method returned a measurable result in this examination.');
  }

  vm.visualAi.forEach((v) => {
    if (v.availability === 'unavailable' && vm.visualAi.length === 1) {
      room(10);
      rgb(doc, C.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      const lines = wrap(doc, `${v.label}: ${availabilityLabel(v.availability)}. ${v.note ?? 'No visual or AI metrics were returned.'}`, CONTENT_W);
      lines.forEach((ln, i) => doc.text(ln, CONTENT_L, y + i * 3.5));
      y += lines.length * 3.5 + 3;
      return;
    }
    if (v.availability !== 'available') return;
    pairRow([v.label, v.value, false], ['Record', availabilityLabel(v.availability)]);
    if (v.note) bodyText(v.note);
  });

  if (notMeasured.length) {
    exhibit('EXH F', 'Checks not entered');
    bodyText(
      'The following methods produced no measurement. They carry no weight in the verdict either way and are listed so the record of what was run is complete.',
    );
    notMeasured.forEach((c) => {
      room(8);
      rgb(doc, C.na);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.text(c.title, CONTENT_L, y);
      doc.setFont('helvetica', 'normal');
      doc.text(availabilityLabel(c.availability), CONTENT_R, y, { align: 'right' });
      y += 4.2;
      rgb(doc, C.body);
      doc.setFontSize(6.6);
      const detail = wrap(doc, `${c.subtitle}. Status: ${c.statusLabel}.`, CONTENT_W);
      detail.forEach((ln, i) => doc.text(ln, CONTENT_L, y + i * 3.2));
      y += detail.length * 3.2 + 3.2;
    });
  }

  // ── Visual comparison ────────────────────────────────────────────────────
  if (input.comparisonImages?.original || input.comparisonImages?.probe) {
    exhibit('EXH G', 'Visual comparison');
    room(64);
    const boxW = (CONTENT_W - 6) / 2;
    const boxH = 50;
    (
      [
        ['ORIGINAL ASSET', input.comparisonImages.original, vm.originalAsset.originalFilename.value, CONTENT_L],
        ['EXAMINED FILE', input.comparisonImages.probe, vm.suspectAsset.filename.value, CONTENT_L + boxW + 6],
      ] as const
    ).forEach(([label, img, caption, x]) => {
      rgb(doc, C.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.6);
      doc.text(label, x, y);
      fill(doc, C.panel);
      stroke(doc, C.rule);
      doc.setLineWidth(0.25);
      doc.rect(x, y + 2, boxW, boxH, 'FD');
      if (img) {
        drawImageFit(doc, img, x + 1.2, y + 3.2, boxW - 2.4, boxH - 2.4);
      } else {
        rgb(doc, C.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.6);
        doc.text('Preview not available', x + boxW / 2, y + boxH / 2 + 2, { align: 'center' });
      }
      rgb(doc, C.body);
      doc.setFontSize(6.4);
      doc.text(wrap(doc, display(caption), boxW)[0] ?? '', x, y + boxH + 6.2);
    });
    y += boxH + 12;
  }

  exhibit('EXH H', 'Provenance and DNA layers');
  if (vm.ownershipEvidence.length) {
    vm.ownershipEvidence.forEach((e) => {
      room(12);
      fill(doc, availabilityColor(e.availability));
      doc.circle(CONTENT_L + 1.5, y - 0.4, 1.15, 'F');
      rgb(doc, C.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      doc.text(e.label, CONTENT_L + 5.5, y);
      rgb(doc, availabilityColor(e.availability));
      doc.setFontSize(5.6);
      doc.text(availabilityLabel(e.availability), CONTENT_R, y, { align: 'right' });
      y += 4.2;
      rgb(doc, C.body);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      const lines = wrap(doc, `${e.status}. ${display(e.detail, '')}`.trim(), CONTENT_W - 6);
      lines.forEach((ln, i) => doc.text(ln, CONTENT_L + 5.5, y + i * 3.3));
      y += lines.length * 3.3 + 3.5;
    });
  } else {
    bodyText('No provenance records were attached to this examination.');
  }

  if (vm.layers.length) {
    room(10);
    rgb(doc, C.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.text('LAYER COMPARISON (SCORES AS RETURNED — NOT INVENTED)', CONTENT_L, y);
    y += 5;
    vm.layers.forEach((l) => {
      room(6);
      rgb(doc, C.body);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.text(`L${l.layer}  ${l.name}`, CONTENT_L, y);
      rgb(doc, C.ink);
      doc.setFont('helvetica', 'bold');
      doc.text(`${Math.round(l.score)}%  ${l.status}`, CONTENT_R, y, { align: 'right' });
      y += 4.6;
      if (l.explanation) {
        rgb(doc, C.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        const expl = wrap(doc, l.explanation, CONTENT_W);
        expl.forEach((ln, i) => doc.text(ln, CONTENT_L, y + i * 3));
        y += expl.length * 3 + 1.6;
      }
    });
    y += 2;
  } else if (vm.layersNote) {
    bodyText(`Layer comparison: NOT ENTERED. ${vm.layersNote}`);
  }

  if (vm.tamper.vectors.length || vm.tamper.changes.length) {
    exhibit('EXH I', 'Tamper indicators');
    vm.tamper.vectors.forEach((v) => {
      room(6);
      rgb(doc, v.detected ? C.warn : C.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text(`${v.detected ? 'DETECTED' : 'NOT DETECTED'}  ${v.label}`, CONTENT_L, y);
      y += 5;
    });
    vm.tamper.changes.forEach((ch) => {
      bodyText(`${ch.type}: ${ch.detected ? 'detected' : 'not detected'} (${Math.round(ch.confidence)}%). ${ch.detail}${ch.where ? ` Where: ${ch.where}` : ''}`);
    });
  }

  if (vm.retrieval.topCandidates.length) {
    exhibit('EXH J', 'Retrieval candidates');
    vm.retrieval.topCandidates.forEach((c) => {
      idBlock(
        `Rank ${c.rank}${c.selected ? ' — SELECTED' : ''}  ·  ${c.method}  ·  score ${c.compositeScore}${c.dnaMatchPercent != null ? `  ·  DNA ${c.dnaMatchPercent}%` : ''}`,
        `vault ${c.vaultId || 'Not recorded'}  |  dna ${c.dnaRecordId || 'Not recorded'}${c.signals.length ? `  |  ${c.signals.join(', ')}` : ''}`,
      );
    });
  }

  if (vm.custodySteps.length) {
    exhibit('EXH K', 'Chain of custody');
    vm.custodySteps.forEach((s, i) => {
      room(12);
      fill(doc, C.cover);
      doc.circle(CONTENT_L + 1.5, y - 0.4, 1.15, 'F');
      if (i < vm.custodySteps.length - 1) {
        stroke(doc, C.rule);
        doc.setLineWidth(0.3);
        doc.line(CONTENT_L + 1.5, y + 1, CONTENT_L + 1.5, y + 7);
      }
      rgb(doc, C.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      doc.text(s.label, CONTENT_L + 5.5, y);
      if (s.date) {
        rgb(doc, C.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.4);
        doc.text(formatExaminedOn(s.date), CONTENT_R, y, { align: 'right' });
      }
      if (s.detail) {
        rgb(doc, C.body);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.6);
        const lines = wrap(doc, s.detail, CONTENT_W - 8);
        lines.forEach((ln, i2) => doc.text(ln, CONTENT_L + 5.5, y + 3.8 + i2 * 3.2));
        y += lines.length * 3.2;
      }
      y += 7.2;
    });
  }

  if (vm.investigationSteps.length) {
    exhibit('EXH L', 'Investigation pipeline');
    vm.investigationSteps.forEach((s) => {
      room(8);
      rgb(doc, C.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text(s.label, CONTENT_L, y);
      rgb(doc, C.muted);
      doc.setFont('helvetica', 'normal');
      doc.text(s.status, CONTENT_R, y, { align: 'right' });
      y += 4;
      if (s.detail) {
        rgb(doc, C.body);
        doc.setFontSize(6.4);
        const lines = wrap(doc, s.detail, CONTENT_W);
        lines.forEach((ln, i) => doc.text(ln, CONTENT_L, y + i * 3.1));
        y += lines.length * 3.1 + 2.2;
      } else {
        y += 2.2;
      }
    });
  }

  if (vm.recommendedActions.length) {
    exhibit('EXH M', 'Recommended actions');
    vm.recommendedActions.forEach((a, idx) => {
      const lines = wrap(doc, `${idx + 1}.  ${a}`, CONTENT_W);
      room(lines.length * 3.6 + 3);
      rgb(doc, C.body);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.4);
      lines.forEach((ln, i) => doc.text(ln, CONTENT_L, y + i * 3.6));
      y += lines.length * 3.6 + 2.4;
    });
  }

  exhibit('EXH N', 'Certification and legal notice');
  bodyText(
    `This instrument records forensic evidence produced by Pinit Sentinel for the examination referenced above. `
    + `Subject asset: ${assetName}. Verdict: ${display(vm.summary.finalVerdict)}. `
    + `Acceptance policy: ${display(vm.acceptance.policyVersion.value, 'not recorded')}. `
    + 'The findings describe the file as presented for examination at the stated time. '
    + 'They are not a court judgment. Alteration of this document after issue invalidates the authentication exhibit.',
  );
  room(28);
  stroke(doc, C.rule);
  doc.setLineWidth(0.3);
  doc.line(CONTENT_L, y + 14, CONTENT_L + 58, y + 14);
  rgb(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.text('Authorised forensic signature', CONTENT_L, y + 18);
  rgb(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(display(vm.originalAsset.ownerName.value), CONTENT_L + 70, y + 10);
  rgb(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.text('Rights holder', CONTENT_L + 70, y + 14);
  rgb(doc, C.body);
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.4);
  wrap(doc, display(vm.originalAsset.ownerPinitId.value), CONTENT_W - 70).forEach((ln, i) => {
    doc.text(ln, CONTENT_L + 70, y + 18.4 + i * 3.2);
  });
  y += 28;

  exhibit('EXH O', 'Authentication');
  room(42);
  const verifyPage = doc.getNumberOfPages();
  const verifyY = y;
  y += 40;

  // Footers with correct totals
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p === 1) {
      rgb(doc, C.gold);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.text(`Page ${p} of ${total}`, PAGE_W - 18, PAGE_H - 16, { align: 'right' });
      continue;
    }
    stroke(doc, C.rule);
    doc.setLineWidth(0.2);
    doc.line(CONTENT_L, PAGE_H - 12, CONTENT_R, PAGE_H - 12);
    rgb(doc, C.cover);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.text('Pinit Sentinel', CONTENT_L, PAGE_H - 8);
    rgb(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.text(`Page ${p} of ${total}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
    const ref = wrap(doc, `Ref ${vm.summary.investigationId}`, 62)[0] ?? '';
    doc.text(ref, CONTENT_R, PAGE_H - 8, { align: 'right' });
  }

  return { verifyPage, verifyY };
}

function bodyOnCover(doc: jsPDF, y: number, text: string) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  const lines = doc.splitTextToSize(text, PAGE_W - 40) as string[];
  rgb(doc, C.goldSoft);
  lines.forEach((ln, i) => doc.text(ln, 18, y + i * 3.6));
}

export function drawEvidenceVerification(
  doc: jsPDF,
  slot: { verifyPage: number; verifyY: number },
  manifest: EvidencePdfManifest | null,
  qrDataUrl?: string,
): void {
  doc.setPage(slot.verifyPage);
  const y = slot.verifyY;
  const left = CONTENT_L;

  if (manifest && qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', left, y, 28, 28);
    const tx = left + 34;
    const tw = CONTENT_W - 34;
    rgb(doc, C.cover);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text('Scan to authenticate this report', tx, y + 4);
    rgb(doc, C.body);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    wrap(doc, 'The signature below covers the contents of this document as laid out at issue. Any alteration after issue invalidates it.', tw)
      .forEach((ln, i) => doc.text(ln, tx, y + 8.4 + i * 3.2));
    const rows: Array<[string, string]> = [
      ['Report ID', manifest.reportId],
      ['Report hash', manifest.reportHash],
      ['Signed at', formatExaminedOn(manifest.issuedAt)],
      ['Engine', `${manifest.engineVersion}  ·  key ${manifest.publicKeyFingerprint}`],
    ];
    let ry = y + 16;
    rows.forEach(([label, text]) => {
      rgb(doc, C.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.4);
      doc.text(label.toUpperCase(), tx, ry);
      rgb(doc, C.ink);
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.2);
      const lines = wrap(doc, text, tw - 22);
      lines.forEach((ln, i) => doc.text(ln, tx + 22, ry + i * 3.1));
      ry += Math.max(4.8, lines.length * 3.1 + 1.4);
    });
    return;
  }

  rgb(doc, C.body);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  wrap(
    doc,
    'A signed verification manifest could not be obtained when this report was generated, so no authentication QR code is printed. The forensic findings above are unaffected. Re-export the report while signed in to attach a signature.',
    CONTENT_W,
  ).forEach((ln, i) => doc.text(ln, left, y + 2 + i * 3.5));
}
