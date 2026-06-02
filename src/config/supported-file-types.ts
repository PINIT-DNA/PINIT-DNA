/**
 * PINIT-DNA — Supported File Types Configuration
 *
 * Single source of truth for every file type the Universal DNA engine
 * supports or plans to support.  Each entry declares:
 *   - which MIME types / extensions map to it
 *   - which DNA phase implements it          (engineStatus / plannedPhase)
 *   - which algorithm runs for each of the 6 layers
 *   - the per-type file-size ceiling
 *
 * Phase map:
 *   Phase 0  → IMAGE          (live — existing engine, unchanged)
 *   Phase 1  → TXT, CSV, JSON (text-based, no binary parsing)
 *   Phase 2  → PDF, DOCX, PPTX
 *   Phase 3  → ZIP
 *   Phase 4  → VIDEO, AUDIO
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileCategory =
  | 'IMAGE'
  | 'DOCUMENT'
  | 'SPREADSHEET'
  | 'PRESENTATION'
  | 'TEXT'
  | 'ARCHIVE'
  | 'VIDEO'
  | 'AUDIO'
  | 'DATA';

export type EngineStatus = 'LIVE' | 'PLANNED';

export interface SupportedFileTypeConfig {
  /** Primary key used throughout the system — e.g. "IMAGE", "PDF" */
  fileType: string;
  /** Human-readable label for API responses and UI */
  displayName: string;
  category: FileCategory;
  /** Every MIME type that maps to this file type */
  mimeTypes: string[];
  /** Every file extension that maps to this file type (with leading dot, lower-case) */
  extensions: string[];
  /** Whether the DNA engine is active (LIVE) or waiting for a future phase (PLANNED) */
  engineStatus: EngineStatus;
  /** Phase number when PLANNED types will be implemented */
  plannedPhase: number;
  /** Layer implementation names (informational — used in API response and DB) */
  l2Implementation: string;
  l3Implementation: string;
  l4Implementation: string;
  l5Implementation: string;
  l6Implementation: string;
  /** Max upload size for this file type in bytes */
  maxFileSizeBytes: number;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const SUPPORTED_FILE_TYPES: SupportedFileTypeConfig[] = [
  // ── Phase 0: IMAGE ──────────────────────────────────────────────────────────
  {
    fileType:        'IMAGE',
    displayName:     'Image',
    category:        'IMAGE',
    mimeTypes:       ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/gif', 'image/bmp'],
    extensions:      ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.gif', '.bmp'],
    engineStatus:    'LIVE',
    plannedPhase:    0,
    l2Implementation: 'sobel_edge_detection',
    l3Implementation: 'dct_phash',
    l4Implementation: 'rgb_hsv_histogram',
    l5Implementation: 'exif_metadata_provenance',
    l6Implementation: 'lsb_steganography_hmac',
    maxFileSizeBytes: 20 * 1024 * 1024, // 20 MB
  },

  // ── Phase 1: Text-based files (LIVE) ───────────────────────────────────────
  {
    fileType:        'TXT',
    displayName:     'Plain Text',
    category:        'TEXT',
    mimeTypes:       ['text/plain'],
    extensions:      ['.txt', '.text', '.log', '.md'],
    engineStatus:    'LIVE',
    plannedPhase:    1,
    l2Implementation: 'line_word_char_entropy',
    l3Implementation: 'full_content_simhash',
    l4Implementation: 'word_frequency_distribution',
    l5Implementation: 'encoding_and_filesystem_meta',
    l6Implementation: 'zero_width_unicode_hmac',
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  },
  {
    fileType:        'CSV',
    displayName:     'CSV Spreadsheet',
    category:        'SPREADSHEET',
    mimeTypes:       ['text/csv', 'application/csv'],
    extensions:      ['.csv'],
    engineStatus:    'LIVE',
    plannedPhase:    1,
    l2Implementation: 'row_col_schema_fingerprint',
    l3Implementation: 'data_value_simhash',
    l4Implementation: 'column_type_distribution',
    l5Implementation: 'delimiter_and_encoding_meta',
    l6Implementation: 'trailing_comment_row_hmac',
    maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  },
  {
    fileType:        'JSON',
    displayName:     'JSON Data',
    category:        'DATA',
    mimeTypes:       ['application/json', 'text/json'],
    extensions:      ['.json'],
    engineStatus:    'LIVE',
    plannedPhase:    1,
    l2Implementation: 'key_tree_depth_breadth_hash',
    l3Implementation: 'sorted_keyvalue_simhash',
    l4Implementation: 'value_type_distribution',
    l5Implementation: 'encoding_and_schema_hint',
    l6Implementation: 'dna_sig_field_hmac',
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  },

  // ── Phase 2: Office documents (LIVE) ───────────────────────────────────────
  {
    fileType:        'PDF',
    displayName:     'PDF Document',
    category:        'DOCUMENT',
    mimeTypes:       ['application/pdf'],
    extensions:      ['.pdf'],
    engineStatus:    'LIVE',
    plannedPhase:    2,
    l2Implementation: 'page_layout_tree_hash',
    l3Implementation: 'text_content_simhash',
    l4Implementation: 'font_and_color_profile',
    l5Implementation: 'pdf_metadata_provenance',
    l6Implementation: 'pdf_trailer_hmac',
    maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  },
  {
    fileType:        'DOCX',
    displayName:     'Word Document',
    category:        'DOCUMENT',
    mimeTypes:       ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions:      ['.docx'],
    engineStatus:    'LIVE',
    plannedPhase:    2,
    l2Implementation: 'paragraph_table_section_tree_hash',
    l3Implementation: 'body_text_simhash',
    l4Implementation: 'heading_style_fingerprint',
    l5Implementation: 'opc_core_properties_provenance',
    l6Implementation: 'custom_xml_part_hmac',
    maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  },
  {
    fileType:        'PPTX',
    displayName:     'PowerPoint Presentation',
    category:        'PRESENTATION',
    mimeTypes:       ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    extensions:      ['.pptx'],
    engineStatus:    'LIVE',
    plannedPhase:    2,
    l2Implementation: 'slide_count_layout_hash',
    l3Implementation: 'per_slide_text_simhash',
    l4Implementation: 'theme_color_font_fingerprint',
    l5Implementation: 'opc_core_properties_provenance',
    l6Implementation: 'custom_xml_part_hmac',
    maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB
  },

  // ── Phase 3: Archives (LIVE) ────────────────────────────────────────────────
  {
    fileType:        'ZIP',
    displayName:     'ZIP Archive',
    category:        'ARCHIVE',
    mimeTypes:       ['application/zip', 'application/x-zip-compressed'],
    extensions:      ['.zip'],
    engineStatus:    'LIVE',
    plannedPhase:    3,
    l2Implementation: 'entry_directory_tree_hash',
    l3Implementation: 'sorted_entry_list_hash',
    l4Implementation: 'file_extension_distribution',
    l5Implementation: 'compression_method_meta',
    l6Implementation: 'archive_comment_hmac',
    maxFileSizeBytes: 500 * 1024 * 1024, // 500 MB
  },

  // ── Phase 4: Media (LIVE) ───────────────────────────────────────────────────
  {
    fileType:        'VIDEO',
    displayName:     'Video',
    category:        'VIDEO',
    mimeTypes:       ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
    extensions:      ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mpeg', '.mpg'],
    engineStatus:    'LIVE',
    plannedPhase:    4,
    l2Implementation: 'frame_count_keyframe_positions',
    l3Implementation: 'keyframe_dct_phash',
    l4Implementation: 'dominant_color_per_keyframe_histogram',
    l5Implementation: 'ffprobe_container_codec_metadata',
    l6Implementation: 'sei_nal_unit_hmac',
    maxFileSizeBytes: 500 * 1024 * 1024, // 500 MB
  },
  {
    fileType:        'AUDIO',
    displayName:     'Audio',
    category:        'AUDIO',
    mimeTypes:       ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4'],
    extensions:      ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'],
    engineStatus:    'LIVE',
    plannedPhase:    4,
    l2Implementation: 'duration_waveform_segment_count',
    l3Implementation: 'chromaprint_spectral_fingerprint',
    l4Implementation: 'frequency_band_energy_distribution',
    l5Implementation: 'id3_tags_codec_bitrate_meta',
    l6Implementation: 'id3v2_priv_frame_hmac',
    maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB
  },
];

