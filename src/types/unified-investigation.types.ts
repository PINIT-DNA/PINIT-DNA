/**
 * Unified Forensic Investigation Center — report types
 */
import type { DnaComparisonResult } from './comparison.types';

export interface LeakedFileAccessEntry {
  timestamp: string;
  action: string;
  ipAddress?: string;
  country?: string;
  city?: string;
  region?: string;
  device?: string;
  browser?: string;
  os?: string;
  riskLevel?: string;
  locationShared?: boolean;
}

export interface LeakedVerifySnapshot {
  found: boolean;
  valid?: boolean;
  tampered?: boolean;
  detectionMethod?: string;
  leakVector?: string;
  confidence?: number;
  message: string;
  accessHistory?: LeakedFileAccessEntry[];
}

export interface InvestigationPipelineStep {
  id: string;
  label: string;
  status: 'complete' | 'warning' | 'failed' | 'skipped';
  detail?: string;
}

export interface InvestigationSummary {
  ownershipConfidence: number;
  dnaMatchPercent: number;
  certificateStatus: string;
  identityStatus: string;
  tamperSeverity: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  /** Phase 5 — multi-signal composite scores */
  trustScore?: number;
  identityConfidence?: number;
}

export interface RecoverySignal {
  engine: string;
  label: string;
  score: number;
  weight: number;
  weightedContribution: number;
  status: 'recovered' | 'partial' | 'failed' | 'skipped';
  detail?: string;
}

export interface IdentityRecoverySection {
  enginesRun: number;
  enginesRecovered: number;
  signals: RecoverySignal[];
  compositeScores: {
    ownershipConfidence: number;
    trustScore: number;
    identityConfidence: number;
  };
  transformations: Array<{ type: string; detected: boolean; detail?: string }>;
  message: string;
}

export interface RankedVaultCandidate {
  rank: number;
  dnaRecordId: string;
  vaultId: string;
  ownerUserId: string;
  preliminaryScore: number;
  compositeScore: number;
  tier?: number;
  method: string;
  signals: string[];
  dnaMatchPercent?: number;
  selected?: boolean;
}

export interface IdentityRecoveryReportSection {
  originalOwner?: string | null;
  ownerPinitId?: string | null;
  vaultId?: string;
  dnaRecordId?: string;
  certificateId?: string | null;
  originalFilename?: string;
  createdAt?: string;
  protectedDownloadDate?: string;
  originalDevice?: string;
  registrationTimestamp?: string;
  originalHash?: string;
  currentHash?: string;
  evidenceConfidence?: number;
  recovered: boolean;
  message: string;
}

export interface LeakIntelligenceEntry {
  platform: string;
  url: string;
  firstSeen?: string;
  lastSeen?: string;
  status: string;
  source?: 'crawler' | 'simulated' | 'recorded';
}

export interface TamperAnalysisSection {
  primaryVector: string;
  overallTamperScore: number;
  vectors: Array<{ label: string; detected: boolean; confidence?: number }>;
  description?: string;
}

export interface LeakIntelligenceSection {
  hasPublicLeak: boolean;
  entries: LeakIntelligenceEntry[];
  message: string;
  /** Chronological leak chain when crawler data exists */
  leakChain?: Array<{ platform: string; date?: string; status: string }>;
  currentStatus?: string;
}

export interface WatermarkProof {
  status: 'DETECTED' | 'DAMAGED' | 'NOT_EMBEDDED';
  reason?: string;
  code?: string;
  extractionMethod?: string;
  vaultId?: string;
  ownerPinitId?: string;
  confidence?: number;
}

export interface IdentityProofSection {
  vaultId?: string;
  dnaRecordId?: string;
  certificateId?: string;
  ownerPinitId?: string;
  digitalSignatureValid: boolean;
  watermark: WatermarkProof;
  identityVerification: string;
}

export interface UnifiedInvestigationReport {
  success: boolean;
  investigationId: string;
  investigatedAt: string;
  pipeline: InvestigationPipelineStep[];
  summary: InvestigationSummary;
  owner: {
    ownerName?: string | null;
    ownerPinitId?: string | null;
    vaultId?: string;
    dnaRecordId?: string;
    certificateId?: string | null;
    originalFilename?: string;
    createdAt?: string;
  };
  recipientAttribution: {
    fromShare: boolean;
    recipientName?: string;
    recipientPinitId?: string;
    shareId?: string;
    viewTime?: string;
    downloadTime?: string;
    screenshotDetected?: boolean;
    screenRecordingDetected?: boolean;
    lastDevice?: string;
    message: string;
  };
  dnaComparison?: DnaComparisonResult | null;
  layerAnalysis: Array<{
    layer: number;
    name: string;
    matchPercent: number;
    status: 'verified' | 'warning' | 'failed' | 'skipped';
    explanation: string;
  }>;
  tamperAnalysis: TamperAnalysisSection;
  timeline: Array<{ stage: string; timestamp?: string; detail?: string }>;
  accessIntelligence: LeakedFileAccessEntry[];
  leakIntelligence: LeakIntelligenceSection;
  identityProof: IdentityProofSection;
  leakVerify?: LeakedVerifySnapshot;
  matchTier?: number;
  matchMethod?: string;
  message?: string;
  /** Phase 5 — enterprise identity recovery */
  identityRecovery?: IdentityRecoverySection;
  candidateRanking?: RankedVaultCandidate[];
  identityRecoveryReport?: IdentityRecoveryReportSection;
  currentFileHash?: string;
}
