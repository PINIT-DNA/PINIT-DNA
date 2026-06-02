/**
 * PINIT-DNA — Core Type Definitions
 *
 * All shared interfaces and types for the 6-layer DNA fingerprint system.
 * These types are implementation-agnostic; each layer service must satisfy
 * the corresponding interface.
 */

// ─── File Inputs ──────────────────────────────────────────────────────────────

/**
 * ImageInput — used by all 6 existing image DNA layers (unchanged).
 * Kept separate from FileInput so existing layer code needs zero edits.
 */
export interface ImageInput {
  /** Absolute path to the temp file on disk */
  filePath: string;
  /** Original filename as uploaded */
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /** Raw buffer — loaded once and passed to all layers */
  buffer: Buffer;
}

/**
 * FileInput — universal input for the UniversalFileRouter.
 * The router adapts this to ImageInput (or future engine inputs) internally.
 */
export interface FileInput {
  filePath: string;
  originalName: string;
  /** MIME type as declared by the browser/OS — may differ from magic-byte result */
  declaredMimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

// ─── File Type enum values ─────────────────────────────────────────────────────

export type FileType =
  | 'IMAGE'
  | 'PDF'
  | 'DOCX'
  | 'PPTX'
  | 'TXT'
  | 'CSV'
  | 'JSON'
  | 'ZIP'
  | 'VIDEO'
  | 'AUDIO';

// ─── Layer Result Base ────────────────────────────────────────────────────────

export interface LayerResult {
  /** Layer number 1–6 */
  layer: number;
  /** Human-readable layer name */
  name: string;
  /** Whether this layer generated successfully */
  success: boolean;
  /** Wall-clock ms taken to generate */
  processingMs: number;
  /** Optional error message when success === false */
  error?: string;
}

// ─── Layer 1: SHA-256 Cryptographic Hash ─────────────────────────────────────

export interface CryptoLayerResult extends LayerResult {
  layer: 1;
  name: 'cryptographic';
  data: {
    sha256Hash: string;
    normalizedHash: string;
    blake3Hash: string | null;
  };
}

// ─── Layer 2: Structural Fingerprint ─────────────────────────────────────────

export interface EdgeVector {
  angle: number;      // degrees 0–360
  magnitude: number;  // 0.0–1.0 normalised
}

export interface StructuralLayerResult extends LayerResult {
  layer: 2;
  name: 'structural';
  data: {
    edgeMapB64: string;
    edgeVectors: EdgeVector[];
    edgeSignature64: string;
    algorithm: string;
  };
}

// ─── Layer 3: Perceptual Visual Hash ─────────────────────────────────────────

export interface PerceptualLayerResult extends LayerResult {
  layer: 3;
  name: 'perceptual';
  data: {
    pHash64: string;
    pHash256: string;
    aHash64: string;
    dHash64: string;
  };
}

// ─── Layer 4: Semantic Color Fingerprint ─────────────────────────────────────

export interface DominantColor {
  hex: string;        // e.g. "#3a7bd5"
  coverage: number;   // 0.0–1.0 percentage of pixels
}

export interface SemanticLayerResult extends LayerResult {
  layer: 4;
  name: 'semantic';
  data: {
    histogramR: number[];  // 256 bins
    histogramG: number[];
    histogramB: number[];
    histogramH: number[];  // Hue 0–360 in 360 bins
    histogramS: number[];  // Saturation 0–100 in 100 bins
    dominantColors: DominantColor[];
    colorFingerprint: string;
  };
}

// ─── Layer 5: Metadata Provenance Record ─────────────────────────────────────

export interface ExifData {
  [key: string]: unknown;
}

export interface MetadataLayerResult extends LayerResult {
  layer: 5;
  name: 'metadata';
  data: {
    exifData: ExifData | null;
    deviceMake: string | null;
    deviceModel: string | null;
    software: string | null;
    capturedAt: Date | null;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    iptcData: Record<string, unknown> | null;
    xmpData: Record<string, unknown> | null;
    metadataHash: string;
  };
}

// ─── Layer 6: Hidden AI Signature (LSB Steganography) ────────────────────────

export interface StegoLayerResult extends LayerResult {
  layer: 6;
  name: 'steganography';
  data: {
    embedded: boolean;
    capacityBits: number;
    usedBits: number;
    payloadHmac: string;
    channel: 'R' | 'G' | 'B' | 'alpha';
    carrierPath: string | null;
  };
}

// ─── Union of all layer results ───────────────────────────────────────────────

export type AnyLayerResult =
  | CryptoLayerResult
  | StructuralLayerResult
  | PerceptualLayerResult
  | SemanticLayerResult
  | MetadataLayerResult
  | StegoLayerResult;

// ─── Full DNA Record (in-memory, before DB persist) ───────────────────────────

export interface DnaGenerationResult {
  dnaRecordId: string;
  schemaVersion: string;
  /**
   * "file" replaces "image" to support all file types.
   * The "image" key is kept as an alias for backward compatibility.
   */
  file: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    /** Only populated for IMAGE type */
    widthPx: number | null;
    heightPx: number | null;
  };
  /** @deprecated Use `file` — kept for backward compatibility */
  image: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    widthPx: number | null;
    heightPx: number | null;
  };
  layers: {
    crypto: CryptoLayerResult;
    structural: StructuralLayerResult;
    perceptual: PerceptualLayerResult;
    semantic: SemanticLayerResult;
    metadata: MetadataLayerResult;
    stego: StegoLayerResult;
  };
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  totalProcessingMs: number;
  generatedAt: Date;
}

