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
}

export interface TamperAnalysisSection {
  primaryVector: string;
  overallTamperScore: number;
  vectors: Array<{ label: string; detected: boolean; confidence?: number }>;
  description?: string;
}

export interface LeakIntelligenceSection {
  hasPublicLeak: boolean;
  entries: Array<{
    platform: string;
    url: string;
    firstSeen?: string;
    lastSeen?: string;
    status: string;
  }>;
  message: string;
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
}
