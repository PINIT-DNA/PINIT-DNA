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
import type { FragmentReuseFinding } from '../../types/unified-investigation.types';

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
  'Spliced Fragment',
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
  'Spliced Fragment': 'A small region of a protected original appears composited into this otherwise-unrelated image.',
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

export function enrichTamperFromPixelSource(
  section: TamperAnalysisSection,
  pixelSource?: {
    transformation?: { labels?: string[]; rotationDeg?: number | null; scale?: number | null };
  } | null,
): TamperAnalysisSection {
  const labels = pixelSource?.transformation?.labels ?? [];
  const rot = Math.abs(Number(pixelSource?.transformation?.rotationDeg ?? 0));
  const rotated = labels.includes('rotation') || rot >= 45;
  const bright = labels.includes('brightness') || labels.includes('contrast');
  const blurred = labels.includes('blur');
  const sharpened = labels.includes('sharpen');
  if (!rotated && !bright && !blurred && !sharpened) return section;

  let vectors = section.vectors;
  const changes = [...(section.changesVsOriginal ?? [])];
  let primaryVector = section.primaryVector;
  let overallTamperScore = section.overallTamperScore ?? 0;

  if (rotated) {
    const deg = Math.round(rot) || 90;
    vectors = vectors.map((v) =>
      v.label === 'Rotation'
        ? {
            ...v,
            detected: true,
            confidence: Math.max(v.confidence ?? 0, 82),
            evidence: [`Protected region rotated ~${deg}° vs vault original`],
          }
        : v,
    );
    if (!changes.some((c) => /rotation/i.test(String(c.type)))) {
      changes.unshift({
        type: 'Rotation',
        detected: true,
        confidence: 82,
        detail: `Protected region rotated ~${deg}° before insertion.`,
        where: 'Pasted vault region vs enrolled original',
      });
    }
    if (primaryVector === 'NONE' || primaryVector === 'UNKNOWN') primaryVector = 'ROTATION';
    overallTamperScore = Math.max(overallTamperScore, 70);
  }

  if (bright) {
    const kind =
      labels.includes('brightness') && labels.includes('contrast')
        ? 'Brightness and contrast'
        : labels.includes('contrast')
          ? 'Contrast'
          : 'Brightness';
    vectors = vectors.map((v) =>
      v.label === 'Contrast / Brightness'
        ? {
            ...v,
            detected: true,
            confidence: Math.max(v.confidence ?? 0, 72),
            evidence: [`${kind} shift vs vault original`],
          }
        : v,
    );
    if (!changes.some((c) => /brightness|contrast/i.test(String(c.type)))) {
      changes.unshift({
        type: 'Contrast / Brightness',
        detected: true,
        confidence: 72,
        detail: `${kind} was adjusted; source correspondence may still remain.`,
        where: 'Global photometric shift vs vault original',
      });
    }
    if (primaryVector === 'NONE' || primaryVector === 'UNKNOWN') primaryVector = 'PHOTOMETRIC';
    overallTamperScore = Math.max(overallTamperScore, 55);
  }

  if (blurred) {
    vectors = vectors.map((v) =>
      v.label === 'Blur'
        ? {
            ...v,
            detected: true,
            confidence: Math.max(v.confidence ?? 0, 76),
            evidence: ['Upload is softer than the vault original (edge energy dropped)'],
          }
        : v,
    );
    if (!changes.some((c) => /^blur$/i.test(String(c.type)))) {
      changes.unshift({
        type: 'Blur',
        detected: true,
        confidence: 76,
        detail: 'Image is blurred relative to the enrolled original.',
        where: 'Global edge sharpness vs vault original',
      });
    }
    if (primaryVector === 'NONE' || primaryVector === 'UNKNOWN') primaryVector = 'BLUR';
    overallTamperScore = Math.max(overallTamperScore, 60);
  }

  if (sharpened) {
    vectors = vectors.map((v) =>
      v.label === 'Sharpen'
        ? {
            ...v,
            detected: true,
            confidence: Math.max(v.confidence ?? 0, 70),
            evidence: ['Upload is sharper than the vault original (edge energy increased)'],
          }
        : v,
    );
    if (!changes.some((c) => /sharpen/i.test(String(c.type)))) {
      changes.unshift({
        type: 'Sharpen',
        detected: true,
        confidence: 70,
        detail: 'Sharpening or edge enhancement vs the enrolled original.',
        where: 'Global edge sharpness vs vault original',
      });
    }
    overallTamperScore = Math.max(overallTamperScore, 55);
  }

  return {
    ...section,
    vectors,
    changesVsOriginal: changes,
    primaryVector,
    overallTamperScore,
  };
}

