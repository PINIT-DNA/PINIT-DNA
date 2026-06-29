/**
 * Extended forensic fingerprints stored in DnaRecord.universalFingerprints.enhancements
 * — backward compatible: absent on legacy records.
 */
export interface CryptoEnhancementData {
  sha3_512?: string;
  chunkHashes?: string[];
  chunkCount?: number;
  chunkSizeBytes?: number;
}

export interface PerceptualEnhancementData {
  bmHash64?: string;
  waveletHash64?: string;
  multiResHashes?: Record<string, string>;
}

export interface StructuralEnhancementData {
  multiScaleSignatures?: Record<string, string>;
  algorithmVersion?: string;
}

export interface SemanticEnhancementData {
  labHistogram?: { L: number[]; a: number[]; b: number[] };
  colorMoments?: { mean: number[]; std: number[]; skew: number[] };
}

export interface MetadataEnhancementData {
  cameraModel?: string;
  lensModel?: string;
  firmware?: string;
  timezone?: string;
  deviceFingerprint?: string;
  editHistoryIndicators?: string[];
  exifFingerprint?: string;
}

// ─── Phase 2 forensic DNA types (v2.2) ─────────────────────────────────────

export interface OcrDnaData {
  ocrSha256?: string;
  ocrSimHash?: string;
  semanticFingerprint?: string;
  layoutFingerprint?: string;
  confidence?: number;
  wordCount?: number;
}

export interface VideoDnaData {
  keyframeHashes?: string[];
  sceneFingerprints?: string[];
  motionFingerprint?: string;
  framePHashes?: string[];
  gopFingerprint?: string;
  audioFingerprint?: string;
  ffmpegAvailable?: boolean;
  algorithmVersion?: string;
}

export interface AudioDnaData {
  spectrogramFingerprint?: string;
  chromaprint?: string;
  mfccFingerprint?: string;
  voiceEmbedding?: string;
  noiseFingerprint?: string;
  chromaprintAvailable?: boolean;
  algorithmVersion?: string;
}

export interface ScreenshotDnaData {
  ocrFingerprint?: string;
  uiLayoutFingerprint?: string;
  aspectRatioProfile?: string;
  displayScaling?: number;
  fontFingerprint?: string;
  screenArtifactFingerprint?: string;
  screenshotLikelihood?: number;
}

export interface ScreenRecordingDnaData {
  frameSequenceFingerprint?: string;
  audioFingerprint?: string;
  motionSignature?: string;
  playbackSignature?: string;
  fpsEstimate?: number;
  recordingLikelihood?: number;
}

export type TransformationStage =
  | 'ORIGINAL'
  | 'COMPRESSED'
  | 'SCREENSHOT'
  | 'SCREEN_RECORDING'
  | 'AI_EDITED'
  | 'RECOVERED'
  | 'CROPPED'
  | 'REENCODED';

export interface TransformationHistoryEntry {
  stage: TransformationStage;
  detectedAt: string;
  tamperVector?: TamperVector;
  similarityScore?: number;
  sourceDnaRecordId?: string;
  notes?: string;
}

export interface SelfLearningProfile {
  tamperVector: TamperVector;
  layerScorePattern: Record<string, number>;
  observedAt: string;
  dnaRecordId?: string;
}

export type MediaProfile = 'image' | 'document' | 'video' | 'audio' | 'unknown';

export interface DnaExplanationLine {
  layer: string;
  label: string;
  matched: boolean;
  score: number;
  detail?: string;
}

export interface DnaExplanationResult {
  summary: string;
  matchedBecause: DnaExplanationLine[];
  failedBecause: DnaExplanationLine[];
  overallConfidence: number;
}

export interface EvidenceConfidenceResult {
  ownershipScore: number;
  evidenceScore: number;
  identityScore: number;
  tamperScore: number;
  certificateScore: number;
  trustScore: number;
  legalConfidence: number;
}

export interface CrossMediaMatchResult {
  detected: boolean;
  sourceMedia: MediaProfile;
  probeMedia: MediaProfile;
  relationship: string;
  confidence: number;
  matchedLayers: string[];
}

export interface LightweightDnaFingerprint {
  version: '2.2-lite';
  mediaProfile: MediaProfile;
  sha256: string;
  simHash?: string;
  pHash?: string;
  ocrSimHash?: string;
  keyframeHash?: string;
  audioFingerprint?: string;
  generatedAt: string;
}

export interface DnaEnhancementBundle {
  version: '2.1' | '2.2';
  generatedAt: string;
  crypto?: CryptoEnhancementData;
  perceptual?: PerceptualEnhancementData;
  structural?: StructuralEnhancementData;
  semantic?: SemanticEnhancementData;
  metadata?: MetadataEnhancementData;
  /** Phase 2 extensions */
  ocr?: OcrDnaData;
  video?: VideoDnaData;
  audio?: AudioDnaData;
  screenshot?: ScreenshotDnaData;
  screenRecording?: ScreenRecordingDnaData;
}

export interface LayerScoreInput {
  layer: string;
  score: number;
  weight: number;
  passed: boolean;
}

export interface WeightedDnaScoreResult {
  overallMatchScore: number;
  ownershipConfidence: number;
  tamperConfidence: number;
  layerScores: LayerScoreInput[];
  enhancedLayerScores?: LayerScoreInput[];
}

export type TamperVector =
  | 'NONE'
  | 'EXACT_COPY'
  | 'COMPRESSION'
  | 'CROP'
  | 'RESIZE'
  | 'ROTATION'
  | 'MIRROR'
  | 'REENCODE'
  | 'SCREENSHOT'
  | 'SCREEN_RECORDING'
  | 'METADATA_REMOVAL'
  | 'WATERMARK_REMOVAL'
  | 'AI_EDITING'
  | 'AI_UPSCALE'
  | 'PARTIAL_CLIP'
  | 'OCR_MODIFICATION'
  | 'COLOR_ADJUSTMENT'
  | 'UNKNOWN_TAMPER';

export interface TamperClassificationResult {
  primaryVector: TamperVector;
  secondaryVectors: TamperVector[];
  tamperConfidence: number;
  description: string;
}
