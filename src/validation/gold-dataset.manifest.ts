/**
 * Gold dataset manifest helpers — metadata/schema only.
 * Does not generate or require binary sample files.
 */

import type {
  GoldDatasetManifest,
  GoldDatasetRelationship,
  GoldDatasetSample,
} from './types';

/** Canonical relationship catalog for the gold dataset. */
export const GOLD_DATASET_RELATIONSHIPS: readonly GoldDatasetRelationship[] = [
  'ORIGINAL',
  'JPEG_RECOMPRESSION',
  'PNG_CONVERSION',
  'RESIZE',
  'CROP',
  'SCREENSHOT',
  'METADATA_REMOVED',
  'BRIGHTNESS_ADJUSTMENT',
  'CONTRAST_ADJUSTMENT',
  'WATERMARK_ADDED',
  'WATERMARK_REMOVED',
  'PDF_EXPORT',
  'VIDEO_TRANSCODE',
  'AUDIO_RECOMPRESSION',
  'UNRELATED',
] as const;

export const GOLD_DATASET_MANIFEST_SCHEMA = 'enterprise-gold-dataset-manifest-v1' as const;

/**
 * Empty scaffold manifest — entries are placeholders (paths may not exist).
 * Used as the metadata contract for future dataset population.
 */
export function createEmptyGoldDatasetManifest(
  description = 'PINIT Enterprise DNA gold dataset (metadata only)',
): GoldDatasetManifest {
  return {
    schema: GOLD_DATASET_MANIFEST_SCHEMA,
    version: '0.1.0-scaffold',
    description,
    createdAt: new Date().toISOString(),
    samples: [],
  };
}

/**
 * Build placeholder sample rows for every supported relationship.
 * Paths are relative placeholders only — no files are created.
 */
