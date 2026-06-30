/**
 * Forensic image preprocessing — improves recovery from camera captures,
 * screenshots, compression, and screen-moiré artifacts.
 */
import { logger } from '../../lib/logger';

export interface ForensicImageVariant {
  label: string;
  buffer: Buffer;
  mimeType: string;
}

export class ForensicImagePreprocessor {
  async generateVariants(buffer: Buffer, mimeType: string): Promise<ForensicImageVariant[]> {
    if (!mimeType.startsWith('image/')) {
      return [{ label: 'original', buffer, mimeType }];
    }

    const variants: ForensicImageVariant[] = [
      { label: 'original', buffer, mimeType },
    ];

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp') as typeof import('sharp');
      const meta = await sharp(buffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;

      const normalized = await sharp(buffer)
        .rotate()
        .normalize()
        .modulate({ brightness: 1.05, saturation: 0.92 })
        .sharpen({ sigma: 0.8 })
        .jpeg({ quality: 92 })
        .toBuffer();
      variants.push({ label: 'normalized', buffer: normalized, mimeType: 'image/jpeg' });

      const denoised = await sharp(buffer)
        .rotate()
        .median(3)
        .normalize()
        .jpeg({ quality: 90 })
        .toBuffer();
      variants.push({ label: 'denoised', buffer: denoised, mimeType: 'image/jpeg' });

      if (w > 0 && h > 0 && Math.max(w, h) < 1400) {
        const upscaled = await sharp(buffer)
          .rotate()
          .resize({ width: Math.min(w * 2, 2400), height: Math.min(h * 2, 2400), fit: 'inside' })
          .sharpen()
          .jpeg({ quality: 93 })
          .toBuffer();
        variants.push({ label: 'super_resolution', buffer: upscaled, mimeType: 'image/jpeg' });
      }

      const contrast = await sharp(buffer)
        .rotate()
        .greyscale()
        .linear(1.15, -12)
        .jpeg({ quality: 90 })
        .toBuffer();
      variants.push({ label: 'grayscale_contrast', buffer: contrast, mimeType: 'image/jpeg' });
    } catch (err) {
      logger.debug('[ForensicPreprocessor] Variant generation partial', { error: String(err) });
    }

    return variants;
  }
}

export const forensicImagePreprocessor = new ForensicImagePreprocessor();
