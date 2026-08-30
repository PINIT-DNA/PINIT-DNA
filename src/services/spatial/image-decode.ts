/**
 * Spatial Auth Phase 1 — image decode policy
 *
 * Matches DNA L1–L6: RGB, remove alpha, NO EXIF orientation rotate.
 * Policy id: file-pixel-order-v1
 */

import sharp from 'sharp';
import { SPATIAL_ORIENTATION_POLICY } from '../../config/spatial-auth';

export interface DecodedSpatialImage {
  rgb: Buffer;
  width: number;
  height: number;
  orientationPolicy: typeof SPATIAL_ORIENTATION_POLICY;
  channels: 3;
}

/**
 * Decode image bytes to RGB raw under the enrollment/verify policy.
 * EXIF metadata changes that do not alter stored pixel order will not
 * change the RGB buffer (Mode A exact integrity is pixel-geometry based).
 */
export async function decodeImageForSpatialAuth(
  imageBuffer: Buffer,
): Promise<DecodedSpatialImage> {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Expected 3-channel RGB after removeAlpha, got ${info.channels}`);
  }

  return {
    rgb: data,
    width: info.width,
    height: info.height,
    orientationPolicy: SPATIAL_ORIENTATION_POLICY,
    channels: 3,
  };
}
