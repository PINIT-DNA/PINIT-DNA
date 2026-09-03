// ─── Dashboard API Types ──────────────────────────────────────────────────────

export interface DnaRecord {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  schemaVersion: string;
  imageFilename: string;
  imageMimeType: string;
  imageSizeBytes: number;
  fileType: string | null;
  engineVersion: string | null;
  createdAt: string;
  updatedAt?: string;
  vaultId: string | null;
}

/** Custody location — never part of DNA (immutable identity) */
export interface VaultLocationStatus {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  creationLabel?: string;
  creationSource?: 'gps' | 'ip' | 'none';
  sharedLabel?: string;
  sharedSource?: 'gps' | 'ip' | 'none';
  sharedAt?: string;
  presentLabel?: string;
  presentSource?: 'gps' | 'ip' | 'none';
  presentAt?: string;
  lastKnownLabel?: string;
  lastKnownSource?: 'gps' | 'ip' | 'none';
  lastKnownAt?: string;
  latitude?: number;
  longitude?: number;
}

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
  | 'UNKNOWN'
  | string;

export interface AuthenticityEvidence {
  id: string;
  engine: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  title: string;
  detail: string;
  scoreImpact?: number;
}

export interface AuthenticityEngineResult {
  id: string;
  name: string;
  status: 'COMPLETE' | 'PARTIAL' | 'SKIPPED' | 'UNAVAILABLE' | 'FAILED' | string;
  summary: string;
  score?: number | null;
  findings?: string[];
}

export interface VaultContentAnalysis {
  version?: string;
  label: string;
  labelDisplay?: string;
  verdict?: AuthenticityVerdict;
  verdictDisplay?: string;
  confidence: number;
  summary?: string;
  reasons?: string[];
  scores?: {
    authenticityScore: number;
    tamperScore: number;
    aiProbability: number;
    confidence: number;
    confidenceLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  };
  composition?: {
    manualPercent: number;
    aiGeneratedPercent: number;
    editedPercent: number;
    screenshotPercent: number;
    courseMaterialPercent: number;
    tamperedPercent?: number;
    recompressedPercent?: number;
  };
  evidence?: AuthenticityEvidence[];
  engines?: AuthenticityEngineResult[];
  signals?: {
    fileCategory?: string;
    mimeType?: string;
    isImage?: boolean;
    isDocument?: boolean;
    isVideo?: boolean;
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
  analyzedAt?: string;
  source?: string[];
}

export interface VaultRecord {
  id: string;
  dnaRecordId: string;
  originalFileName: string;
  originalMimeType: string;
  encryptedSizeBytes: number;
  originalSizeBytes: number;
  encryptionAlgorithm: string;
  keyDerivation: string;
  createdAt: string;
  contentLabel?: string | null;
  contentAnalysis?: VaultContentAnalysis | null;
  dnaRecord: {
    id: string;
    status: string;
    filename: string;
  };
  location?: VaultLocationStatus;
  /** Social / capture platform when file came via extension or Publish Guardian */
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
  capturedVia?: string | null;
  fromExtension?: boolean;
}

export interface SupportedFileType {
  fileType: string;
  displayName: string;
  category: string;
  engineStatus: 'LIVE' | 'PLANNED';
  mimeTypes: string[];
  extensions: string[];
  maxFileSizeMb: number;
  layers: Record<string, string>;
}

export interface SupportedTypesResponse {
  success: boolean;
  engineVersion: string;
  totalSupported: number;
  live: number;
  planned: number;
  types: SupportedFileType[];
}

// ─── Comparison Types (mirrors backend) ───────────────────────────────────────

export interface LayerComparison {
  layer: number;
  name: string;
  implementation: string;
  similarityScore: number;
  similarityPercent: number;
  matched: boolean;
  fingerprintA: string;
  fingerprintB: string;
  changed: boolean;
  changeDescription: string;
}

export interface TamperingIndicator {
  layer: number;
  layerName: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  evidence: string;
}

export interface ForensicReport {
  summary: string;
  methodology: string;
  classification: 'DNA_MATCH' | 'SIMILAR' | 'DIFFERENT';
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

export interface ComparedFileSummary {
  filename: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  detectedBy: string;
}

export type DnaClassification = 'DNA_MATCH' | 'SIMILAR' | 'DIFFERENT';

export interface ComparisonResult {
  comparisonId: string;
  fileA: ComparedFileSummary;
  fileB: ComparedFileSummary;
  sameFileType: boolean;
  classification: DnaClassification;
  overallConfidenceScore: number;
  tamperingDetected: boolean;
  layerComparisons: LayerComparison[];
  changedLayers: string[];
  matchedLayers: string[];
  forensicReport: ForensicReport;
  processingMs: number;
  comparedAt: string;
}

// ─── Dashboard Stats ───────────────────────────────────────────────────────────

export interface DashboardStats {
  totalDnaRecords: number;
  totalVaultRecords: number;
  totalVerifications: number;
  completedDna: number;
  partialDna: number;
  totalEncryptedBytes: number;
  fileTypeBreakdown: { fileType: string; count: number }[];
  recentActivity: DnaRecord[];
  vaultRecords?: VaultRecord[];
}

// ─── Certificate (Phase 2 hardened) ──────────────────────────────────────────

export type CertificateStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface IssuedCertificate {
  certificateId:    string;
  dnaRecordId:      string;
  vaultId:          string;
  status:           CertificateStatus;
  signature:        string;
  issuedAt:         string;
  expiresAt:        string | null;
  revokedAt:        string | null;
  revocationReason: string | null;
  issuedByUserId:   string | null;
}

export interface CertVerificationResult {
  valid:           boolean;
  status:          CertificateStatus | 'NOT_FOUND';
  signatureValid:  boolean;
  certificateId:   string;
  detail:          string;
  certificate:     IssuedCertificate | null;
}

// Legacy certificate type kept for compatibility
export interface Certificate {
  type: 'DNA' | 'VAULT' | 'VERIFICATION';
  id: string;
  filename: string;
  fileType: string;
  issuedAt: string;
  dnaRecordId: string;
  vaultId?: string;
  encryptionAlgorithm?: string;
  layers?: number;
  confidence?: number;
}
