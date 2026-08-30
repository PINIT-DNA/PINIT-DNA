/**
 * Unified Forensic Investigation Center — report types
 */
import type { DnaComparisonResult } from './comparison.types';

export interface LeakedFileAccessEntry {
  timestamp: string;
  action: string;
  tepCode?: string;
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
  status: 'complete' | 'warning' | 'failed' | 'skipped' | 'running' | 'pending';
  detail?: string;
  elapsedMs?: number;
}

/** Progressive UI snapshot — phased live results */
export interface InvestigationLiveSnapshot {
  phase: 1 | 2 | 3 | 'final';
  signatureFound: boolean;
  ownerName?: string;
  ownerPinitId?: string;
  vaultId?: string;
  dnaRecordId?: string;
  originalFilename?: string;
  confidence?: number;
  patchVotes?: number;
  orbScore?: number;
  similarityScore?: number;
  watermarkStatus?: string;
  certificateStatus?: string;
  dnaMatchPercent?: number;
  statusMessage?: string;
  deepVerificationRunning?: boolean;
}

/** Live progress event streamed during investigation (SSE) */
export interface InvestigationProgressEvent {
  type: 'timeline' | 'partial' | 'phase' | 'complete' | 'error';
  stepId: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'warning' | 'failed' | 'skipped';
  detail?: string;
  elapsedMs?: number;
  snapshot?: InvestigationLiveSnapshot;
  partial?: {
    vaultId?: string;
    ownerPinitId?: string;
    ownerName?: string;
    ownershipConfidence?: number;
    candidateCount?: number;
    originalFilename?: string;
    patchVotes?: number;
    orbScore?: number;
  };
}

export type ForensicVerdict =
  | 'ORIGINAL_VERIFIED'
  | 'ORIGINAL_FOUND_PARTIAL'
  | 'POSSIBLE_ASSET'
  | 'NO_SIGNATURE';

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
  /** Retrieval — patch DNA, ORB, local DNA, structural, 15-layer */
  retrievalConfidence?: number;
  /** Certificate + vault ownership proof */
  ownershipVerificationConfidence?: number;
  /** Final forensic state derived from retrieval confidence */
  forensicVerdict?: ForensicVerdict;
  /** Three-state report outcome (UI mapping from Acceptance Engine) */
  reportState?: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE';
  decisionReason?: string;
  /** Human-readable reasons when identity signals are degraded */
  forensicReasons?: string[];
  /** Frozen Acceptance Engine verdict — sole decision authority */
  acceptanceVerdict?:
    | 'VERIFIED_ORIGINAL'
    | 'VERIFIED_DERIVATIVE'
    | 'POSSIBLE_MATCH'
    | 'NOT_PINIT'
    | 'INSUFFICIENT_EVIDENCE';
  acceptancePolicyVersion?: string;
  acceptanceConfidence?: number;
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
    retrievalConfidence?: number;
    ownershipVerificationConfidence?: number;
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
  tepCode?: string | null;
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

/** Human-readable inventory of how the probe differs from the vault original */
export interface TamperChangeItem {
  type: string;
  detected: boolean;
  confidence: number;
  /** Plain-language explanation of what changed */
  detail: string;
  /** Where the change shows up (region, text layer, metadata, etc.) */
  where?: string;
}

export interface TamperAnalysisSection {
  primaryVector: string;
  overallTamperScore: number;
  vectors: Array<{
    label: string;
    detected: boolean;
    confidence?: number;
    evidence?: string[];
  }>;
  description?: string;
  /** Ordered list of detected changes vs original — primary UX for tamper status */
  changesVsOriginal?: TamperChangeItem[];
  /** Visual tamper overlay from forensic scanner (base64 PNG) */
  overlayPngBase64?: string;
  modifiedPercent?: number;
  insertedRegions?: number;
  /** Bounding boxes for changed regions, with a best-effort added/removed/modified classification */
  regions?: Array<{ x: number; y: number; width: number; height: number; type: 'added' | 'removed' | 'modified' }>;
  /** Homography / crop geometry when available (images) */
  cropDetection?: {
    sharedRegionPercent?: number;
    visiblePercent?: number;
    cropPercent?: number;
    missingPercent?: number;
    homographyFound?: boolean;
  };
}

