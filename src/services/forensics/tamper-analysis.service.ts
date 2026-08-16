/**
 * Fault-tolerant tamper analysis — every detector always initialized.
 * Never mutates undefined; never throws to callers.
 * Produces a human-readable changesVsOriginal inventory (crop / compress / text / etc.).
 */
import { logger } from '../../lib/logger';
import { tamperClassifierService } from './tamper-classifier.service';
import type { DnaComparisonResult } from '../../types/comparison.types';
import type { TamperAnalysisSection, TamperChangeItem } from '../../types/unified-investigation.types';
import type { LeakedFileVerifyResult } from './leaked-file-verify.service';

export interface TamperDetectorResult {
  detector: string;
  detected: boolean;
  confidence: number;
  score: number;
  evidence: string[];
  where?: string;
  success: boolean;
  error?: string;
}

/** All forensic tamper detectors — fixed registry, never dynamic find() */
export const TAMPER_DETECTOR_NAMES = [
  'Compression',
  'Crop',
  'Resize',
  'Rotation',
  'Screenshot',
  'Screen Recording',
  'Metadata Removed',
  'OCR Changes',
  'AI Editing',
  'AI Enhancement',
  'AI Generated',
  'Watermark Damage',
  'Video Re-encoding',
  'Audio Re-encoding',
  'Blur',
  'Contrast / Brightness',
  'Color Filters',
  'Format Conversion',
  'Sharpen',
  'Text / Letter Mismatch',
] as const;

export type TamperDetectorName = (typeof TAMPER_DETECTOR_NAMES)[number];

const DOCUMENT_MIME_HINT =
  /pdf|word|document|spreadsheet|presentation|text\/plain|csv|json/i;

function isDocumentProbe(mimeType?: string, filename?: string): boolean {
  if (mimeType && DOCUMENT_MIME_HINT.test(mimeType)) return true;
  if (filename && /\.(pdf|docx?|pptx?|xlsx?|txt|csv|json)$/i.test(filename)) return true;
  return false;
}

function emptyDetector(name: TamperDetectorName): TamperDetectorResult {
  return {
    detector: name,
    detected: false,
    confidence: 0,
    score: 0,
    evidence: [],
    success: true,
  };
}

function createRegistry(): Map<TamperDetectorName, TamperDetectorResult> {
  const map = new Map<TamperDetectorName, TamperDetectorResult>();
  for (const name of TAMPER_DETECTOR_NAMES) {
    map.set(name, emptyDetector(name));
  }
  return map;
}

function setDetected(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  name: TamperDetectorName,
  opts: { confidence?: number; score?: number; evidence?: string[]; where?: string },
): void {
  const entry = registry.get(name);
  if (!entry) {
    logger.warn('[TamperAnalysis] Unknown detector key', { name });
    return;
  }
  registry.set(name, {
    ...entry,
    detected: true,
    confidence: opts.confidence ?? Math.max(entry.confidence, 50),
    score: opts.score ?? Math.max(entry.score, 50),
    evidence: [...entry.evidence, ...(opts.evidence ?? [])],
    where: opts.where ?? entry.where,
    success: true,
  });
}

function markFailed(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  name: TamperDetectorName,
  error: string,
): void {
  const entry = registry.get(name) ?? emptyDetector(name);
  registry.set(name, {
    ...entry,
    success: false,
    error,
    confidence: 0,
    score: 0,
  });
}

function applyLeakSignals(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  leakVerify: LeakedFileVerifyResult,
): void {
  if (leakVerify.leakVector === 'SCREENSHOT') {
    setDetected(registry, 'Screenshot', {
      confidence: 70,
      evidence: ['Leak vector: screenshot capture'],
      where: 'Full-frame capture of a screen or share viewer',
    });
  }
  if (leakVerify.leakVector === 'RECORDING') {
    setDetected(registry, 'Screen Recording', {
      confidence: 70,
      evidence: ['Leak vector: screen recording'],
      where: 'Video frames from a screen capture',
    });
  }
  if (leakVerify.tampered) {
    setDetected(registry, 'Format Conversion', {
      confidence: 45,
      evidence: ['Leak verify flagged file as modified from protected original'],
      where: 'File bytes / container format vs vault original',
    });
  }
  if (leakVerify.tampered && leakVerify.watermark) {
    setDetected(registry, 'Watermark Damage', {
      confidence: 65,
      evidence: ['Watermark present but damaged or incomplete'],
      where: 'Invisible / visible watermark payload',
    });
  }
}