// ─── Verification ─────────────────────────────────────────────────────────────

export type LayerName =
  | 'cryptographic'
  | 'structural'
  | 'perceptual'
  | 'semantic'
  | 'metadata'
  | 'steganography';

export interface LayerVerificationResult {
  layer: LayerName;
  passed: boolean;
  similarityScore: number;  // 0.0–1.0
  threshold: number;        // minimum score to pass
  detail: string;
}

export interface DnaVerificationResult {
  dnaRecordId: string;
  passed: boolean;
  confidenceScore: number;         // weighted average of layer scores
  layerResults: LayerVerificationResult[];
  layersChecked: LayerName[];
  verifiedAt: Date;
  verificationLogId: string;
}

// ─── API Request / Response shapes ───────────────────────────────────────────

export interface GenerateDnaResponse {
  success: boolean;
  dnaRecordId: string;
  status: string;
  schemaVersion: string;
  /** Detected file type — e.g. "IMAGE", "PDF" */
  fileType: string;
  /** Engine version that processed this file — e.g. "2.0.0-universal" */
  engineVersion: string;
  /** How the file type was detected */
  detectedBy: string;
  /** Reliability of file-type detection */
  detectionConfidence: string;
  summary: {
    totalLayers: number;
    successfulLayers: number;
    failedLayers: number;
    totalProcessingMs: number;
  };
  generatedAt: string;
}

export interface VerifyDnaRequest {
  dnaRecordId: string;
  /** Optional: restrict which layers to verify */
  layers?: LayerName[];
}

export interface VerifyDnaResponse {
  success: boolean;
  dnaRecordId: string;
  passed: boolean;
  confidenceScore: number;
  layerResults: LayerVerificationResult[];
  verifiedAt: string;
}

export interface GetDnaRecordResponse {
  success: boolean;
  record: {
    id: string;
    status: string;
    schemaVersion: string;
    image: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      widthPx: number | null;
      heightPx: number | null;
    };
    layers: {
      crypto: boolean;
      structural: boolean;
      perceptual: boolean;
      semantic: boolean;
      metadata: boolean;
      steganography: boolean;
    };
    createdAt: string;
    updatedAt: string;
  };
}