// ─── Derived lookup maps ──────────────────────────────────────────────────────

/** Look up config by MIME type — O(1) */
export const FILE_TYPE_BY_MIME = new Map<string, SupportedFileTypeConfig>(
  SUPPORTED_FILE_TYPES.flatMap((ft) => ft.mimeTypes.map((mime) => [mime, ft]))
);

/** Look up config by file extension (lower-case, with dot) — O(1) */
export const FILE_TYPE_BY_EXT = new Map<string, SupportedFileTypeConfig>(
  SUPPORTED_FILE_TYPES.flatMap((ft) => ft.extensions.map((ext) => [ext.toLowerCase(), ft]))
);

/** Look up config by fileType key — O(1) */
export const FILE_TYPE_BY_KEY = new Map<string, SupportedFileTypeConfig>(
  SUPPORTED_FILE_TYPES.map((ft) => [ft.fileType, ft])
);

/** Flat list of every accepted MIME type — used by Multer filter */
export const ALL_ACCEPTED_MIME_TYPES: string[] = SUPPORTED_FILE_TYPES.flatMap((ft) => ft.mimeTypes);

/** Max file size across all types — used as the Multer ceiling */
export const GLOBAL_MAX_FILE_SIZE_BYTES: number = Math.max(
  ...SUPPORTED_FILE_TYPES.map((ft) => ft.maxFileSizeBytes)
);