function applyLayerSignals(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  comparison: DnaComparisonResult,
  opts?: { mimeType?: string; filename?: string },
): void {
  const layers = comparison.layerComparisons ?? [];
  const l1 = layers.find((l) => l.layer === 1);
  const l2 = layers.find((l) => l.layer === 2);
  const l3 = layers.find((l) => l.layer === 3);
  const l4 = layers.find((l) => l.layer === 4);
  const l5 = layers.find((l) => l.layer === 5);
  const l11 = layers.find((l) => l.layer === 11);
  const isDoc = isDocumentProbe(
    opts?.mimeType ?? comparison.fileB?.mimeType,
    opts?.filename ?? comparison.fileB?.filename,
  );

  const sizeA = comparison.fileA?.sizeBytes;
  const sizeB = comparison.fileB?.sizeBytes;
  const sizeDrop =
    typeof sizeA === 'number' && typeof sizeB === 'number' && sizeA > 0
      ? Math.round((1 - sizeB / sizeA) * 100)
      : null;

  // Documents / PDF: text letter edits show up on perceptual (text SimHash) + semantic layers
  if (isDoc && l3 && l3.changed && l3.similarityPercent < 98) {
    setDetected(registry, 'Text / Letter Mismatch', {
      confidence: Math.min(95, Math.max(55, 100 - l3.similarityPercent)),
      score: 100 - l3.similarityPercent,
      evidence: [
        `Document text DNA (L3) ${l3.similarityPercent}% vs original`,
        l3.changeDescription || 'Extracted text differs from vault PDF/DOC',
      ],
      where: 'Document body text (letter / word level)',
    });
    setDetected(registry, 'OCR Changes', {
      confidence: Math.min(90, Math.max(50, 100 - l3.similarityPercent)),
      score: 100 - l3.similarityPercent,
      evidence: [l3.changeDescription || `Text layer similarity ${l3.similarityPercent}%`],
      where: 'OCR / extracted text stream',
    });
  }

  if (isDoc && l4 && l4.changed && l4.similarityPercent < 95) {
    setDetected(registry, 'Text / Letter Mismatch', {
      confidence: Math.min(90, Math.max(50, 100 - l4.similarityPercent)),
      evidence: [
        `Semantic text DNA (L4) ${l4.similarityPercent}%`,
        l4.changeDescription || 'Word distribution / language fingerprint drifted',
      ],
      where: 'Document semantics (keywords / density)',
    });
  }

  if (l1?.changed && l3 && l3.similarityPercent >= 55 && l3.similarityPercent < 99) {
    const whatsAppLike = /whatsapp/i.test(opts?.filename ?? '');
    setDetected(registry, 'Compression', {
      confidence: sizeDrop != null && sizeDrop > 5 ? 78 : (whatsAppLike ? 72 : 60),
      score: 100 - l3.similarityPercent,
      evidence: [
        `Bytes changed (L1) while visual/text content still ${l3.similarityPercent}% similar`,
        sizeDrop != null ? `File size ${sizeDrop > 0 ? `down ${sizeDrop}%` : `up ${Math.abs(sizeDrop)}%`}` : 'Size delta unavailable',
        whatsAppLike ? 'Filename indicates WhatsApp re-encode' : (l3.changeDescription || 'Re-encode / compress likely'),
      ],
      where: sizeDrop != null && sizeDrop > 0
        ? `Compressed payload (~${sizeDrop}% smaller than original)`
        : 'File encoding / quality (content mostly intact)',
    });
  }

  if (!isDoc && l3 && l3.similarityPercent >= 55 && l3.similarityPercent < 85) {
    setDetected(registry, 'Crop', {
      confidence: Math.min(90, Math.max(60, 100 - l3.similarityPercent + 15)),
      score: 100 - l3.similarityPercent,
      evidence: [
        `Perceptual DNA (L3) ${l3.similarityPercent}% — partial frame match`,
        l3.changeDescription || 'Likely crop or partial clip of original',
      ],
      where: 'Visible image region vs full original frame',
    });
    setDetected(registry, 'Resize', {
      confidence: 52,
      score: 52,
      evidence: [`Possible scale change accompanying crop (L3 ${l3.similarityPercent}%)`],
      where: 'Pixel dimensions / aspect vs original',
    });
  }

  if (!isDoc && l2 && l2.changed && l2.similarityPercent < 80 && l3 && l3.similarityPercent >= 70) {
    setDetected(registry, 'Crop', {
      confidence: Math.max(55, 100 - l2.similarityPercent),
      evidence: [
        `Structural DNA (L2) ${l2.similarityPercent}% — layout/edges changed`,
        l2.changeDescription || 'Structure drift often indicates crop or rotation',
      ],
      where: 'Image structure / edge layout',
    });
  }

  // Screenshot: do NOT auto-fire on every mid-band crop
  if (!isDoc && l3 && l3.similarityPercent < 50 && l3.similarityPercent >= 20) {
    setDetected(registry, 'Screenshot', {
      confidence: 55,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}% — capture degradation`],
      where: 'Possible screen capture of the original',
    });
  }

  if (!isDoc && l3 && l3.similarityPercent >= 78 && l3.similarityPercent < 92
    && !(l3.similarityPercent >= 55 && l3.similarityPercent < 85)) {
    setDetected(registry, 'Sharpen', {
      confidence: 40,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}%`],
      where: 'Pixel-level enhancement vs original',
    });
  }

  if (l5?.changed && !l1?.changed) {
    setDetected(registry, 'Metadata Removed', {
      confidence: 70,
      score: 60,
      evidence: ['L5 metadata changed without cryptographic (L1) change'],
      where: 'EXIF / PDF producer / author fields',
    });
  } else if (l5?.changed) {
    setDetected(registry, 'Metadata Removed', {
      confidence: 55,
      score: 50,
      evidence: [l5.changeDescription || `Metadata similarity ${l5.similarityPercent}%`],
      where: 'File metadata (author, dates, software)',
    });
  }

  // AI: NEVER confirm from crop/resize/compress alone
  const cropOrResize = !!registry.get('Crop')?.detected || !!registry.get('Resize')?.detected
    || !!registry.get('Compression')?.detected;
  if (!isDoc && l11 && l11.similarityPercent < 40 && !cropOrResize) {
    setDetected(registry, 'AI Enhancement', {
      confidence: Math.min(75, Math.max(55, 100 - l11.similarityPercent)),
      score: 100 - l11.similarityPercent,
      evidence: [`L11 deepfake layer ${l11.similarityPercent}% — not explained by crop/compress`],
      where: 'AI-processed pixels / generative edit traces',
    });
    if (l11.similarityPercent < 25) {
      setDetected(registry, 'AI Generated', {
        confidence: Math.min(80, Math.max(60, 100 - l11.similarityPercent)),
        score: 100 - l11.similarityPercent,
        evidence: [`L11 deepfake ${l11.similarityPercent}%`],
        where: 'Synthetic / heavily AI-rewritten content',
      });
    }
  }

  const ocrLayer = layers.find((l) => /ocr/i.test(l.name) && l.changed && l.similarityPercent < 90);
  if (ocrLayer) {
    setDetected(registry, 'OCR Changes', {
      confidence: Math.max(50, 100 - ocrLayer.similarityPercent),
      evidence: [ocrLayer.changeDescription || `OCR similarity ${ocrLayer.similarityPercent}%`],
      where: 'Visible text extracted from image/document',
    });
  }
}

