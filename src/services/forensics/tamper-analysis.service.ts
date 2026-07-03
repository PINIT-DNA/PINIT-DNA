/**
 * Fault-tolerant tamper analysis — every detector always initialized.
 * Never mutates undefined; never throws to callers.
 */
import { logger } from '../../lib/logger';
import { tamperClassifierService } from './tamper-classifier.service';
import type { DnaComparisonResult } from '../../types/comparison.types';
import type { TamperAnalysisSection } from '../../types/unified-investigation.types';
import type { LeakedFileVerifyResult } from './leaked-file-verify.service';

export interface TamperDetectorResult {
  detector: string;
  detected: boolean;
  confidence: number;
  score: number;
  evidence: string[];
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
] as const;

export type TamperDetectorName = (typeof TAMPER_DETECTOR_NAMES)[number];

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
  opts: { confidence?: number; score?: number; evidence?: string[] },
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
    setDetected(registry, 'Screenshot', { confidence: 70, evidence: ['leak vector SCREENSHOT'] });
  }
  if (leakVerify.leakVector === 'RECORDING') {
    setDetected(registry, 'Screen Recording', { confidence: 70, evidence: ['leak vector RECORDING'] });
  }
  if (leakVerify.tampered) {
    setDetected(registry, 'Format Conversion', { confidence: 45, evidence: ['leak verify tampered flag'] });
  }
  if (leakVerify.tampered && leakVerify.watermark) {
    setDetected(registry, 'Watermark Damage', { confidence: 65, evidence: ['watermark damaged in leak verify'] });
  }
}

function applyLayerSignals(
  registry: Map<TamperDetectorName, TamperDetectorResult>,
  comparison: DnaComparisonResult,
): void {
  const layers = comparison.layerComparisons ?? [];
  const l1 = layers.find((l) => l.layer === 1);
  const l3 = layers.find((l) => l.layer === 3);
  const l5 = layers.find((l) => l.layer === 5);
  const l11 = layers.find((l) => l.layer === 11);

  if (l1?.changed && l3 && l3.similarityPercent >= 85 && l3.similarityPercent < 99) {
    setDetected(registry, 'Compression', {
      confidence: 60,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}% with L1 crypto change`],
    });
  }

  if (l3 && l3.similarityPercent >= 55 && l3.similarityPercent < 85) {
    setDetected(registry, 'Crop', {
      confidence: 55,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}%`],
    });
    setDetected(registry, 'Resize', {
      confidence: 55,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}%`],
    });
  }

  if (l3 && l3.similarityPercent < 70) {
    setDetected(registry, 'Screenshot', {
      confidence: 50,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}% — capture degradation`],
    });
  }

  if (l3 && l3.similarityPercent >= 70 && l3.similarityPercent < 92) {
    setDetected(registry, 'Sharpen', {
      confidence: 40,
      score: 100 - l3.similarityPercent,
      evidence: [`L3 perceptual ${l3.similarityPercent}%`],
    });
  }

  if (l5?.changed && !l1?.changed) {
    setDetected(registry, 'Metadata Removed', {
      confidence: 70,
      score: 60,
      evidence: ['L5 metadata changed without L1 crypto change'],
    });
  }

  if (l11?.changed || (l11 && l11.similarityPercent < 80)) {
    setDetected(registry, 'AI Enhancement', {
      confidence: l11 ? Math.max(40, 100 - l11.similarityPercent) : 50,
      score: l11 ? 100 - l11.similarityPercent : 50,
      evidence: l11 ? [`L11 deepfake layer ${l11.similarityPercent}%`] : ['L11 deepfake signal'],
    });
    if (l11 && l11.similarityPercent < 50) {
      setDetected(registry, 'AI Generated', {
        confidence: 55,
        score: 100 - l11.similarityPercent,
        evidence: [`L11 deepfake ${l11.similarityPercent}%`],
      });
    }
  }
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
  };
}

export interface BuildTamperAnalysisInput {
  comparison: DnaComparisonResult | null;
  leakVerify: LeakedFileVerifyResult;
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
      applyLayerSignals(registry, input.comparison);
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

  return registryToSection(registry, primaryVector, overallTamperScore, description);
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
