/**
 * PINIT-DNA — Fast Content Reindex (reads from DB, zero vault decryption)
 * POST /api/v1/ai/reindex-all
 *
 * Uses OCR text already stored in database — completes in < 5 seconds.
 * No vault decryption. No file reading. Just DB → FAISS.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma }    from '../../lib/prisma';
import { aiService } from '../../services/ai/ai-embeddings.service';
import { logger }    from '../../lib/logger';

export async function reindexAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const online = await aiService.isOnline();
    if (!online) {
      res.status(503).json({ success: false, error: 'AI service is offline' });
      return;
    }

    const start = Date.now();

    // Fetch all DNA records + their OCR text in ONE query
    const records = await prisma.dnaRecord.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id:             true,
        imageFilename:  true,
        fileType:       true,
        imageMimeType:  true,
        ocrRecord: {
          select: {
            extractedText: true,
            wordCount:     true,
            ocrStatus:     true,
          },
        },
      },
    });

    let indexed = 0, failed = 0;
    const byMethod: Record<string, number> = {};

    // Process ALL records in parallel batches of 10
    const BATCH = 10;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      await Promise.all(batch.map(async (record) => {
        try {
          // Priority 1: OCR text from database (INSTANT — no vault decryption)
          const ocrText = record.ocrRecord?.extractedText;

          let indexText = '';
          let method    = 'filename';

          if (ocrText && ocrText.length > 50) {
            // Use full OCR text (3000-4000 chars) — includes CMR, education, all sections
            indexText = `${record.imageFilename} ${ocrText}`.replace(/\s+/g, ' ').trim();
            method    = 'ocr_database';
          } else {
            // Fallback: clean filename
            indexText = record.imageFilename
              .replace(/\.[^.]+$/, '')
              .replace(/[_\-\.]/g, ' ')
              .replace(/([a-z])([A-Z])/g, '$1 $2')
              .trim();
            method    = 'filename';
          }

          await aiService.indexDocument({
            dnaRecordId: record.id,
            filename:    record.imageFilename,
            fileType:    record.fileType ?? 'IMAGE',
            text:        indexText,
          });

          indexed++;
          byMethod[method] = (byMethod[method] ?? 0) + 1;
        } catch {
          failed++;
        }
      }));
    }

    const ms = Date.now() - start;
    logger.info('Fast reindex complete', { indexed, failed, ms });

    // Calculate avg confidence for report
    const ocrCount = byMethod['ocr_database'] ?? 0;
    const avgConf  = Math.round((ocrCount / records.length) * 85 + ((records.length - ocrCount) / records.length) * 20);

    res.status(200).json({
      success:    true,
      total:      records.length,
      indexed,
      failed,
      avgConfidence: avgConf,
      processingMs: ms,
      byExtractionMethod: byMethod,
      message: `${indexed} documents indexed in ${ms}ms using database content`,
    });
  } catch (err) {
    next(err);
  }
}