const HUMAN_DETAIL: Record<string, string> = {
  Compression: 'File was re-encoded or compressed — content looks similar but bytes differ from original.',
  Crop: 'Part of the original frame is missing — probe appears cropped or clipped.',
  Resize: 'Dimensions differ from the vault original (scaled up/down).',
  Rotation: 'Image orientation differs from the registered original.',
  Screenshot: 'Probe looks like a screen capture of the original (not a direct file copy).',
  'Screen Recording': 'Probe appears to come from a recorded screen session.',
  'Metadata Removed': 'Author / EXIF / PDF producer metadata was stripped or altered.',
  'OCR Changes': 'Readable text differs from the original (OCR / text DNA mismatch).',
  'Text / Letter Mismatch': 'Letters or words in the document body differ from the vault original.',
  'AI Editing': 'Signals suggest AI-assisted edits on the probe.',
  'AI Enhancement': 'Upscale / enhancement traces differ from the original file.',
  'AI Generated': 'Strong generative / synthetic content signals.',
  'Watermark Damage': 'PINIT watermark is damaged, partial, or stripped.',
  'Video Re-encoding': 'Video container or codec differs from the original export.',
  'Audio Re-encoding': 'Audio stream was re-encoded relative to the original.',
  Blur: 'Blur or soft-focus differs from the original.',
  'Contrast / Brightness': 'Brightness or contrast was adjusted.',
  'Color Filters': 'Color grading / filters differ from the original.',
  'Format Conversion': 'File format or container converted (e.g. PNG→JPEG, DOCX→PDF).',
  Sharpen: 'Sharpening or edge enhancement applied after the original.',
};

