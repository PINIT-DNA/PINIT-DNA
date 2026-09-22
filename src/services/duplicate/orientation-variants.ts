/**
 * Orientation variants for perceptual matching.
 *
 * A perceptual hash describes what an image looks like, so it survives
 * recompression, resizing and screenshots. It does NOT survive being mirrored or
 * turned on its side: a flipped copy scores about the same as an unrelated image,
 * which makes flipping the cheapest way past the duplicate check.
 *
 * The fix needs no stored data. Instead of asking "does this image match what we
 * hold?", ask it about each way the image could have been turned: the 8
 * orientations of a rectangle (identity, three rotations, and the mirror of each).
 * If the probe, turned one of those ways, matches a stored hash, the probe is a
 * turned copy of a registered file.
 *
 * Only the 8 lossless orientations are covered. A free rotation (5°, 17°) resamples
 * the pixels and is a different problem; it is not claimed here.
 */
import sharp from 'sharp';

export type Orientation =
  | 'identity'
  | 'rotate90' | 'rotate180' | 'rotate270'
  | 'mirror' | 'mirror-rotate90' | 'mirror-rotate180' | 'mirror-rotate270';

/** Everything except the identity, which the caller has already checked. */
export const TURNED_ORIENTATIONS: readonly Orientation[] = [
  'mirror', 'rotate180', 'rotate90', 'rotate270',
  'mirror-rotate90', 'mirror-rotate180', 'mirror-rotate270',
] as const;

/**
 * Longest side, in pixels, of the copy that is turned and re-hashed.
 *
 * The perceptual hash reduces every image to 32×32 before doing anything else, so
 * turning a 12-megapixel photo at full size only pays to rotate and re-encode
 * pixels the hash then throws away (measured: ~10 s for the 7 orientations of a
 * phone photo, past the check's time budget). Shrinking once first makes the whole
 * fallback cost a fraction of a second at any input size.
 */
export const ORIENTATION_PROBE_SIZE = 384;

/** One cheap, small copy of the upload to derive every orientation from. */
export async function shrinkForOrientationProbe(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: 'none' })
    .resize({ width: ORIENTATION_PROBE_SIZE, height: ORIENTATION_PROBE_SIZE, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

/** The probe image turned into one orientation, as an encoded image buffer. */
export async function turnImage(buffer: Buffer, orientation: Orientation): Promise<Buffer> {
  // rotate() before flop() gives each of the 8 dihedral orientations exactly once.
  let img = sharp(buffer, { failOn: 'none' });
  const mirrored = orientation.startsWith('mirror');
  const angle = orientation.includes('rotate90') ? 90
    : orientation.includes('rotate180') ? 180
    : orientation.includes('rotate270') ? 270
    : 0;
  if (angle) img = img.rotate(angle);
  if (mirrored) img = img.flop();
  return img.png({ compressionLevel: 0 }).toBuffer();
}
