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

export interface ForensicPreprocessorOptions {
  /** Investigation / compare fast path — fewer variants, much faster */
  fast?: boolean;
  /** Unified investigation — original + normalized only (skip denoise/upscale) */
  minimal?: boolean;
  /** Enterprise camera-scan pipeline — moiré, reflection, screen boundary */
  scanner?: boolean;
}

export class ForensicImagePreprocessor {
  async generateVariants(
    buffer: Buffer,
    mimeType: string,
    options?: ForensicPreprocessorOptions,
  ): Promise<ForensicImageVariant[]> {
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

      if (options?.minimal) {
        return variants;
      }

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

      const recompressed = await sharp(buffer)
        .rotate()
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
      variants.push({ label: 'jpeg_recompress', buffer: recompressed, mimeType: 'image/jpeg' });

      if (options?.fast) {
        return variants;
      }

      // Enterprise camera-scan pipeline (Phase 5)
      if (options?.scanner) {
        const moireReduced = await sharp(buffer)
          .rotate()
          .blur(0.6)
          .sharpen({ sigma: 1.2 })
          .normalize()
          .jpeg({ quality: 90 })
          .toBuffer();
        variants.push({ label: 'moire_reduction', buffer: moireReduced, mimeType: 'image/jpeg' });

        const reflectionRemoved = await sharp(buffer)
          .rotate()
          .modulate({ brightness: 1.08, saturation: 0.85 })
          .gamma(1.1)
          .jpeg({ quality: 91 })
          .toBuffer();
        variants.push({ label: 'reflection_removal', buffer: reflectionRemoved, mimeType: 'image/jpeg' });

        if (w > 120 && h > 120) {
          const marginX = Math.round(w * 0.04);
          const marginY = Math.round(h * 0.04);
          const screenCrop = await sharp(buffer)
            .extract({
              left: marginX,
              top: marginY,
              width: w - marginX * 2,
              height: h - marginY * 2,
            })
            .jpeg({ quality: 92 })
            .toBuffer();
          variants.push({ label: 'screen_boundary', buffer: screenCrop, mimeType: 'image/jpeg' });
        }

        const perspectiveCorrect = await sharp(buffer)
          .rotate(-1.5)
          .affine([1, 0.02, 0, 1], { background: { r: 0, g: 0, b: 0 } })
          .jpeg({ quality: 90 })
          .toBuffer();
        variants.push({ label: 'perspective_correct', buffer: perspectiveCorrect, mimeType: 'image/jpeg' });
      }

      const rotated = await sharp(buffer)
        .rotate(2)
        .jpeg({ quality: 88 })
        .toBuffer();
      variants.push({ label: 'perspective_hint', buffer: rotated, mimeType: 'image/jpeg' });

      // Phase 1 / Phase 5 — social & messenger compression simulation
      const whatsapp = await sharp(buffer).rotate().jpeg({ quality: 55, mozjpeg: true }).toBuffer();
      variants.push({ label: 'whatsapp_compress', buffer: whatsapp, mimeType: 'image/jpeg' });

      const telegram = await sharp(buffer).rotate().webp({ quality: 50 }).toBuffer();
      variants.push({ label: 'telegram_compress', buffer: telegram, mimeType: 'image/webp' });

      const instagram = await sharp(buffer)
        .rotate()
        .resize({ width: Math.min(w, 1080), height: Math.min(h, 1080), fit: 'inside' })
        .jpeg({ quality: 82 })
        .toBuffer();
      variants.push({ label: 'instagram_sim', buffer: instagram, mimeType: 'image/jpeg' });

      if (w > 64 && h > 64) {
        const cropW = Math.round(w * 0.82);
        const cropH = Math.round(h * 0.82);
        const cropped = await sharp(buffer)
          .extract({
            left: Math.round((w - cropW) / 2),
            top: Math.round((h - cropH) / 2),
            width: cropW,
            height: cropH,
          })
          .jpeg({ quality: 90 })
          .toBuffer();
        variants.push({ label: 'center_crop', buffer: cropped, mimeType: 'image/jpeg' });
      }

      const bright = await sharp(buffer).rotate().modulate({ brightness: 1.22 }).jpeg({ quality: 88 }).toBuffer();
      variants.push({ label: 'brightness_up', buffer: bright, mimeType: 'image/jpeg' });

      const dark = await sharp(buffer).rotate().modulate({ brightness: 0.78 }).jpeg({ quality: 88 }).toBuffer();
      variants.push({ label: 'brightness_down', buffer: dark, mimeType: 'image/jpeg' });

      const rotate90 = await sharp(buffer).rotate(90).jpeg({ quality: 90 }).toBuffer();
      variants.push({ label: 'rotate_90', buffer: rotate90, mimeType: 'image/jpeg' });
    } catch (err) {
      logger.debug('[ForensicPreprocessor] Variant generation partial', { error: String(err) });
    }

    return variants;
  }
}

export const forensicImagePreprocessor = new ForensicImagePreprocessor();
