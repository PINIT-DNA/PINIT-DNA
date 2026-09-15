/**
 * PinIT DNA vNext — additive provenance layer.
 * Does not replace 15-layer DNA, vault AES-GCM, or 8×8 HMAC (DNA A).
 */

function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const DNA_VNEXT_VERSION = '1.0.0';
export const DNA_VNEXT_WATERMARK_VERSION = 'robust-dwt-v1';
export const DNA_VNEXT_AUTH_VERSION = 'hmac-hierarchy-v1';
export const DNA_VNEXT_FILE_ANALYSIS_KEY = 'pinitDnaVnextV1';

export const dnaVnextConfig = {
  enabled: flag('DNA_VNEXT_ENABLED', true),
  /** DNA B on protected download / export. Vault store remains skip-watermark for speed. */
  watermarkOnProtectedDownload: flag('DNA_VNEXT_WATERMARK_ON_DOWNLOAD', true),
  secret: optional(
    'DNA_VNEXT_SECRET',
    optional('BLOCK_DNA_SECRET', optional('SPATIAL_AUTH_SECRET', optional('LSB_SIGNATURE_SECRET', 'dev_dna_vnext_secret'))),
  ),
} as const;

export function isDnaVnextEnabled(): boolean {
  return dnaVnextConfig.enabled;
}
