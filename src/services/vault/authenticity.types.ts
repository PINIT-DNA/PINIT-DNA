/**
 * Authenticity report types — forensic verdict + evidence (WHY), not label-only.
 * Stored on DnaRecord.fileAnalysis / VaultRecord.contentAnalysis.
 */

export type AuthenticityVerdict =
  | 'ORIGINAL'
  | 'EDITED'
  | 'TAMPERED'
  | 'AI_GENERATED'
  | 'LIKELY_AI'
  | 'LIKELY_EDITED'
  | 'DEEPFAKE'
  | 'SCREENSHOT'
  | 'RECOMPRESSED'
  | 'METADATA_MODIFIED'
  | 'DOCUMENT'
  | 'COURSE_MATERIAL'
  | 'SUSPICIOUS'
  | 'UNKNOWN';

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type EngineStatus = 'COMPLETE' | 'PARTIAL' | 'SKIPPED' | 'UNAVAILABLE' | 'FAILED';

export interface AuthenticityEvidence {
  id: string;
  engine: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  scoreImpact?: number;
}

export interface AuthenticityEngineResult {
  id: string;
  name: string;
  status: EngineStatus;
  summary: string;
  score?: number | null;
  findings?: string[];
}

export interface ContentCompositionPercent {
  manualPercent: number;
  aiGeneratedPercent: number;
  editedPercent: number;
  screenshotPercent: number;
  courseMaterialPercent: number;
  tamperedPercent: number;
  recompressedPercent: number;
}

export interface AuthenticityScores {
  authenticityScore: number;
  tamperScore: number;
  aiProbability: number;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
}

export interface VaultContentAnalysis {
  version: 'authenticity-v1' | 'authenticity-v2' | 'authenticity-v3' | 'authenticity-v4' | 'authenticity-v5' | 'authenticity-v6' | 'authenticity-v7';
  /** @deprecated use verdict — kept for older UI */
  label: AuthenticityVerdict;
  labelDisplay: string;
  verdict: AuthenticityVerdict;
  verdictDisplay: string;
  confidence: number;
  summary: string;
  scores: AuthenticityScores;
  composition: ContentCompositionPercent;
  evidence: AuthenticityEvidence[];
  engines: AuthenticityEngineResult[];
  reasons: string[];
  signals: {
    fileCategory: string;
    mimeType: string;
    isImage: boolean;
    isDocument: boolean;
    isVideo: boolean;
    deepfakeScore?: number | null;
    isDeepfake?: boolean | null;
    aiEdited?: boolean | null;
    aiConfidencePercent?: number | null;
    pythonAiGenerated?: boolean | null;
    pythonAiGeneratedPct?: number | null;
    isScreenshot?: boolean | null;
    screenshotPlatform?: string | null;
    screenshotConfidencePercent?: number | null;
    wordCount?: number | null;
    courseKeywordsHit?: string[];
    metadataMissing?: boolean | null;
    metadataSoftware?: string | null;
    metadataCamera?: string | null;
    doubleJpegHint?: boolean | null;
    elaMean?: number | null;
    sha256?: string | null;
    aiGenerationScore?: number | null;
    likelyAiGenerated?: boolean | null;
    aiMarkerHit?: boolean | null;
    hasCameraExif?: boolean | null;
    ensembleAiPct?: number | null;
    ensembleTamperPct?: number | null;
  };
  heatmapPngBase64?: string | null;
  analyzedAt: string;
  source: string[];
}

export const VERDICT_DISPLAY: Record<AuthenticityVerdict, string> = {
  ORIGINAL: 'Original',
  EDITED: 'Edited',
  TAMPERED: 'Tampered',
  AI_GENERATED: 'AI Generated',
  LIKELY_AI: 'Likely AI',
  LIKELY_EDITED: 'Likely Edited',
  DEEPFAKE: 'Deepfake',
  SCREENSHOT: 'Screenshot / Re-captured',
  RECOMPRESSED: 'Recompressed',
  METADATA_MODIFIED: 'Metadata Modified',
  DOCUMENT: 'Document',
  COURSE_MATERIAL: 'Course / Academic Material',
  SUSPICIOUS: 'Suspicious',
  UNKNOWN: 'Unknown / Inconclusive',
};
