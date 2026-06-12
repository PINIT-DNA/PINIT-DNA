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
  ownerName?: string;
  ownerEmail?: string | null;
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
  ownerName?: string;
  ownerEmail?: string | null;
  dnaRecord: {
    id: string;
    status: string;
    filename: string;
  };
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