function buildChangesInventory(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  primaryVector: string,
): TamperChangeItem[] {
  const items: TamperChangeItem[] = [];
  for (const name of TAMPER_DETECTOR_NAMES) {
    const d = registry.get(name);
    if (!d?.detected) continue;
    items.push({
      type: d.detector,
      detected: true,
      confidence: d.confidence,
      detail: d.evidence[0] || HUMAN_DETAIL[name] || `${name} detected`,
      where: d.where,
    });
  }

  // Always surface primary vector as first bullet if somehow missing
  if (items.length === 0 && primaryVector && primaryVector !== 'NONE' && primaryVector !== 'EXACT_COPY') {
    items.push({
      type: primaryVector.replace(/_/g, ' '),
      detected: true,
      confidence: 50,
      detail: HUMAN_DETAIL[primaryVector.replace(/_/g, ' ')]
        || `${primaryVector.replace(/_/g, ' ')} — differs from vault original`,
      where: 'DNA layer pattern classification',
    });
  }

  // Highest confidence first
  items.sort((a, b) => b.confidence - a.confidence);
  return items;
}

function registryToSection(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  primaryVector: string,
  overallTamperScore: number,
  description: string,
): TamperAnalysisSection {
  const vectors = TAMPER_DETECTOR_NAMES.map((name) => {
    const d = registry.get(name) ?? emptyDetector(name);
    return {
      label: d.detector,
      detected: d.detected,
      confidence: d.success ? d.confidence : 0,
      evidence: d.evidence.length ? d.evidence : undefined,
    };
  });

  const failedCount = [...registry.values()].filter((d) => !d.success).length;
  const desc = failedCount > 0
    ? `${description}${description ? ' · ' : ''}${failedCount} detector(s) returned UNKNOWN`
    : description;

  return {
    primaryVector: primaryVector || 'NONE',
    overallTamperScore,
    vectors,
    description: desc || 'Tamper analysis complete',
    changesVsOriginal: buildChangesInventory(registry, primaryVector),
  };
}

export interface BuildTamperAnalysisInput {
  comparison: DnaComparisonResult | null;
  leakVerify: LeakedFileVerifyResult;
  mimeType?: string;
  filename?: string;
  /** Phase 2 — optional Mode A spatial localization summary (additive) */
  spatialAuthBlockLocalization?: Record<string, unknown> | null;
  /** Phase 3C — hierarchical investigation (visualization only) */
  spatialAuthInvestigation?: Record<string, unknown> | null;
  /** Phase 4B–4E hierarchy summary for Investigate JSON */
  spatialHierarchy?: Record<string, unknown> | null;
}

/**
 * Build tamper analysis — never throws; all detectors always present.
 */