export interface PhotometricShift {
  meanDelta: number;
  contrastRatio: number;
  /** Probe Laplacian variance / vault (1 = same sharpness). */
  laplacianRatio: number;
}

export function photometricLooksAdjusted(photo: PhotometricShift | null | undefined): boolean {
  if (!photo) return false;
  return Math.abs(photo.meanDelta) >= 6
    || photo.contrastRatio >= 1.18
    || photo.contrastRatio <= 0.85;
}

export function blurLooksApplied(photo: PhotometricShift | null | undefined): boolean {
  return Boolean(photo && photo.laplacianRatio > 0 && photo.laplacianRatio <= 0.70);
}

export function sharpenLooksApplied(photo: PhotometricShift | null | undefined): boolean {
  return Boolean(photo && photo.laplacianRatio >= 1.40);
}

/** Labels for pixel-source enrich (brightness / blur / sharpen). */
export function appearanceTransformLabels(photo: PhotometricShift | null | undefined): string[] {
  if (!photo) return [];
  const labels: string[] = [];
  if (Math.abs(photo.meanDelta) >= 6) labels.push('brightness');
  if (photo.contrastRatio >= 1.18 || photo.contrastRatio <= 0.85) labels.push('contrast');
  if (blurLooksApplied(photo)) labels.push('blur');
  if (sharpenLooksApplied(photo)) labels.push('sharpen');
  return labels;
}