export function createScaffoldGoldDatasetSamples(): GoldDatasetSample[] {
  const originalId = 'asset-original-001';
  const rows: GoldDatasetSample[] = [
    {
      sampleId: originalId,
      relativePath: 'gold/originals/asset-original-001.jpg',
      relationship: 'ORIGINAL',
      originalSampleId: null,
      mimeType: 'image/jpeg',
      expectedVerdicts: ['VERIFIED_OWNER'],
      notes: 'Placeholder — file not generated',
      tags: ['scaffold'],
    },
  ];

  const derivatives: Array<{
    relationship: GoldDatasetRelationship;
    sampleId: string;
    path: string;
    mime: string;
    expected: GoldDatasetSample['expectedVerdicts'];
  }> = [
    {
      relationship: 'JPEG_RECOMPRESSION',
      sampleId: 'asset-jpeg80-001',
      path: 'gold/derivatives/asset-jpeg80-001.jpg',
      mime: 'image/jpeg',
      expected: ['VERIFIED_COPY', 'DERIVATIVE'],
    },
    {
      relationship: 'PNG_CONVERSION',
      sampleId: 'asset-png-001',
      path: 'gold/derivatives/asset-png-001.png',
      mime: 'image/png',
      expected: ['VERIFIED_COPY', 'DERIVATIVE'],
    },
    {
      relationship: 'RESIZE',
      sampleId: 'asset-resize-001',
      path: 'gold/derivatives/asset-resize-001.jpg',
      mime: 'image/jpeg',
      expected: ['DERIVATIVE', 'VERIFIED_COPY'],
    },
    {
      relationship: 'CROP',
      sampleId: 'asset-crop-001',
      path: 'gold/derivatives/asset-crop-001.jpg',
      mime: 'image/jpeg',
      expected: ['DERIVATIVE', 'POSSIBLE_MATCH'],
    },
    {
      relationship: 'SCREENSHOT',
      sampleId: 'asset-screenshot-001',
      path: 'gold/derivatives/asset-screenshot-001.png',
      mime: 'image/png',
      expected: ['DERIVATIVE', 'POSSIBLE_MATCH'],
    },
    {
      relationship: 'METADATA_REMOVED',
      sampleId: 'asset-nometa-001',
      path: 'gold/derivatives/asset-nometa-001.jpg',
      mime: 'image/jpeg',
      expected: ['VERIFIED_COPY', 'POSSIBLE_MATCH', 'DERIVATIVE'],
    },
    {
      relationship: 'BRIGHTNESS_ADJUSTMENT',
      sampleId: 'asset-bright-001',
      path: 'gold/derivatives/asset-bright-001.jpg',
      mime: 'image/jpeg',
      expected: ['DERIVATIVE', 'VERIFIED_COPY', 'POSSIBLE_MATCH'],
    },
    {
      relationship: 'CONTRAST_ADJUSTMENT',
      sampleId: 'asset-contrast-001',
      path: 'gold/derivatives/asset-contrast-001.jpg',
      mime: 'image/jpeg',
      expected: ['DERIVATIVE', 'VERIFIED_COPY', 'POSSIBLE_MATCH'],
    },
    {
      relationship: 'WATERMARK_ADDED',
      sampleId: 'asset-wm-add-001',
      path: 'gold/derivatives/asset-wm-add-001.jpg',
      mime: 'image/jpeg',
      expected: ['VERIFIED_COPY', 'DERIVATIVE'],
    },
    {
      relationship: 'WATERMARK_REMOVED',
      sampleId: 'asset-wm-rm-001',
      path: 'gold/derivatives/asset-wm-rm-001.jpg',
      mime: 'image/jpeg',
      expected: ['POSSIBLE_MATCH', 'DERIVATIVE', 'INSUFFICIENT_EVIDENCE'],
    },
    {
      relationship: 'PDF_EXPORT',
      sampleId: 'asset-pdf-001',
      path: 'gold/derivatives/asset-pdf-001.pdf',
      mime: 'application/pdf',
      expected: ['DERIVATIVE', 'POSSIBLE_MATCH', 'INSUFFICIENT_EVIDENCE'],
    },
    {
      relationship: 'VIDEO_TRANSCODE',
      sampleId: 'asset-video-001',
      path: 'gold/derivatives/asset-video-001.mp4',
      mime: 'video/mp4',
      expected: ['DERIVATIVE', 'POSSIBLE_MATCH', 'INSUFFICIENT_EVIDENCE'],
    },
    {
      relationship: 'AUDIO_RECOMPRESSION',
      sampleId: 'asset-audio-001',
      path: 'gold/derivatives/asset-audio-001.mp3',
      mime: 'audio/mpeg',
      expected: ['DERIVATIVE', 'POSSIBLE_MATCH', 'INSUFFICIENT_EVIDENCE'],
    },
    {
      relationship: 'UNRELATED',
      sampleId: 'asset-unrelated-001',
      path: 'gold/negatives/asset-unrelated-001.jpg',
      mime: 'image/jpeg',
      expected: ['NO_MATCH', 'INSUFFICIENT_EVIDENCE'],
    },
  ];

  for (const d of derivatives) {
    rows.push({
      sampleId: d.sampleId,
      relativePath: d.path,
      relationship: d.relationship,
      originalSampleId: d.relationship === 'UNRELATED' ? null : originalId,
      mimeType: d.mime,
      expectedVerdicts: d.expected,
      notes: 'Placeholder — file not generated',
      tags: ['scaffold'],
    });
  }

  return rows;
}

export function createScaffoldGoldDatasetManifest(): GoldDatasetManifest {
  return {
    ...createEmptyGoldDatasetManifest(
      'Scaffold gold dataset — metadata paths only; binaries not generated',
    ),
    samples: createScaffoldGoldDatasetSamples(),
  };
}

export function validateGoldDatasetManifest(manifest: GoldDatasetManifest): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (manifest.schema !== GOLD_DATASET_MANIFEST_SCHEMA) {
    errors.push(`unexpected schema: ${manifest.schema}`);
  }
  if (!Array.isArray(manifest.samples)) {
    errors.push('samples must be an array');
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  for (const s of manifest.samples) {
    if (!s.sampleId) errors.push('sample missing sampleId');
    if (ids.has(s.sampleId)) errors.push(`duplicate sampleId: ${s.sampleId}`);
    ids.add(s.sampleId);
    if (!GOLD_DATASET_RELATIONSHIPS.includes(s.relationship)) {
      errors.push(`unknown relationship: ${s.relationship}`);
    }
    if (!s.expectedVerdicts?.length) {
      errors.push(`${s.sampleId}: expectedVerdicts required`);
    }
    if (s.relationship !== 'ORIGINAL' && s.relationship !== 'UNRELATED' && !s.originalSampleId) {
      errors.push(`${s.sampleId}: originalSampleId required for derivatives`);
    }
  }

  return { ok: errors.length === 0, errors };
}
