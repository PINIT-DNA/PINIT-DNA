/**
 * PINIT-DNA — Forensic Analysis Service (Phase 4.1 + 4.4)
 *
 * Pure client-side analysis helpers.
 * DOES NOT touch any existing comparison, DNA, or encryption logic.
 * Reads ComparisonResult and generates human-readable explanations.
 */

import type { ComparisonResult, LayerComparison } from '../types/dashboard.types';

// ─── Tampering Classification Engine (Phase 4.4) ─────────────────────────────

export type TamperingClass =
  | 'Exact Match'
  | 'Metadata Modified'
  | 'Content Re-encoded'
  | 'Minor Content Edit'
  | 'Compression Changed'
  | 'Structural Modification'
  | 'Semantic Modification'
  | 'Signature Invalid'
  | 'Potential Forgery'
  | 'Major Content Change'
  | 'Cross-type Comparison'
  | 'Files Unrelated';

export interface TamperingClassification {
  classes: TamperingClass[];
  primaryClass: TamperingClass;
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  explanation: string;
  technicalDetail: string;
}

/** Derive intelligent tampering classifications from comparison result */
export function classifyTampering(result: ComparisonResult): TamperingClassification {
  const { layerComparisons, classification, overallConfidenceScore, sameFileType } = result;
  const by = (n: number) => layerComparisons.find(l => l.layer === n);

  const l1 = by(1); const l2 = by(2); const l3 = by(3);
  const l4 = by(4); const l5 = by(5); const l6 = by(6);

  // ── Exact match ──────────────────────────────────────────────────────────
  if (classification === 'DNA_MATCH') {
    return {
      classes: ['Exact Match'], primaryClass: 'Exact Match', severity: 'NONE',
      explanation: 'Files are byte-for-byte identical. All 10 DNA layers match perfectly.',
      technicalDetail: 'SHA-256 cryptographic hash matches. No modifications detected at any layer.',
    };
  }

  // ── Cross-type ────────────────────────────────────────────────────────────
  if (!sameFileType) {
    return {
      classes: ['Cross-type Comparison', 'Files Unrelated'], primaryClass: 'Cross-type Comparison',
      severity: 'HIGH',
      explanation: `Different file types compared. Content cannot be meaningfully related.`,
      technicalDetail: 'File types differ. Structural and perceptual comparison is not meaningful across types.',
    };
  }

  const classes: TamperingClass[] = [];
  let severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'NONE';

  // ── Signature forgery ─────────────────────────────────────────────────────
  if (l6?.changed && !l1?.changed && !l2?.changed && !l3?.changed) {
    classes.push('Signature Invalid', 'Potential Forgery');
    severity = 'CRITICAL';
  }

  // ── Major content change ──────────────────────────────────────────────────
  if (l1?.changed && l2?.changed && l3 && l3.similarityScore < 0.40) {
    classes.push('Major Content Change', 'Structural Modification');
    severity = severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
  }

  // ── Structural modification ───────────────────────────────────────────────
  if (l2?.changed && l3 && l3.similarityScore >= 0.40 && l3.similarityScore < 0.80) {
    if (!classes.includes('Structural Modification')) classes.push('Structural Modification');
    if (severity === 'NONE') severity = 'HIGH';
  }

  // ── Re-encoding / compression ─────────────────────────────────────────────
  if (l1?.changed && l3 && l3.similarityScore >= 0.92) {
    classes.push('Content Re-encoded', 'Compression Changed');
    if (severity === 'NONE') severity = 'MEDIUM';
  }

  // ── Minor content edit ────────────────────────────────────────────────────
  if (l1?.changed && l3 && l3.similarityScore >= 0.70 && l3.similarityScore < 0.92) {
    classes.push('Minor Content Edit');
    if (severity === 'NONE') severity = 'MEDIUM';
  }

  // ── Semantic modification ─────────────────────────────────────────────────
  if (l4?.changed && l3 && l3.similarityScore >= 0.80 && !classes.includes('Semantic Modification')) {
    classes.push('Semantic Modification');
    if (severity === 'NONE') severity = 'LOW';
  }

  // ── Metadata only ─────────────────────────────────────────────────────────
  if (l5?.changed && !l1?.changed && !l2?.changed && !l3?.changed && !l4?.changed) {
    if (!classes.includes('Metadata Modified')) classes.push('Metadata Modified');
    if (severity === 'NONE') severity = 'LOW';
  }

  // ── Unrelated ─────────────────────────────────────────────────────────────
  if (overallConfidenceScore < 20 && classes.length === 0) {
    classes.push('Files Unrelated');
    severity = 'HIGH';
  }

  const primaryClass = classes[0] ?? 'Files Unrelated';

  return {
    classes: classes.length > 0 ? classes : ['Files Unrelated'],
    primaryClass,
    severity: severity === 'NONE' && classification === 'DIFFERENT' ? 'HIGH' : severity,
    explanation: buildExplanation(primaryClass, result),
    technicalDetail: buildTechnicalDetail(classes, layerComparisons),
  };
}