export function buildTamperAnalysis(input: BuildTamperAnalysisInput): TamperAnalysisSection {
  const registry = createRegistry();

  try {
    if (input.leakVerify) {
      applyLeakSignals(registry, input.leakVerify);
    }
  } catch (e) {
    logger.warn('[TamperAnalysis] Leak signal pass failed', { error: String(e) });
    markFailed(registry, 'Screenshot', String(e));
  }

  try {
    if (input.comparison?.layerComparisons?.length) {
      applyLayerSignals(registry, input.comparison, {
        mimeType: input.mimeType,
        filename: input.filename,
      });
    }
  } catch (e) {
    logger.warn('[TamperAnalysis] Layer signal pass failed', { error: String(e) });
    markFailed(registry, 'Compression', String(e));
  }

  let primaryVector = 'NONE';
  let overallTamperScore = 10;
  let description = 'No significant tampering detected';

  try {
    if (input.comparison?.layerComparisons?.length) {
      const inputs = input.comparison.layerComparisons.slice(0, 6).map((l) => ({
        layer: l.name,
        score: l.similarityScore ?? l.similarityPercent / 100,
        weight: 0.15,
        passed: l.matched,
      }));
      const t = tamperClassifierService.classify(inputs);
      primaryVector = t.primaryVector ?? 'NONE';
      overallTamperScore = t.tamperConfidence ?? 10;
      description = t.description ?? description;

      // Prefer document text primary when letter mismatch is strong
      const textHit = registry.get('Text / Letter Mismatch');
      if (textHit?.detected && textHit.confidence >= 60) {
        primaryVector = 'TEXT_LETTER_MISMATCH';
        overallTamperScore = Math.max(overallTamperScore, textHit.confidence);
        description = `Text / letter changes detected vs vault original (${textHit.confidence}% confidence). ${textHit.evidence[0] ?? ''}`;
      }
    } else if (input.leakVerify?.tampered) {
      primaryVector = 'COPY_PASTE';
      overallTamperScore = 55;
      description = 'File modified from protected original';
    }
  } catch (e) {
    logger.warn('[TamperAnalysis] Classifier failed', { error: String(e) });
    primaryVector = 'UNKNOWN';
    overallTamperScore = 0;
    description = 'Tamper classification unavailable — partial detector results retained';
  }

  // Prefer detector-backed modification inventory over generic classifier text
  const inventoryDescription = formatModificationSummary(registry);
  if (inventoryDescription) {
    description = inventoryDescription;
  }

  // Additive Phase 2 hint in description only when localization available (no edit-op claim)
  const spatial = input.spatialAuthBlockLocalization;
  if (spatial && spatial['available'] === true && typeof spatial['pattern'] === 'object' && spatial['pattern']) {
    const pattern = spatial['pattern'] as { summary?: string };
    if (pattern.summary) {
      description = `${description}${description ? ' · ' : ''}${pattern.summary}`;
    }
  }

  const section = registryToSection(registry, primaryVector, overallTamperScore, description);
  if (input.spatialAuthBlockLocalization !== undefined) {
    section.spatialAuthBlockLocalization = input.spatialAuthBlockLocalization;
  }
  if (input.spatialAuthInvestigation !== undefined) {
    section.spatialAuthInvestigation = input.spatialAuthInvestigation;
  }
  return section;
}

/** Human inventory: Confirmed / Possible / Not confirmed — per-detector, no AI-from-crop. */
function formatModificationSummary(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
): string | null {
  const confirmed: string[] = [];
  const possible: string[] = [];
  const notConfirmedNames = ['AI Generated', 'AI Enhancement', 'AI Editing'] as const;

  for (const name of ['Crop', 'Resize', 'Compression', 'Screenshot', 'Metadata Removed', 'Watermark Damage'] as TamperDetectorName[]) {
    const d = registry.get(name);
    if (!d?.detected) continue;
    if (d.confidence >= 60) confirmed.push(`✓ ${name} (${d.confidence}%)`);
    else possible.push(`• ${name} (${d.confidence}%)`);
  }

  const aiNot = notConfirmedNames
    .filter((n) => !registry.get(n)?.detected)
    .map((n) => `• ${n}`);

  if (!confirmed.length && !possible.length) return null;

  const parts: string[] = ['Detected modifications:'];
  if (confirmed.length) parts.push(confirmed.join(' · '));
  if (possible.length) parts.push(`Possible: ${possible.join(' · ')}`);
  if (aiNot.length) parts.push(`Not confirmed: ${aiNot.join(' · ')}`);
  return parts.join(' ');
}

/** Safe fallback when entire tamper stage fails */
export function emptyTamperAnalysis(reason?: string): TamperAnalysisSection {
  const registry = createRegistry();
  return registryToSection(
    registry,
    'UNKNOWN',
    0,
    reason ?? 'Tamper analysis unavailable',
  );
}

/**
 * When deep DNA times out but live retrieval already proved a vault lead
 * (high ORB + mid similarity = classic crop / WhatsApp recompress),
 * synthesize an honest Crop/Compression inventory instead of UNKNOWN + timeout text.
 */
