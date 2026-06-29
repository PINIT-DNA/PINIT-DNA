/**
 * PINIT-DNA — Layer enhancement feature flags (v2.1 forensic engine)
 *
 * All flags default OFF or safe — existing DNA records and APIs unchanged
 * until flags are enabled in environment.
 */

function flag(key: string, defaultValue = false): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

export const dnaEnhancements = {
  /** Master switch — enables extended fingerprint bundle on generate + enhanced verify scoring */
  enabled: flag('DNA_ENHANCEMENTS_ENABLED', false),

  layer1: {
    blake3: flag('DNA_L1_BLAKE3', true),
    sha3_512: flag('DNA_L1_SHA3_512', true),
    chunkHash: flag('DNA_L1_CHUNK_HASH', true),
    chunkSizeBytes: parseInt(process.env['DNA_L1_CHUNK_SIZE'] ?? '1048576', 10),
  },

  layer2: {
    multiScaleEdges: flag('DNA_L2_MULTI_SCALE', true),
  },

  layer3: {
    blockMeanHash: flag('DNA_L3_BM_HASH', true),
    waveletHash: flag('DNA_L3_WAVELET_HASH', true),
    multiResolution: flag('DNA_L3_MULTI_RES', true),
  },

  layer4: {
    labHistogram: flag('DNA_L4_LAB', true),
    colorMoments: flag('DNA_L4_COLOR_MOMENTS', true),
    textureDescriptors: flag('DNA_L4_TEXTURE', false),
  },

  layer5: {
    extendedExif: flag('DNA_L5_EXTENDED_EXIF', true),
  },

  verify: {
    weightedScoring: flag('DNA_VERIFY_WEIGHTED', true),
    tamperClassification: flag('DNA_VERIFY_TAMPER_CLASS', true),
    includeExtendedHashes: flag('DNA_VERIFY_EXTENDED', true),
  },

  /** Experimental — requires external ML service; off by default */
  layer11: {
    clipEmbeddings: flag('DNA_L11_CLIP', false),
  },
} as const;

export type DnaEnhancementsConfig = typeof dnaEnhancements;