/** A small fragment of a protected original found composited into an otherwise-unrelated probe image */
export interface FragmentReuseFinding {
  vaultId: string;
  dnaRecordId: string;
  ownerFilename?: string;
  patchMatchCount: number;
  confidence: number;
  /** Normalized bounding box (0-100) of the matched fragment within the probe image */
  probeRegion: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  /** Normalized bounding box (0-100) of the corresponding region in the protected original */
  vaultRegion: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
}

export interface FragmentReuseSection {
  detected: boolean;
  findings: FragmentReuseFinding[];
  summary: string;
}

export interface MatchReason {
  signal: string;
  label: string;
  percent: number;
  matched: boolean;
}

export interface ForensicEvidenceSection {
  recoveredWatermark?: boolean;
  recoveredOwner?: string | null;
  vaultId?: string;
  dnaRecordId?: string;
  certificateId?: string | null;
  timelineEvents?: number;
  uploadDate?: string;
  distributionPlatforms?: string[];
  screenshotDetected?: boolean;
  screenshotPlatform?: string;
  screenshotConfidence?: number;
  aiEdited?: boolean;
  aiEditConfidence?: number;
  aiEditReason?: string;
  matchReasons?: MatchReason[];
  overallConfidence?: number;
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
  /**
   * Immutable Investigation Manifest — single source of truth for UI, API, PDF, audit.
   * docs/architecture/10_INVESTIGATION_REPORT_SPEC.md
   */
  manifest?: import('./investigation-manifest.types').InvestigationManifest;
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
  /**
   * Append-only forensic provenance (chain of custody).
   * Separate from DNA — location/downloads/tamper/investigations never mutate DNA.
   */
  evidenceTimeline?: Array<{
    id: string;
    eventType: string;
    summary: string;
    timestamp: string;
    locationLabel?: string;
    actorLabel?: string;
    device?: string;
    tepCode?: string;
    certificateId?: string;
    source?: 'provenance' | 'legacy';
  }>;
  provenanceSummary?: {
    creationLocation?: string;
    creationTime?: string;
    lastDownload?: string;
    lastProtectedExport?: string;
    lastKnownDevice?: string;
    lastKnownLocation?: string;
    firstInvestigation?: string;
    latestInvestigation?: string;
    tamperCount: number;
    downloadCount: number;
    shareCount: number;
    investigationCount: number;
    countriesSeen: string[];
    devicesSeen: string[];
  };
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
  /** Per-stage execution timings (performance diagnostics) */
  stageTimings?: Array<{ stage: string; durationMs: number; detail?: string }>;
  /** Live progress timeline steps */
  progressTimeline?: InvestigationProgressEvent[];
  /** Full retrieval→report audit trace (diagnostic; no threshold changes) */
  pipelineAudit?: import('./investigation-pipeline-audit.types').InvestigationPipelineAudit;
  /** Phase 2 — explainable matching + recovered forensic evidence */
  forensicEvidence?: ForensicEvidenceSection;
  /** Small-fragment reuse / splice detection — additive, does not affect the whole-image ownership verdict */
  fragmentReuseAnalysis?: FragmentReuseSection;
  /** Provenance/authorization verdict — computed from existing share/TEP records,
   * not a new detection. AUTHORIZED means this probe traces back to a specific
   * share or export event this platform issued; UNKNOWN_ORIGIN means a real DNA
   * match exists but no such record does (evidence of "not authorized through
   * this platform", not proof of theft — content shared outside the platform
   * leaves no trail either way). NOT_APPLICABLE when there's no match at all. */
  provenance?: {
    authorizationStatus: 'AUTHORIZED' | 'UNKNOWN_ORIGIN' | 'NOT_APPLICABLE';
  };
  /** One-hop lineage graph around the matched protected original — which other
   * files (crops, derivatives, prior investigations) are already linked to it. */
  relatedLineage?: {
    nodes: Array<{ dnaRecordId: string; filename: string; fileType: string; createdAt: string }>;
    edges: Array<{ fromId: string; toId: string; relation: string; confidence: number; detectedAt: string }>;
  };
}
