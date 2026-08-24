/**
 * Document Pixel Protection — Phase 1 (PDF)
 *
 * Controls whether uploaded documents get their pages rasterized and run
 * through the same pixel-level protection pipeline standalone images get
 * (DNA layers, pixel HKCA tamper localization, local-DNA patch indexing).
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

export const documentPixelProtectionConfig = {
  enabled: flag('DOCUMENT_PIXEL_PROTECTION_ENABLED', true),
  /** Render DPI — higher = sharper page images but slower + larger */
  dpi: intEnv('DOCUMENT_PIXEL_PROTECTION_DPI', 150),
  /** Cap on pages protected per document (cost control for very large PDFs) */
  maxPages: intEnv('DOCUMENT_PIXEL_PROTECTION_MAX_PAGES', 40),
} as const;

export function isDocumentPixelProtectionEnabled(): boolean {
  return documentPixelProtectionConfig.enabled;
}
