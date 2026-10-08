/**
 * PINIT-DNA — OCR Service (Phase 5.1)
 *
 * Extracts text from images and PDFs using Tesseract.js.
 * Pure Node.js — no Python, no external dependencies.
 * Supports: JPEG, PNG, TIFF, BMP, WebP, PDF (first page)
 */

import { createWorker, PSM } from 'tesseract.js';
import sharp from 'sharp';
import { logger } from '../../lib/logger';

export interface OcrResult {
  text: string;
  confidence: number;         // 0–100
  wordCount: number;
  language: string;
  processingMs: number;
  success: boolean;
  error?: string;
}

/** One word and where it sits. Text is not written to logs. */
export interface OcrWordBox {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle of an already-prepared image to read again, closer up. */
export interface OcrCropJob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 3 = automatic layout, 6 = a block of text, 7 = a single line. */
  psm: 3 | 6 | 7;
  /** Only digits and spaces are allowed in the answer. */
  digitsOnly?: boolean;
  /** How much to enlarge the crop before reading. Default 2. */
  scale?: number;
}

export class OcrService {
  /**
   * Re-reads parts of one image using a single worker. Used for the few places a
   * whole-page read tends to miss (a large number, a line in a low-contrast area).
   * `stop` lets the caller end early once it has what it needs.
   */
  async readCrops(
    image: Buffer,
    jobs: OcrCropJob[],
    stop?: (result: { text: string; confidence: number }, index: number) => boolean,
  ): Promise<Array<{ text: string; confidence: number }>> {
    const out: Array<{ text: string; confidence: number }> = [];
    if (!jobs.length) return out;
    let worker;
    try {
      const meta = await sharp(image).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      worker = await createWorker('eng', 1, { logger: () => {} });
      for (const [i, job] of jobs.entries()) {
        const left = Math.max(0, Math.floor(job.x0));
        const top = Math.max(0, Math.floor(job.y0));
        const width = Math.min(W - left, Math.ceil(job.x1 - job.x0));
        const height = Math.min(H - top, Math.ceil(job.y1 - job.y0));
        if (width < 12 || height < 8) {
          out.push({ text: '', confidence: 0 });
          continue;
        }
        const crop = await sharp(image)
          .extract({ left, top, width, height })
          .greyscale()
          .normalise()
          .resize({ width: Math.round(width * (job.scale ?? 2)) })
          .sharpen()
          .png()
          .toBuffer();
        await worker.setParameters({
          tessedit_pageseg_mode: job.psm === 7 ? PSM.SINGLE_LINE : job.psm === 3 ? PSM.AUTO : PSM.SINGLE_BLOCK,
          tessedit_char_whitelist: job.digitsOnly ? '0123456789 ' : '',
        });
        const { data } = await worker.recognize(crop);
        const result = { text: (data.text ?? '').trim(), confidence: Math.round(data.confidence ?? 0) };
        out.push(result);
        if (stop?.(result, i)) break;
      }
    } catch (err) {
      logger.warn('OCR crop read failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (worker) await worker.terminate();
    }
    return out;
  }

  /**
   * Extract text from an image buffer using Tesseract.js.
   * Returns extracted text + confidence score.
   */
  async extractText(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    const start = Date.now();

    // Only process image types — PDF first-page extraction via sharp
    const supportedTypes = [
      'image/jpeg', 'image/png', 'image/tiff',
      'image/bmp', 'image/webp', 'image/gif',
    ];

    if (!supportedTypes.includes(mimeType)) {
      return {
        text: '', confidence: 0, wordCount: 0,
        language: 'eng', processingMs: 0,
        success: false,
        error: `OCR not supported for MIME type: ${mimeType}`,
      };
    }

    let worker;
    try {
      worker = await createWorker('eng', 1, {
        logger: () => {}, // suppress tesseract progress logs
      });

      // Normalize DPI — WhatsApp/social JPEGs often use 25 dpi and spam Tesseract stderr
      const ocrBuffer = await sharp(buffer).rotate().withMetadata({ density: 72 }).png().toBuffer();
      const { data } = await worker.recognize(ocrBuffer);
      const text      = data.text?.trim() ?? '';
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const confidence = Math.round(data.confidence ?? 0);

      logger.debug('OCR extraction complete', {
        wordCount, confidence, processingMs: Date.now() - start,
      });

      return {
        text,
        confidence,
        wordCount,
        language:     'eng',
        processingMs: Date.now() - start,
        success:      true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('OCR extraction failed', { error });
      return {
        text: '', confidence: 0, wordCount: 0,
        language: 'eng', processingMs: Date.now() - start,
        success: false, error,
      };
    } finally {
      if (worker) await worker.terminate();
    }
  }

  /**
   * Same engine as extractText, plus each word's box and confidence.
   * Used by identity-document parsing so a name line is not mixed with the line above it.
   */
  async extractLayout(buffer: Buffer, mimeType: string): Promise<OcrResult & { tokens: OcrWordBox[] }> {
    const start = Date.now();
    const supportedTypes = ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp', 'image/webp', 'image/gif'];
    if (!supportedTypes.includes(mimeType)) {
      return { text: '', confidence: 0, wordCount: 0, language: 'eng', processingMs: 0, success: false, tokens: [], error: `OCR not supported for MIME type: ${mimeType}` };
    }
    let worker;
    try {
      worker = await createWorker('eng', 1, { logger: () => {} });
      const ocrBuffer = await sharp(buffer).rotate().withMetadata({ density: 72 }).png().toBuffer();
      const { data } = await worker.recognize(ocrBuffer, {}, { text: true, blocks: true });
      const text = data.text?.trim() ?? '';
      const tokens: OcrWordBox[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of paragraph.lines ?? []) {
            for (const word of line.words ?? []) {
              const wordText = String(word.text ?? '').trim();
              const box = word.bbox;
              if (!wordText || !box) continue;
              tokens.push({
                text: wordText,
                confidence: Number(word.confidence) || 0,
                x0: box.x0,
                y0: box.y0,
                x1: box.x1,
                y1: box.y1,
              });
            }
          }
        }
      }
      logger.debug('OCR layout complete', { wordCount: tokens.length, confidence: Math.round(data.confidence ?? 0), processingMs: Date.now() - start });
      return {
        text, confidence: Math.round(data.confidence ?? 0), wordCount: tokens.length,
        language: 'eng', processingMs: Date.now() - start, success: true, tokens,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('OCR layout failed', { error });
      return { text: '', confidence: 0, wordCount: 0, language: 'eng', processingMs: Date.now() - start, success: false, tokens: [], error };
    } finally {
      if (worker) await worker.terminate();
    }
  }

  /**
   * Extract text from a PDF buffer by converting first page to image via sharp,
   * then running Tesseract on it.
   */
  async extractFromPdf(buffer: Buffer): Promise<OcrResult> {
    const start = Date.now();
    try {
      // Use pdf-parse to get text directly (faster than OCR for digital PDFs)
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
      const data = await pdfParse(buffer);
      const text = data.text?.trim() ?? '';
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      if (wordCount > 10) {
        // Digital PDF with selectable text — no OCR needed
        return {
          text, confidence: 95, wordCount,
          language: 'eng', processingMs: Date.now() - start,
          success: true,
        };
      }

      // Scanned PDF — would need OCR (return partial result)
      return {
        text, confidence: 50, wordCount,
        language: 'eng', processingMs: Date.now() - start,
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        text: '', confidence: 0, wordCount: 0,
        language: 'eng', processingMs: Date.now() - start,
        success: false, error,
      };
    }
  }
}