export function buildLiveLeadTamperAnalysis(input: {
  orbScore?: number | null;
  similarityScore?: number | null;
  confidence?: number | null;
  patchVotes?: number | null;
  timedOut?: boolean;
  originalHash?: string | null;
  currentHash?: string | null;
}): TamperAnalysisSection {
  const registry = createRegistry();
  const orb = input.orbScore ?? 0;
  const sim = input.similarityScore ?? input.confidence ?? 0;
  const patches = input.patchVotes ?? 0;
  const hashDiff = !!input.originalHash && !!input.currentHash
    && input.originalHash.toLowerCase() !== input.currentHash.toLowerCase();

  // High feature match + incomplete frame → crop / partial clip
  if (orb >= 70 || patches >= 3 || (sim >= 45 && sim < 92)) {
    setDetected(registry, 'Crop', {
      confidence: Math.min(90, Math.max(55, Math.round(orb || sim))),
      score: Math.max(40, 100 - Math.round(sim)),
      evidence: [
        orb > 0 ? `ORB feature match ${Math.round(orb)}%` : null,
        sim > 0 ? `Visual similarity ${Math.round(sim)}% (not exact frame)` : null,
        patches > 0 ? `${patches} local patch matches` : null,
        'Frame is incomplete vs vault original — crop / WhatsApp crop likely',
      ].filter(Boolean) as string[],
      where: 'Visible image region vs full vault original',
    });
  }

  // Mid similarity with fingerprint persistence → re-encode / WhatsApp compress
  if (sim >= 40 && sim < 95) {
    setDetected(registry, 'Compression', {
      confidence: Math.min(85, Math.max(50, Math.round(100 - sim + 20))),
      score: Math.max(30, 100 - Math.round(sim)),
      evidence: [
        `Similarity ${Math.round(sim)}% with feature match — typical of JPEG recompress`,
        'WhatsApp / messenger re-encode common for this pattern',
      ],
      where: 'File encoding / quality vs vault original bytes',
    });
  }

  if (sim >= 40 && sim < 85 && orb >= 60) {
    setDetected(registry, 'Resize', {
      confidence: 55,
      evidence: ['Dimensions likely altered with crop'],
      where: 'Pixel dimensions vs vault original',
    });
  }

  // High visual match but byte hash differs — honest minimal-derivative signal (not UNKNOWN).
  if (sim >= 92 && hashDiff) {
    setDetected(registry, 'Format Conversion', {
      confidence: Math.min(88, Math.max(45, Math.round(100 - sim + 12))),
      evidence: [
        `Visual match ${Math.round(sim)}% with SHA-256 mismatch vs vault original`,
        'Typical of re-encode, export, or metadata shift while content stays near-identical',
      ],
      where: 'File bytes / container vs vault SHA-256',
    });
  }

  const detected = [...registry.values()].filter((d) => d.detected);
  let primaryVector = detected.some((d) => d.detector === 'Crop')
    ? 'CROP'
    : detected.some((d) => d.detector === 'Compression')
      ? 'COMPRESSION'
      : detected.some((d) => d.detector === 'Format Conversion')
        ? 'MINIMAL_DERIVATIVE'
        : detected.length
          ? 'PARTIAL_CLIP'
          : 'NONE';

  if (sim >= 98 && !hashDiff && detected.length === 0) {
    primaryVector = 'NONE';
  } else if (sim >= 92 && hashDiff && primaryVector === 'NONE') {
    primaryVector = 'MINIMAL_DERIVATIVE';
  } else if (!detected.length && primaryVector === 'NONE' && input.timedOut && sim >= 85) {
    primaryVector = hashDiff ? 'MINIMAL_DERIVATIVE' : 'NONE';
  }

  const overallTamperScore = detected.length
    ? Math.min(85, Math.max(
      primaryVector === 'MINIMAL_DERIVATIVE' ? 8 : 45,
      Math.round(100 - (sim || 50) + 15),
    ))
    : (primaryVector === 'MINIMAL_DERIVATIVE' ? Math.max(5, Math.round(100 - sim)) : 0);

  const description = detected.length
    ? (primaryVector === 'MINIMAL_DERIVATIVE'
      ? `Near-identical derivative of vault original (${Math.round(sim)}% visual match, bytes differ).`
      : `Cropped / recompressed derivative of vault original`)
      + (input.timedOut ? ' (deep DNA still settling — based on live ORB/similarity).' : '.')
    : (primaryVector === 'MINIMAL_DERIVATIVE'
      ? `Minimal byte-level derivative — ${Math.round(sim)}% visual match, hash differs from vault original.`
      : input.timedOut && sim >= 85
        ? `High-confidence match (${Math.round(sim)}%) — no significant crop/compress detected; deep DNA inventory incomplete.`
        : 'No significant tampering signals from live retrieval.');

  return registryToSection(registry, primaryVector, overallTamperScore, description);
}
