/**
 * PINIT-DNA — DNA Comparison Types (Phase 3.1)
 *
 * Types for the layer-by-layer DNA Comparison Engine.
 * Completely separate from existing generation/verification types.
 */

// ─── Per-layer comparison ─────────────────────────────────────────────────────

export interface LayerComparisonResult {
  layer: number;
  name: string;
  implementation: string;

  /** 0.0 – 1.0 */
  similarityScore: number;
  /** 0 – 100 (rounded) */
  similarityPercent: number;
  /** True when similarityScore >= layer threshold */
  matched: boolean;

  fingerprintA: string;
  fingerprintB: string;

  /** True when fingerprints are not equal */
  changed: boolean;
  changeDescription: string;
}

// ─── Tampering indicators ─────────────────────────────────────────────────────

export type TamperingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TamperingIndicator {
  layer: number;
  layerName: string;
  severity: TamperingSeverity;
  description: string;
  evidence: string;
}

// ─── File summary ─────────────────────────────────────────────────────────────

export interface ComparedFileSummary {
  filename: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  detectedBy: string;
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * DNA_MATCH   — L1 exact match AND overall score ≥ 95%
 * SIMILAR     — overall score ≥ 55% (same content, possible modifications)
 * DIFFERENT   — overall score < 55% (clearly different files)
 */
export type DnaClassification = 'DNA_MATCH' | 'SIMILAR' | 'DIFFERENT';

// ─── Forensic report ─────────────────────────────────────────────────────────

export interface ForensicReport {
  summary: string;
  methodology: string;
  classification: DnaClassification;
  overallConfidenceScore: number;
  tamperingDetected: boolean;
  tamperingIndicators: TamperingIndicator[];
  layerAnalysis: Record<string, string>;
  changedLayers: string[];
  unchangedLayers: string[];
  recommendation: string;
  engineVersion: string;
  timestamp: string;
}

// ─── Full comparison result ───────────────────────────────────────────────────

export interface DnaComparisonResult {
  comparisonId: string;

  fileA: ComparedFileSummary;
  fileB: ComparedFileSummary;

  /** Same file type for both? */
  sameFileType: boolean;

  classification: DnaClassification;

  /** 0 – 100 weighted confidence score */
  overallConfidenceScore: number;

  tamperingDetected: boolean;

  layerComparisons: LayerComparisonResult[];

  /** Names of layers that changed */
  changedLayers: string[];
  /** Names of layers that matched */
  matchedLayers: string[];

  forensicReport: ForensicReport;

  /** Wall-clock ms for the full comparison */
  processingMs: number;

  comparedAt: string;

  /** v2.1 — optional tamper vector when DNA_VERIFY_TAMPER_CLASS=true */
  enhancedForensic?: {
    tamperVector: string;
    tamperDescription: string;
    tamperConfidence: number;
  };
}
