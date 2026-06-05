/**
 * PINIT-DNA — Auto Indexer Service
 *
 * Automatically indexes documents into Python AI FAISS after:
 *   1. DNA generation (text-based files)
 *   2. Vault store + OCR (images/PDFs)
 *
 * Fire-and-forget — never blocks the main flow.
 * Gracefully skips if Python AI service is offline.
 */

import { extractDocumentText } from '../text-extraction/document-text-extractor';
import { aiService }           from './ai-embeddings.service';
import { logger }              from '../../lib/logger';
import { prisma }              from '../../lib/prisma';

export class AutoIndexerService {
  /**
   * Called after DNA generation.
   * Extracts text + indexes in FAISS. Non-blocking.
   */
  async indexAfterDnaGeneration(params: {
    dnaRecordId: string;
    filename:    string;
    mimeType:    string;
    fileType:    string;
    buffer:      Buffer;
  }): Promise<void> {
    // Fire-and-forget — don't await, don't block response
    this.doIndex(params).catch(err =>
      logger.debug('Auto-index failed (non-fatal)', { error: String(err) })
    );
  }

  private async doIndex(params: {
    dnaRecordId: string;
    filename:    string;
    mimeType:    string;
    fileType:    string;
    buffer:      Buffer;
  }): Promise<void> {
    // Check AI service is online
    const online = await aiService.isOnline();
    if (!online) {
      logger.debug('Auto-index skipped — AI service offline', { file: params.filename });
      return;
    }

    // Extract text
    const extracted = await extractDocumentText(params.buffer, params.mimeType, params.filename);
    if (!extracted.success || extracted.wordCount < 5) {
      logger.debug('Auto-index skipped — insufficient text', {
        file: params.filename, words: extracted.wordCount,
      });
      return;
    }

    // Index in FAISS via Python AI service
    const result = await aiService.indexDocument({
      dnaRecordId: params.dnaRecordId,
      filename:    params.filename,
      fileType:    params.fileType,
      text:        extracted.text,
    });

    if (result) {
      logger.info('Document auto-indexed in FAISS', {
        dnaRecordId: params.dnaRecordId.slice(0, 8),
        words:       extracted.wordCount,
        total:       result.totalIndexed,
      });

      // Also store in local Vectra for fallback
      try {
        const { SemanticSearchService } = await import('../semantic/semantic-search.service');
        await new SemanticSearchService().indexDocument({
          dnaRecordId: params.dnaRecordId,
          filename:    params.filename,
          fileType:    params.fileType,
          text:        extracted.text,
        });
      } catch { /* Vectra fallback non-fatal */ }
    }
  }

  /**
   * Called after vault store for OCR text extraction + indexing.
   * Handles images and scanned PDFs via Python AI OCR endpoint.
   */
  async indexAfterVaultStore(params: {
    dnaRecordId: string;
    vaultId:     string;
    filename:    string;
    mimeType:    string;
    buffer:      Buffer;
  }): Promise<void> {
    this.doOcrAndIndex(params).catch(err =>
      logger.debug('OCR auto-index failed (non-fatal)', { error: String(err) })
    );
  }

  private async doOcrAndIndex(params: {
    dnaRecordId: string;
    vaultId:     string;
    filename:    string;
    mimeType:    string;
    buffer:      Buffer;
  }): Promise<void> {
    const online = await aiService.isOnline();
    if (!online) return;

    // For images — use Python AI OCR endpoint
    const isImage = params.mimeType.startsWith('image/');
    if (isImage) {
      const ocrResult = await aiService.extractTextOcr(
        params.buffer, params.filename, params.mimeType
      );
      if (ocrResult && ocrResult.wordCount >= 5) {
        // Store in ocr_records table
        await prisma.ocrRecord.upsert({
          where:  { dnaRecordId: params.dnaRecordId },
          create: {
            dnaRecordId:   params.dnaRecordId,
            extractedText: ocrResult.text,
            wordCount:     ocrResult.wordCount,
            confidence:    0,
            language:      'eng',
            processingMs:  ocrResult.processingMs,
            indexed:       false,
          },
          update: { extractedText: ocrResult.text, wordCount: ocrResult.wordCount, indexed: false },
        }).catch(() => {/* non-fatal */});

        // Index OCR text in FAISS
        await aiService.indexDocument({
          dnaRecordId: params.dnaRecordId,
          filename:    params.filename,
          fileType:    'IMAGE',
          text:        ocrResult.text,
        });

        await prisma.ocrRecord.update({
          where: { dnaRecordId: params.dnaRecordId },
          data:  { indexed: true },
        }).catch(() => {});

        logger.info('Image OCR indexed in FAISS', {
          file:  params.filename,
          words: ocrResult.wordCount,
        });
      }
      return;
    }

    // For PDFs — try text extraction first, OCR as fallback
    if (params.mimeType === 'application/pdf') {
      const extracted = await extractDocumentText(params.buffer, params.mimeType, params.filename);
      if (extracted.success && extracted.wordCount >= 5) {
        await aiService.indexDocument({
          dnaRecordId: params.dnaRecordId,
          filename:    params.filename,
          fileType:    'PDF',
          text:        extracted.text,
        });
      }
    }
  }

  /**
   * Re-index all existing DNA records that have no FAISS entry.
   * Used for backfilling on first startup.
   */
  async backfillExistingRecords(): Promise<void> {
    const online = await aiService.isOnline();
    if (!online) return;

    try {
      const stats = await aiService.getStats();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (stats && (stats as any).activeDocuments > 0) return; // already indexed

      logger.info('Backfilling existing DNA records into FAISS…');
      const records = await prisma.ocrRecord.findMany({
        where:   { extractedText: { not: null }, indexed: false },
        include: { dnaRecord: { select: { imageFilename: true, fileType: true } } },
        take:    100,
      });

      for (const r of records) {
        if (!r.extractedText) continue;
        await aiService.indexDocument({
          dnaRecordId: r.dnaRecordId,
          filename:    r.dnaRecord.imageFilename,
          fileType:    r.dnaRecord.fileType ?? 'UNKNOWN',
          text:        r.extractedText,
        });
        await prisma.ocrRecord.update({ where: { id: r.id }, data: { indexed: true } }).catch(() => {});
      }

      logger.info('Backfill complete', { count: records.length });
    } catch (err) {
      logger.debug('Backfill failed (non-fatal)', { error: String(err) });
    }
  }
}

export const autoIndexer = new AutoIndexerService();
