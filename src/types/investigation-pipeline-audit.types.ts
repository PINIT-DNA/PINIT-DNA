/**
 * Structured audit trace for Unified Investigation / DNA Compare pipelines.
 * Used to diagnose storage vs indexing vs retrieval vs report-generation issues.
 */

export interface DnaLayerStorageAudit {
  layer: number;
  name: string;
  stored: boolean;
  tableOrField: string;
}

export interface AuthoritativeRecordAudit {
  dnaRecordId: string;
  vaultId: string | null;
  ownerUserId: string | null;
  ownerPinitId: string | null;
  certificateId: string | null;
  originalFilename: string;
  storagePath: string | null;
  sha256Hash: string | null;
  status: string;
  layersStored: number;
  layersExpected: number;
  layerDetails: DnaLayerStorageAudit[];
  issues: string[];
}

export interface DnaStorageAuditReport {
  auditedAt: string;
  ownerUserId: string;
  schemaSummary: {
    hubTable: string;
    layerTables: string[];
    vaultTable: string;
    certificateTable: string;
    oneDnaPerVault: boolean;
    oneSha256PerOwner: boolean;
    /** Authoritative linkage: one vault ↔ one DNA ↔ one certificate per uploaded file */
    linkage: {
      dnaRecordId: 'dna_records.id (PK)';
      vaultId: 'vault_records.id (PK) → dna_records.id (FK, unique)';
      certificateId: 'certificates.certificateId → dnaRecordId + vaultId';
      ownerUserId: 'dna_records.ownerUserId → users.id → users.shortId (PINIT ID)';
      originalFilename: 'dna_records.imageFilename + vault_records.originalFileName';
      storagePath: 'vault_records.encryptedFilePath (Supabase Storage)';
    };
  };
  totalDnaRecords: number;
  totalVaultRecords: number;
  totalCertificates: number;
  duplicateSha256Groups: Array<{ sha256: string; dnaRecordIds: string[] }>;
  orphanVaults: string[];
  orphanDnaWithoutVault: string[];
  records: AuthoritativeRecordAudit[];
  globalIssues: string[];
}

export interface CandidateScoreAudit {
  composite?: number;
  pHash?: number;
  aHash?: number;
  dHash?: number;
  perceptualBlend?: number;
  structural?: number;
  orb?: number;
  clip?: number;
  semanticColor?: number;
  sha256?: number;
  patchDna?: number;
  patchVotes?: number;
  geometricScore?: number;
  dna15Overall?: number;
  dna15MatchedLayers?: number;
  dna15TotalLayers?: number;
  layerScores?: Array<{
    layer: number;
    name: string;
    similarityPercent: number;
    matched: boolean;
  }>;
}

export interface CandidateRetrievalAudit {
  rank: number;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  ownerPinitId?: string | null;
  originalFilename?: string | null;
  certificateId?: string | null;
  storagePath?: string | null;
  scores: CandidateScoreAudit;
  selected?: boolean;
}

export interface RetrievalSelectionStep {
  stage: string;
  vaultId?: string | null;
  dnaRecordId?: string | null;
  certificateId?: string | null;
  detail?: string;
}

export type PipelineDiagnosis =
  | 'storage'
  | 'indexing'
  | 'retrieval_ranking'
  | 'report_generation'
  | 'none';

export interface ReportConsistencyAudit {
  reportVaultId?: string;
  reportDnaRecordId?: string;
  reportCertificateId?: string | null;
  reportOriginalFilename?: string | null;
  retrievalVaultId?: string | null;
  retrievalDnaRecordId?: string | null;
  certificateVaultId?: string | null;
  certificateDnaRecordId?: string | null;
  certificateId?: string | null;
  deepCompareVaultId?: string | null;
  deepCompareDnaRecordId?: string | null;
  verifiedCandidateVaultId?: string | null;
  matchAfterOverrideVaultId?: string | null;
  mismatches: string[];
  diagnosis: PipelineDiagnosis;
}

export interface InvestigationPipelineAudit {
  probeImage: {
    filename: string;
    sha256: string;
    mimeType: string;
    sizeBytes: number;
  };
  vaultRecordsLoaded: number;
  vaultRecordIds: string[];
  candidateRanking: CandidateRetrievalAudit[];
  retrievalSelection: RetrievalSelectionStep[];
  winningCandidate: CandidateRetrievalAudit | null;
  reportConsistency: ReportConsistencyAudit;
  /** Human-readable trace for logs and UI */
  traceText: string;
}
