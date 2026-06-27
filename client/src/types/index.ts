// ─── App State Machine ────────────────────────────────────────────────────────

export type AppStage =
  | 'idle'         // Upload page shown
  | 'processing'   // DNA generation in progress
  | 'encrypting'   // AES-256-GCM encryption step
  | 'success';     // Complete

// ─── Layer Types ─────────────────────────────────────────────────────────────

export type LayerStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface LayerInfo {
  number: number;
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export interface LayerState {
  status: LayerStatus;
  processingMs?: number;
  score?: number;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface GenerateDnaResponse {
  success: boolean;
  dnaRecordId: string;
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  schemaVersion: string;
  fileType: string;
  engineVersion: string;
  detectedBy: string;
  detectionConfidence: string;
  summary: {
    totalLayers: number;
    successfulLayers: number;
    failedLayers: number;
    totalProcessingMs: number;
  };
  generatedAt: string;
}

// ─── Supported File Types ─────────────────────────────────────────────────────

export interface SupportedFileType {
  fileType: string;
  displayName: string;
  category: string;
  engineStatus: 'LIVE' | 'PLANNED';
  mimeTypes: string[];
  extensions: string[];
  maxFileSizeMb: number;
}

// ─── Encryption (simulated client-side animation) ─────────────────────────────

export interface EncryptionResult {
  algorithm: string;
  keyLength: number;
  encryptedAt: string;
}

// ─── Vault ────────────────────────────────────────────────────────────────────

export interface VaultStoreResponse {
  success: boolean;
  vaultId: string;
  dnaRecordId: string;
  originalFileName: string;
  originalMimeType: string;
  encryptedSizeBytes: number;
  originalSizeBytes: number;
  encryptionAlgorithm: string;
  storedAt: string;
}

// ─── Final DNA Session ────────────────────────────────────────────────────────

export interface DnaSession {
  dnaRecordId: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string;
  fileType: string;
  engineVersion: string;
  status: string;
  successfulLayers: number;
  totalLayers: number;
  totalProcessingMs: number;
  generatedAt: string;
  encryption?: EncryptionResult;
  vault?: VaultStoreResponse;
}
