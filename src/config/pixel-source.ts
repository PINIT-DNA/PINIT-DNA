/**
 * Pixel-source investigation policy.
 * Localization is 1×1 on the upload; authentication remains a surrounding region (not a Vault ID in the RGB sample).
 */

function num(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const pixelSourceConfig = {
  /** Patch used to justify a hovered pixel (spec evidenceRadius). */
  evidenceRadiusPx: num('PIXEL_EVIDENCE_RADIUS', 16),
  /** Connected green area below this stays GREY (not GREEN). */
  minAuthenticableAreaPx: num('PIXEL_MIN_AUTHENTICABLE_AREA', 256),
  /** Mean RGB distance still accepted as vault-origin after JPEG / mild photometric change. */
  greenMax: num('PIXEL_GREEN_MAX', 28),
  /** Mean RGB distance treated as confident non-vault inside a mapped region. */
  orangeMin: num('PIXEL_ORANGE_MIN', 52),
  minHomographyInliers: num('PIXEL_MIN_HOMOGRAPHY_INLIERS', 8),
  maskEncoding: 'png_l' as const,
};
