/**
 * PINIT Enterprise Identification Engine — phased roadmap configuration.
 *
 * Phase 1 (CURRENT): World-class identification — must hit 95%+ confidence consistently
 * Phase 2: Robust invisible watermark (DCT/DWT/ECC/redundant regions)
 * Phase 3: Extended DNA matching (SIFT, frequency, noise, PRNU)
 * Phase 4: Confidence fusion weights (implemented in confidence-fusion-engine)
 * Phase 5: Enterprise scanner (perspective, moiré, OCR pipeline)
 * Phase 6: Public crawler (disabled until Phase 1–5 stable)
 */
function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

function intEnv(key: string, fallback: number): number {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const pinitIdentificationConfig = {
  /** Phase 1 — core identification engine */
  enabled: flag('PINIT_IDENTIFICATION_ENGINE_ENABLED', true),
  identifyThreshold: intEnv('PINIT_IDENTIFY_THRESHOLD', 88),
  highConfidenceThreshold: intEnv('PINIT_HIGH_CONFIDENCE_THRESHOLD', 95),

  deepCompareTopN: intEnv('PINIT_DEEP_COMPARE_TOP_N', 5),
  cameraPhashThreshold: parseFloat(process.env['PINIT_CAMERA_PHASH_THRESHOLD'] ?? '0.52'),
  standardPhashThreshold: parseFloat(process.env['PINIT_STANDARD_PHASH_THRESHOLD'] ?? '0.65'),

  /** Phase 2 — robust watermark (DCT/DWT/ECC) — scaffold only until Phase 1 stable */
  phase2WatermarkEcc: flag('PINIT_PHASE2_WATERMARK_ECC', false),
  phase2RedundantRegions: flag('PINIT_PHASE2_REDUNDANT_REGIONS', false),

  /** Phase 5 — enterprise scanner preprocessing */
  phase5ScannerPipeline: flag('PINIT_PHASE5_SCANNER_PIPELINE', true),

  /** Phase 6 — public crawler (OFF until identification is enterprise-grade) */
  phase6CrawlerEnabled: flag('PINIT_PHASE6_CRAWLER_ENABLED', false),
} as const;
