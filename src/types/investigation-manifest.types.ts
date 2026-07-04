/**
 * Investigation Manifest — frozen schema (docs/architecture/10_INVESTIGATION_REPORT_SPEC.md)
 * Single source of truth for UI, API, PDF, evidence package, audit, timeline.
 */
import type {
  AcceptanceScorecard,
  AcceptanceVerdict,
  ChannelState,
} from './acceptance.types';
import {
  ACCEPTANCE_POLICY_VERSION,
  DNA_ALGORITHM_VERSION,
} from './acceptance.types';

export const INVESTIGATION_MANIFEST_VERSION = 'investigation-manifest-v1.0' as const;

export type ManifestMediaType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'archive'
  | 'unknown';

export interface ManifestCandidate {
  rank: number;
  vaultId: string;
  dnaRecordId: string;
  filename?: string;
  vectorSimilarity: number;
  clipSimilarity: number;
  orbScore: number;
  pHashSimilarity: number;
  dnaScore: number;
  dnaClassification: string;
  fusionScore: number;
  decision: 'ACCEPT' | 'REJECT' | 'PENDING';
  rejectReasons: string[];
}

export interface ManifestAcceptedCandidate {
  vaultId: string;
  dnaRecordId: string;
  ownerUserId?: string;
  method?: string;
  tier?: number;
}

export interface ManifestOwner {
  ownerName?: string | null;
  ownerPinitId?: string | null;
  ownerUserId?: string | null;
}

export interface ManifestVault {
  vaultId?: string;
  originalFilename?: string;
  createdAt?: string;
}

export interface ManifestDna {
  dnaRecordId?: string;
  algorithmVersion: typeof DNA_ALGORITHM_VERSION | string;
  sha256?: string;
  matchPercent?: number;
  classification?: string;
}

export interface ManifestCertificate {
  certificateId?: string | null;
  status?: string;
  valid?: boolean;
}

export interface ManifestTamperFlag {
  flag: string;
  state: 'YES' | 'NO' | 'UNKNOWN' | 'SKIPPED';
  detail?: string;
}

export interface ManifestTamper {
  primaryVector?: string;
  overallTamperScore?: number;
  flags: ManifestTamperFlag[];
  description?: string;
}

export interface ManifestTimelineEvent {
  stage: string;
  timestamp?: string;
  detail?: string;
}

export interface ManifestLifecycleEvent {
  event: string;
  timestamp?: string;
  detail?: string;
  status: 'RECORDED' | 'N/A';
}

export interface ManifestLayerSlot {
  layer: number;
  name: string;
  state: ChannelState;
  score?: number;
  explanation?: string;
}

export interface ManifestProbe {
  probeId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
}

/**
 * Immutable investigation manifest — produced once per investigation.
 */
export interface InvestigationManifest {
  readonly reportVersion: typeof INVESTIGATION_MANIFEST_VERSION;
  readonly probeId: string;
  readonly investigationId: string;
  readonly investigatedAt: string;
  readonly mediaType: ManifestMediaType;
  readonly dnaAlgorithmVersion: string;
  readonly acceptancePolicyVersion: string;
  readonly analysisComplete: boolean;
  readonly failureReason: string | null;

  readonly probe: ManifestProbe;
  readonly candidates: ManifestCandidate[];
  readonly acceptedCandidate: ManifestAcceptedCandidate | null;

  readonly verdict: AcceptanceVerdict;
  readonly displayLabel: string;
  readonly decisionReason: string;
  readonly confidence: number;
  readonly confidenceBreakdown: AcceptanceScorecard;

  readonly owner: ManifestOwner;
  readonly vault: ManifestVault;
  readonly dna: ManifestDna;
  readonly certificate: ManifestCertificate;
  readonly tamper: ManifestTamper;
  readonly timeline: ManifestTimelineEvent[];
  readonly lifecycle: ManifestLifecycleEvent[];
  readonly layers: ManifestLayerSlot[];
  readonly evidence: {
    watermarkStatus?: string;
    identityVerification?: string;
    digitalSignatureValid?: boolean;
  };
  readonly scores: {
    retrievalConfidence: number;
    ownershipVerificationConfidence: number;
    identityConfidence: number;
    trustScore: number;
    dnaMatchPercent: number;
  };
}

export { ACCEPTANCE_POLICY_VERSION, DNA_ALGORITHM_VERSION };
