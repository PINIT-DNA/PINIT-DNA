/**
 * PINIT-DNA — Content Extractor Service (Phases 1-2)
 *
 * Extracts rich content from vault files for accurate AI indexing.
 * Supports: PDF text, DOCX/PPTX text, TXT/CSV/JSON, image OCR.
 * Integrates with Apache Tika when available (optional).
 * Falls back gracefully on any failure.
 */

import { prisma }       from '../../lib/prisma';
import { logger }       from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { extractDocumentText } from '../text-extraction/document-text-extractor';
import { tikaService }  from '../tika/tika.service';
import { aiService }    from '../ai/ai-embeddings.service';

const vaultService = new VaultService();

export interface ContentProfile {
  dnaRecordId:    string;
  filename:       string;
  fileType:       string;
  mimeType:       string;

  // Extracted content
  bodyText:       string;    // main document text
  title:          string;    // document title
  author:         string;    // document author
  keywords:       string;    // comma-separated keywords
  metadata:       Record<string, string>;

  // Quality metrics
  wordCount:      number;
  confidence:     number;    // 0–100
  extractionMethod: string;  // "ocr" | "tika" | "text-extraction" | "filename"
  ocrStatus:      string;    // PENDING | PROCESSING | COMPLETE | FAILED

  // Combined text for FAISS indexing
  indexText:      string;    // title + author + keywords + bodyText (deduplicated)
}

export class ContentExtractorService {
  /**
   * Extract full content profile from a DNA record's vault file.
   * Updates ocr_records table with status and extracted text.
   * Returns a ContentProfile ready for FAISS indexing.
   */
  async extract(dnaRecordId: string): Promise<ContentProfile | null> {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      include: { vaultRecord: true, ocrRecord: true },
    });

    if (!record) return null;

    const filename = record.imageFilename;
    const mimeType = record.imageMimeType;
    const fileType = record.fileType ?? 'IMAGE';

    // Mark OCR as PROCESSING
    await this.upsertOcr(dnaRecordId, 'PROCESSING', '', 0, 0);

    try {
      let profile = this.emptyProfile(dnaRecordId, filename, fileType, mimeType);

      // ── Try Tika first (metadata-rich) ─────────────────────────────────────
      if (record.vaultRecord && await tikaService.isAvailable()) {
        try {
          const retrieved = await vaultService.retrieve(record.vaultRecord.id);
          const tikaResult = await tikaService.extract(retrieved.originalBuffer, mimeType);
          if (tikaResult.available && (tikaResult.text.length > 10 || Object.keys(tikaResult.metadata).length > 2)) {
            const norm = tikaService.normalize(tikaResult.metadata);
            profile.bodyText   = tikaResult.text;
            profile.title      = norm.title ?? this.cleanFilename(filename);
            profile.author     = norm.author ?? '';
            profile.metadata   = Object.fromEntries(Object.entries(norm).filter(([,v]) => v != null)) as Record<string, string>;
            profile.extractionMethod = 'tika';
            profile.wordCount  = tikaResult.text.split(/\s+/).filter(Boolean).length;
            profile.confidence = 90;
            logger.debug('Tika extraction succeeded', { filename, words: profile.wordCount });
          }
        } catch { /* fall through to other methods */ }
      }

      // ── Text extraction for text-based files ─────────────────────────────
      if (!profile.bodyText && record.vaultRecord) {
        try {
          const retrieved = await vaultService.retrieve(record.vaultRecord.id);
          const extracted = await extractDocumentText(retrieved.originalBuffer, mimeType, filename);
          if (extracted.success && extracted.wordCount > 3) {
            profile.bodyText   = extracted.text;
            profile.wordCount  = extracted.wordCount;
            profile.confidence = 85;
            profile.extractionMethod = 'text-extraction';
          }
        } catch { /* fall through */ }
      }

      // ── OCR for images via Python AI ─────────────────────────────────────
      if (!profile.bodyText && record.vaultRecord && mimeType.startsWith('image/')) {
        try {
          const retrieved = await vaultService.retrieve(record.vaultRecord.id);
          const ocrResult = await aiService.extractTextOcr(
            retrieved.originalBuffer, filename, mimeType
          );
          if (ocrResult && ocrResult.wordCount > 2) {
            profile.bodyText   = ocrResult.text;
            profile.wordCount  = ocrResult.wordCount;
            profile.confidence = 75;
            profile.extractionMethod = 'ocr';
          }
        } catch { /* fall through */ }
      }

      // ── Use existing OCR record if available ──────────────────────────────
      if (!profile.bodyText && record.ocrRecord?.extractedText) {
        profile.bodyText  = record.ocrRecord.extractedText;
        profile.wordCount = record.ocrRecord.wordCount;
        profile.confidence = Math.round(record.ocrRecord.confidence);
        profile.extractionMethod = 'cached-ocr';
      }

      // ── Fallback: filename as text ────────────────────────────────────────
      if (!profile.bodyText) {
        profile.bodyText   = this.cleanFilename(filename);
        profile.wordCount  = profile.bodyText.split(/\s+/).length;
        profile.confidence = 20;
        profile.extractionMethod = 'filename';
      }

      // Title fallback
      if (!profile.title) profile.title = this.cleanFilename(filename);

      // Build combined index text (content-first, filename as supplement)
      // Use full body text — CMR at pos 2697-3626 must be included
      profile.indexText = [
        profile.title,
        profile.author,
        profile.keywords,
        profile.bodyText,   // FULL body text — no truncation here
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      profile.ocrStatus = 'COMPLETE';

      // Persist OCR record
      await this.upsertOcr(
        dnaRecordId,
        'COMPLETE',
        profile.bodyText,
        profile.wordCount,
        profile.confidence
      );

      logger.info('Content extracted', {
        filename, method: profile.extractionMethod,
        words: profile.wordCount, confidence: profile.confidence,
      });

      return profile;

    } catch (err) {
      const msg = String(err);
      await this.upsertOcr(dnaRecordId, 'FAILED', '', 0, 0, msg);
      logger.error('Content extraction failed', { filename, error: msg });
      return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private emptyProfile(id: string, filename: string, fileType: string, mimeType: string): ContentProfile {
    return {
      dnaRecordId: id, filename, fileType, mimeType,
      bodyText: '', title: '', author: '', keywords: '', metadata: {},
      wordCount: 0, confidence: 0, extractionMethod: 'none',
      ocrStatus: 'PROCESSING', indexText: '',
    };
  }

  private cleanFilename(filename: string): string {
    return filename
      .replace(/\.[^.]+$/, '')        // remove extension
      .replace(/[_\-\.]/g, ' ')       // separators → spaces
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → words
      .replace(/\d{6,}/g, '')         // remove long numbers (timestamps)
      .replace(/\s+/g, ' ').trim();
  }

  private async upsertOcr(
    dnaRecordId: string,
    status: string,
    text: string,
    wordCount: number,
    confidence: number,
    errorMessage?: string
  ): Promise<void> {
    await prisma.ocrRecord.upsert({
      where:  { dnaRecordId },
      create: {
        dnaRecordId, ocrStatus: status,
        extractedText: text || null, wordCount, confidence,
        language: 'eng', processingMs: 0, indexed: false,
        errorMessage: errorMessage ?? null,
      },
      update: {
        ocrStatus: status,
        extractedText: text || null,
        wordCount, confidence,
        errorMessage: errorMessage ?? null,
      },
    }).catch(() => {/* non-fatal */});
  }
}

export const contentExtractor = new ContentExtractorService();