function laplacianVariance(luma: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = luma[i - width]! + luma[i + width]! + luma[i - 1]! + luma[i + 1]! - 4 * luma[i]!;
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (count < 16) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

/** Downscale both frames and compare mean luma / contrast / edge energy. */
export async function measurePhotometricShift(
  probeBuffer: Buffer,
  vaultBuffer: Buffer,
): Promise<PhotometricShift | null> {
  try {
    const sharp = (await import('sharp')).default;
    const opts = { fit: 'fill' as const, width: 256, height: 256 };
    const [probe, vault] = await Promise.all([
      sharp(probeBuffer).rotate().resize(opts).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(vaultBuffer).rotate().resize(opts).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    const w = Math.min(probe.info.width, vault.info.width);
    const h = Math.min(probe.info.height, vault.info.height);
    const n = w * h;
    if (n < 256) return null;
    const pLuma = new Float32Array(n);
    const vLuma = new Float32Array(n);
    let pSum = 0;
    let vSum = 0;
    let pSq = 0;
    let vSq = 0;
    const pStride = probe.info.width;
    const vStride = vault.info.width;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const po = (y * pStride + x) * 3;
        const vo = (y * vStride + x) * 3;
        const py = 0.299 * probe.data[po]! + 0.587 * probe.data[po + 1]! + 0.114 * probe.data[po + 2]!;
        const vy = 0.299 * vault.data[vo]! + 0.587 * vault.data[vo + 1]! + 0.114 * vault.data[vo + 2]!;
        pLuma[i] = py;
        vLuma[i] = vy;
        pSum += py;
        vSum += vy;
        pSq += py * py;
        vSq += vy * vy;
      }
    }
    const pMean = pSum / n;
    const vMean = vSum / n;
    const pStd = Math.sqrt(Math.max(0, pSq / n - pMean * pMean));
    const vStd = Math.max(Math.sqrt(Math.max(0, vSq / n - vMean * vMean)), 1e-3);
    const vLap = Math.max(laplacianVariance(vLuma, w, h), 1e-6);
    const pLap = laplacianVariance(pLuma, w, h);
    return {
      meanDelta: Math.round((pMean - vMean) * 100) / 100,
      contrastRatio: Math.round((pStd / vStd) * 1000) / 1000,
      laplacianRatio: Math.round((pLap / vLap) * 1000) / 1000,
    };
  } catch {
    return null;
  }
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
  /** Small-fragment reuse / splice candidates from fragment-splice-detector.service.ts */
  fragmentReuse?: FragmentReuseFinding[] | null;
  /** Actual pixel dimensions of probe vs vault original, when both were retrievable */
  dimensions?: { probeWidth: number; probeHeight: number; vaultWidth: number; vaultHeight: number } | null;
  /** Global brightness/contrast vs vault original (same-frame photometric). */
  photometric?: PhotometricShift | null;
}

/**
 * Resize is otherwise only ever set as a side effect of Crop detection (mid-band
 * perceptual similarity), so a pure resize with no crop — same content, different
 * dimensions, still ~full-frame similar — was never flagged on its own. This checks
 * actual pixel dimensions directly, independent of the crop heuristic.
 */
function applyDimensionSignal(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  dims: BuildTamperAnalysisInput['dimensions'],
): void {
  if (!dims) return;
  const { probeWidth, probeHeight, vaultWidth, vaultHeight } = dims;
  if (probeWidth === vaultWidth && probeHeight === vaultHeight) return;

  const probeRatio = probeWidth / probeHeight;
  const vaultRatio = vaultWidth / vaultHeight;
  const aspectDelta = Math.abs(probeRatio - vaultRatio) / vaultRatio;
  const scaleFactor = Math.sqrt((probeWidth * probeHeight) / (vaultWidth * vaultHeight));
  const pctChange = Math.round(Math.abs(1 - scaleFactor) * 100);

  setDetected(registry, 'Resize', {
    confidence: aspectDelta < 0.03 ? 75 : 55,
    score: pctChange,
    evidence: [
      `Vault original ${vaultWidth}×${vaultHeight} → probe ${probeWidth}×${probeHeight}`,
      aspectDelta < 0.03
        ? `Same aspect ratio, ${pctChange}% ${scaleFactor < 1 ? 'smaller' : 'larger'} — pure resize`
        : 'Aspect ratio also changed — resize combined with crop/reframe',
    ],
    where: 'Pixel dimensions vs vault original',
  });
}

function sameFrameForAppearance(dims?: BuildTamperAnalysisInput['dimensions']): boolean {
  if (!dims) return true;
  const probeArea = dims.probeWidth * dims.probeHeight;
  const vaultArea = dims.vaultWidth * dims.vaultHeight;
  // Skip only collage hosts (probe much larger than vault). Crops may still be blurred.
  return !(probeArea > vaultArea * 1.35);
}

function applyPhotometricSignal(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  photo: PhotometricShift | null | undefined,
  dims?: BuildTamperAnalysisInput['dimensions'],
): void {
  if (!photometricLooksAdjusted(photo) || !photo) return;
  if (!sameFrameForAppearance(dims)) return;
  const kind = Math.abs(photo.meanDelta) >= 6 && (photo.contrastRatio >= 1.18 || photo.contrastRatio <= 0.85)
    ? 'Brightness and contrast'
    : Math.abs(photo.meanDelta) >= 6
      ? 'Brightness'
      : 'Contrast';
  const signed = photo.meanDelta >= 0 ? `+${photo.meanDelta.toFixed(1)}` : photo.meanDelta.toFixed(1);
  setDetected(registry, 'Contrast / Brightness', {
    confidence: 74,
    score: Math.min(90, Math.round(Math.abs(photo.meanDelta) * 3)),
    evidence: [`${kind} shift vs vault original (mean luma ${signed}, contrast ×${photo.contrastRatio})`],
    where: 'Global photometric shift vs vault original',
  });
}

function applyFocusSignal(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  photo: PhotometricShift | null | undefined,
  dims?: BuildTamperAnalysisInput['dimensions'],
): void {
  if (!photo || !sameFrameForAppearance(dims)) return;
  if (blurLooksApplied(photo)) {
    const pct = Math.round((1 - photo.laplacianRatio) * 100);
    setDetected(registry, 'Blur', {
      confidence: Math.min(90, Math.max(68, pct)),
      score: pct,
      evidence: [`Edge sharpness ${Math.round(photo.laplacianRatio * 100)}% of vault original — blur / soft focus`],
      where: 'Global Laplacian focus vs vault original',
    });
  } else if (sharpenLooksApplied(photo)) {
    const pct = Math.round((photo.laplacianRatio - 1) * 100);
    setDetected(registry, 'Sharpen', {
      confidence: Math.min(88, Math.max(62, pct)),
      score: pct,
      evidence: [`Edge energy ${photo.laplacianRatio.toFixed(2)}× vault original — sharpening`],
      where: 'Global Laplacian focus vs vault original',
    });
  }
}

function applyFragmentReuseSignal(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  findings: FragmentReuseFinding[] | null | undefined,
): void {
  if (!findings?.length) return;
  const top = findings[0]!;
  if (top.confidence < 50) return;
  setDetected(registry, 'Spliced Fragment', {
    confidence: top.confidence,
    score: top.confidence,
    evidence: [
      `${top.patchMatchCount} matching patches from a protected original found in a localized region of this image`,
      `Matched region: ~${Math.round(top.probeRegion.xPercent)}%,${Math.round(top.probeRegion.yPercent)}% of the image (~${Math.round(top.probeRegion.widthPercent)}%×${Math.round(top.probeRegion.heightPercent)}%)`,
    ],
    where: `Localized region at ~${Math.round(top.probeRegion.xPercent)}%,${Math.round(top.probeRegion.yPercent)}% of the uploaded image`,
  });
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

  try {
    applyDimensionSignal(registry, input.dimensions);
  } catch (e) {
    logger.warn('[TamperAnalysis] Dimension signal pass failed', { error: String(e) });
  }

  try {
    applyPhotometricSignal(registry, input.photometric, input.dimensions);
    applyFocusSignal(registry, input.photometric, input.dimensions);
  } catch (e) {
    logger.warn('[TamperAnalysis] Photometric signal pass failed', { error: String(e) });
  }

  try {
    applyFragmentReuseSignal(registry, input.fragmentReuse);
  } catch (e) {
    logger.warn('[TamperAnalysis] Fragment reuse signal pass failed', { error: String(e) });
    markFailed(registry, 'Spliced Fragment', String(e));
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

  // Fragment reuse is its own claim (a piece of a protected original found inside this
  // otherwise-unrelated image) — surface it as primary whenever no stronger whole-image
  // tamper signal already explains the probe, including the "no whole-image match" path
  // where comparison is null and primaryVector would otherwise stay NONE/UNKNOWN.
  const fragmentHit = registry.get('Spliced Fragment');
  if (fragmentHit?.detected && (primaryVector === 'NONE' || primaryVector === 'UNKNOWN')) {
    primaryVector = 'SPLICED_FRAGMENT';
    overallTamperScore = Math.max(overallTamperScore, fragmentHit.confidence);
    description = `Spliced fragment detected — a region of a protected original appears composited into this image (${fragmentHit.confidence}% confidence). ${fragmentHit.evidence[0] ?? ''}`;
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