function buildExplanation(cls: TamperingClass, result: ComparisonResult): string {
  const pct = result.overallConfidenceScore;
  switch (cls) {
    case 'Exact Match':             return `Files are byte-for-byte identical. DNA confidence: ${pct}%.`;
    case 'Metadata Modified':       return `File content is unchanged but metadata (author, timestamps, GPS) was modified.`;
    case 'Content Re-encoded':      return `File was re-saved or re-compressed. Visual/perceptual content is the same but raw bytes differ.`;
    case 'Minor Content Edit':      return `A small modification was made to the file content. ${pct}% of DNA layers still match.`;
    case 'Compression Changed':     return `The file's compression or encoding parameters changed. Content is largely preserved.`;
    case 'Structural Modification': return `The internal structure of the file changed significantly. Pages, layout, or elements were reorganised.`;
    case 'Semantic Modification':   return `The meaning or distribution of content changed (colours, word frequency, data values).`;
    case 'Signature Invalid':       return `The cryptographic integrity seal is broken. Possible unauthorised modification.`;
    case 'Potential Forgery':       return `Pattern matches known forgery signatures. Seal broken while content appears unchanged.`;
    case 'Major Content Change':    return `Extensive content modification detected. Only ${pct}% similarity remains.`;
    case 'Cross-type Comparison':   return `Files are of different types. Structural comparison is not meaningful.`;
    case 'Files Unrelated':         return `Files share no meaningful DNA. They are completely different files.`;
    default: return `DNA analysis score: ${pct}%.`;
  }
}

function buildTechnicalDetail(classes: TamperingClass[], layers: LayerComparison[]): string {
  const passed = layers.filter(l => l.matched).map(l => `L${l.layer}`).join(', ');
  const failed = layers.filter(l => !l.matched).map(l => `L${l.layer}`).join(', ');
  return `Passed layers: ${passed || 'none'}. Failed layers: ${failed || 'none'}. ` +
         `Classifications: ${classes.join(', ')}.`;
}

// ─── Layer explanations (Phase 4.1) ──────────────────────────────────────────

export interface LayerExplanation {
  layer: number;
  name: string;
  shortStatus: string;
  humanReadable: string;
  whatItMeans: string;
  technicalAlgo: string;
}

export function explainLayer(l: LayerComparison): LayerExplanation {
  const pct = l.similarityPercent;

  const LAYER_META: Record<number, { name: string; algo: string; what: string }> = {
    1:  { name: 'Cryptographic Hash',  algo: 'SHA-256 of raw bytes',                  what: 'Proves byte-for-byte file identity' },
    2:  { name: 'Structural',          algo: 'Sobel edges / page layout / entry tree', what: 'Captures file organisation and internal structure' },
    3:  { name: 'Perceptual',          algo: 'SimHash-64 / DCT pHash',                what: 'Detects near-duplicate content regardless of minor edits' },
    4:  { name: 'Semantic',            algo: 'Word freq / colour histogram / type dist',what: 'Analyses the meaning and distribution of content' },
    5:  { name: 'Metadata Provenance', algo: 'EXIF / ID3 / OPC core.xml / container', what: 'Tracks authorship, timestamps, and device information' },
    6:  { name: 'Integrity Signature', algo: 'HMAC-SHA256 content seal',               what: 'Cryptographic proof the file was sealed by this system' },
    7:  { name: 'Behavioral DNA',      algo: 'SHA-256 behavior bundle',                what: 'Upload timing, device, session — proves who uploaded it' },
    8:  { name: 'Relationship DNA',    algo: 'SHA-256 duplicate graph hash',           what: 'Links to duplicate files — proves original ownership' },
    9:  { name: 'Origin DNA',          algo: 'SHA-256 origin bundle',                  what: 'IP, location, timestamp — proves where file came from' },
    10: { name: 'Evolution DNA',       algo: 'Merkle tree mutation log',               what: 'Version history — proves file existed at a specific time' },
  };

  const meta = LAYER_META[l.layer] ?? { name: l.name, algo: l.implementation, what: '' };

  let shortStatus: string;
  let humanReadable: string;

  if (pct === 100) {
    shortStatus = 'Exact Match';
    humanReadable = `${meta.name} is identical — no changes detected.`;
  } else if (pct >= 90) {
    shortStatus = 'Near Match';
    humanReadable = `${meta.name} is ${pct}% similar — minor difference detected.`;
  } else if (pct >= 60) {
    shortStatus = 'Partial Match';
    humanReadable = `${meta.name} shows ${pct}% similarity — notable modification present.`;
  } else if (pct > 0) {
    shortStatus = 'Low Match';
    humanReadable = `${meta.name} is only ${pct}% similar — significant change detected.`;
  } else {
    shortStatus = 'No Match';
    humanReadable = `${meta.name} is completely different — no relationship found.`;
  }

  return {
    layer: l.layer,
    name: meta.name,
    shortStatus,
    humanReadable,
    whatItMeans: meta.what,
    technicalAlgo: meta.algo,
  };
}

// ─── Severity colour maps ─────────────────────────────────────────────────────

export const SEVERITY_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  NONE:     { text: 'text-success', bg: 'bg-success/10',  border: 'border-success/30' },
  LOW:      { text: 'text-info',    bg: 'bg-info/10',     border: 'border-info/30'    },
  MEDIUM:   { text: 'text-warning', bg: 'bg-warning/10',  border: 'border-warning/30' },
  HIGH:     { text: 'text-orange',  bg: 'bg-orange/10',   border: 'border-orange/30'  },
  CRITICAL: { text: 'text-danger',  bg: 'bg-danger/10',   border: 'border-danger/30'  },
};

export const SEVERITY_LABEL: Record<string, string> = {
  NONE: 'No Threat', LOW: 'Low Risk', MEDIUM: 'Medium Risk', HIGH: 'High Risk', CRITICAL: 'Critical',
};

// ─── Timeline builder (Phase 4.3) ────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'DNA_GENERATED' | 'ENCRYPTED' | 'VAULT_STORED' | 'COMPARED' | 'CERTIFICATE';
  title: string;
  detail: string;
  icon: string;
  color: string;
  relatedId?: string;
}

export interface FileTimeline {
  filename: string;
  fileType: string;
  dnaRecordId: string;
  vaultId?: string;
  events: TimelineEvent[];
}
