/**
 * PINIT-DNA — Universal Engine Types
 *
 * Shared types for all non-image DNA engines (Phase 1+).
 * These replace the image-specific DnaGenerationResult for text/doc/media engines.
 */

// ─── Per-layer result ─────────────────────────────────────────────────────────

export interface UniversalLayerResult {
  layer: 1 | 2 | 3 | 4 | 5 | 6;
  name: 'cryptographic' | 'structural' | 'perceptual' | 'semantic' | 'metadata' | 'signature';
  implementation: string;       // e.g. "sha256_blake3", "simhash_64"
  fingerprint: string;          // compact hex/base64 string used for comparison
  data: Record<string, unknown>; // full extracted data (stored in DB JSON)
  success: boolean;
  processingMs: number;
  error?: string;
}

// ─── Full engine result ───────────────────────────────────────────────────────

export interface UniversalEngineResult {
  dnaRecordId: string;
  fileType: string;             // e.g. "TXT", "CSV", "JSON"
  engineVersion: string;
  schemaVersion: string;
  layers: UniversalLayerResult[];
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  totalProcessingMs: number;
  generatedAt: Date;
}

// ─── Router result (returned to controller for ALL file types) ────────────────

/**
 * UniversalRouterResult is the single return type of UniversalFileRouter.route().
 * It is NOT tied to image-specific fields — both image and text engines produce it.
 */
export interface UniversalRouterResult {
  dnaRecordId: string;
  schemaVersion: string;
  fileType: string;
  engineVersion: string;
  detectedBy: string;
  detectionConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  totalProcessingMs: number;
  generatedAt: Date;
  layerSummary: {
    total: number;
    successful: number;
    failed: number;
  };
}

// ─── Verification ─────────────────────────────────────────────────────────────

export interface UniversalLayerVerification {
  layer: number;
  name: string;
  passed: boolean;
  similarityScore: number;  // 0.0 – 1.0
  threshold: number;
  detail: string;
}

export interface UniversalVerificationResult {
  dnaRecordId: string;
  fileType: string;
  passed: boolean;
  confidenceScore: number;
  layerResults: UniversalLayerVerification[];
  verifiedAt: Date;
  verificationLogId: string;
}
