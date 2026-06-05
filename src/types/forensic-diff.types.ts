/**
 * PINIT-DNA — Forensic Difference Engine Types
 *
 * Types for explainable forensic analysis:
 * WHAT changed, WHERE it changed, HOW SEVERELY.
 */

// ─── Text diff ────────────────────────────────────────────────────────────────

export type DiffType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface TextDiffChunk {
  type:        DiffType;
  content:     string;       // the actual text content
  lineStart:   number;
  lineEnd:     number;
  location:    string;       // "Line 12", "Page 2", "Section: Introduction"
  wordCount:   number;
  severity:    'low' | 'medium' | 'high';
}

export interface SectionDiff {
  sectionName:  string;
  type:         'added' | 'removed' | 'modified' | 'reordered';
  changePercent: number;
  description:  string;
}

export interface TextDiffResult {
  supported:       boolean;
  engine:          string;       // "line_diff" | "word_diff" | "structured"
  addedLines:      number;
  removedLines:    number;
  unchangedLines:  number;
  totalLines:      number;
  changePercent:   number;       // 0–100
  addedWords:      number;
  removedWords:    number;
  chunks:          TextDiffChunk[];
  addedContent:    string[];     // top snippets of added text
  removedContent:  string[];     // top snippets of removed text
  sectionDiffs:    SectionDiff[];
  structuredDiff?: Record<string, unknown>;  // for JSON/CSV
  error?:          string;
}

// ─── Image diff ───────────────────────────────────────────────────────────────

export interface ChangedRegion {
  x:               number;   // pixel offset from left
  y:               number;   // pixel offset from top
  width:           number;
  height:          number;
  changeIntensity: number;   // 0–1 (1 = completely different)
  gridRow:         number;   // which grid cell row
  gridCol:         number;   // which grid cell column
}

export interface ImageDiffResult {
  supported:              boolean;
  dimensionsMatch:        boolean;
  widthA:                 number;
  heightA:                number;
  widthB:                 number;
  heightB:                number;
  resizeDetected:         boolean;
  cropDetected:           boolean;
  compressionChanged:     boolean;
  pixelDifferencePercent: number;   // 0–100
  changedRegions:         ChangedRegion[];
  changedRegionPercent:   number;   // % of image area that changed
  gridSize:               number;   // e.g. 8 = 8×8 grid
  visualDescription:      string;
  heatmapAvailable:       boolean;
  error?:                 string;
}

// ─── Metadata diff ────────────────────────────────────────────────────────────

export interface MetadataFieldChange {
  field:        string;
  category:     'authorship' | 'timestamp' | 'device' | 'location' | 'technical' | 'custom';
  before:       string | null;
  after:        string | null;
  changeType:   'added' | 'removed' | 'modified';
  significance: 'low' | 'medium' | 'high';
  forensicNote: string;    // human-readable explanation of what this means
}

export interface MetadataDiffResult {
  totalChanges:      number;
  authorshipChanged: boolean;
  timestampChanged:  boolean;
  deviceChanged:     boolean;
  locationChanged:   boolean;
  changes:           MetadataFieldChange[];
  summary:           string;
}

// ─── Forensic report ──────────────────────────────────────────────────────────

export type ForensicSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ForensicEvidence {
  category:    string;    // "Text Content", "Image Pixels", "Metadata", "Structure"
  finding:     string;    // what was found
  location:    string;    // where
  severity:    ForensicSeverity;
  confidence:  number;    // 0–1
}

export interface ForensicDiffReport {
  diffId:         string;
  generatedAt:    string;
  processingMs:   number;

  fileA: {
    filename:   string;
    fileType:   string;
    mimeType:   string;
    sizeBytes:  number;
  };
  fileB: {
    filename:   string;
    fileType:   string;
    mimeType:   string;
    sizeBytes:  number;
  };

  // Per-engine results
  textDiff:     TextDiffResult | null;
  imageDiff:    ImageDiffResult | null;
  metadataDiff: MetadataDiffResult | null;

  // Overall forensic assessment
  overallSeverity:    ForensicSeverity;
  overallConfidence:  number;           // 0–1
  changeClassification: string;         // "Metadata Only" | "Minor Edit" | etc.

  // Evidence list
  evidence: ForensicEvidence[];

  // Human-readable report
  forensicSummary:   string;
  whatChanged:       string[];
  whereChanged:      string[];
  howChanged:        string[];
  recommendation:    string;
  evidenceSummary:   string;
}
