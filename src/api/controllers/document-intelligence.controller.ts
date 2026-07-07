/**
 * PINIT-DNA — Document Intelligence Controller (Phase 5)
 *
 * New endpoints:
 *   POST /api/v1/intelligence/ocr/:dnaRecordId       — Run OCR on a vaulted file
 *   GET  /api/v1/intelligence/search?q=...           — Semantic full-text search
 *   GET  /api/v1/intelligence/lineage/:dnaRecordId   — Document lineage graph
 *   GET  /api/v1/intelligence/duplicates             — Find duplicate clusters
 *   GET  /api/v1/intelligence/audit                  — Audit event log
 *   GET  /api/v1/intelligence/audit/:dnaRecordId     — Audit for one record
 *   GET  /api/v1/intelligence/stats                  — Intelligence stats
 */

import { Request, Response, NextFunction } from 'express';
import { prisma }                from '../../lib/prisma';
import { AppError }              from '../middleware/error.middleware';
import { getAuthUserId, assertDnaOwner, assertVaultOwner } from '../../lib/tenant-scope';
import { OcrService }            from '../../services/ocr/ocr.service';
import { SemanticSearchService } from '../../services/semantic/semantic-search.service';
import { DocumentLineageService } from '../../services/lineage/document-lineage.service';
import { auditService }          from '../../services/audit/audit.service';
import { VaultService }          from '../../services/vault/vault.service';
import { buildIntelligenceReportPayload } from '../../services/intelligence/intelligence-report.builder';

const ocrService      = new OcrService();
const searchService   = new SemanticSearchService();
const lineageService  = new DocumentLineageService();
const vaultService    = new VaultService();

// ─── POST /intelligence/ocr/:dnaRecordId ─────────────────────────────────────

export async function runOcr(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;

  try {
    const userId = getAuthUserId(req);
    await assertDnaOwner(dnaRecordId, userId);
    // Check OCR already done
    const existing = await prisma.ocrRecord.findUnique({ where: { dnaRecordId } });
    if (existing?.extractedText) {
      res.status(200).json({
        success: true, cached: true,
        ocr: {
          text:         existing.extractedText,
          wordCount:    existing.wordCount,
          confidence:   existing.confidence,
          language:     existing.language,
          processingMs: existing.processingMs,
          indexed:      existing.indexed,
        },
      });
      return;
    }

    // Load the DNA record and its vault
    const record = await prisma.dnaRecord.findUnique({
      where:   { id: dnaRecordId },
      include: { vaultRecord: true },
    });
    if (!record) return next(new AppError(404, `DNA record not found: ${dnaRecordId}`));

    // Retrieve the file from vault for OCR
    let ocrResult;
    if (record.vaultRecord) {
      const retrieved = await vaultService.retrieve(record.vaultRecord.id, userId);
      const mime      = record.vaultRecord.originalMimeType;

      if (mime === 'application/pdf') {
        ocrResult = await ocrService.extractFromPdf(retrieved.originalBuffer);
      } else {
        ocrResult = await ocrService.extractText(retrieved.originalBuffer, mime);
      }
    } else {
      ocrResult = { text: '', confidence: 0, wordCount: 0, language: 'eng', processingMs: 0, success: false, error: 'File not in vault' };
    }

    // Persist OCR result
    await prisma.ocrRecord.upsert({
      where:  { dnaRecordId },
      create: {
        dnaRecordId,
        extractedText: ocrResult.text || null,
        wordCount:     ocrResult.wordCount,
        confidence:    ocrResult.confidence,
        language:      ocrResult.language,
        processingMs:  ocrResult.processingMs,
        indexed:       false,
      },
      update: {
        extractedText: ocrResult.text || null,
        wordCount:     ocrResult.wordCount,
        confidence:    ocrResult.confidence,
        processingMs:  ocrResult.processingMs,
      },
    });

    // Index for semantic search if text extracted
    if (ocrResult.text && ocrResult.wordCount > 5) {
      await searchService.indexDocument({
        dnaRecordId,
        filename: record.imageFilename,
        fileType: record.fileType ?? 'IMAGE',
        text:     ocrResult.text,
      });
      await prisma.ocrRecord.update({ where: { dnaRecordId }, data: { indexed: true } });
    }

    // Audit
    await auditService.log({
      eventType: 'OCR_EXTRACTED', dnaRecordId,
      filename: record.imageFilename, fileType: record.fileType ?? undefined,
      detail: { wordCount: ocrResult.wordCount, confidence: ocrResult.confidence },
      req,
    });

    res.status(200).json({
      success: true, cached: false,
      ocr: {
        text:       ocrResult.text,
        wordCount:  ocrResult.wordCount,
        confidence: ocrResult.confidence,
        language:   ocrResult.language,
        processingMs: ocrResult.processingMs,
        indexed:    ocrResult.wordCount > 5,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/search?q=... ──────────────────────────────────────────

export async function semanticSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  const query  = (req.query['q'] as string) ?? '';
  const topK   = Math.min(parseInt(req.query['limit'] as string ?? '10', 10), 50);

  if (!query.trim()) {
    res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
    return;
  }

  try {
    const userId = getAuthUserId(req);
    const results = await searchService.search(query, topK);

    const ownedIds = new Set(
      (await prisma.dnaRecord.findMany({ where: { ownerUserId: userId }, select: { id: true } }))
        .map((r) => r.id),
    );
    const filtered = results.filter((r: { dnaRecordId?: string }) =>
      r.dnaRecordId && ownedIds.has(r.dnaRecordId),
    );

    await auditService.log({
      eventType: 'SEMANTIC_SEARCH',
      detail: { query, resultCount: filtered.length },
      req,
    });

    res.status(200).json({
      success: true,
      query,
      count:   filtered.length,
      results: filtered,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/lineage/:dnaRecordId ───────────────────────────────────

export async function getLineage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  try {
    await assertDnaOwner(dnaRecordId, getAuthUserId(req));
    const graph = await lineageService.getLineage(dnaRecordId);
    res.status(200).json({ success: true, dnaRecordId, ...graph });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/duplicates ─────────────────────────────────────────────

export async function getDuplicates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const clusters = await lineageService.getDuplicateClusters(userId);
    res.status(200).json({
      success: true,
      totalClusters: clusters.length,
      totalDuplicateFiles: clusters.reduce((s, c) => s + c.length, 0),
      clusters,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/audit ──────────────────────────────────────────────────

export async function getAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  const limit = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200);
  try {
    const userId = getAuthUserId(req);
    const events = await auditService.getRecentEvents(limit, userId);
    res.status(200).json({ success: true, count: events.length, events });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/audit/:dnaRecordId ─────────────────────────────────────

export async function getAuditForRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  try {
    await assertDnaOwner(dnaRecordId, getAuthUserId(req));
    const events = await auditService.getEventsForRecord(dnaRecordId);
    res.status(200).json({ success: true, dnaRecordId, count: events.length, events });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/audit/export ──────────────────────────────────────────

export async function exportAuditCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to, eventType } = req.query as Record<string, string>;
    const userId = getAuthUserId(req);
    const csv = await auditService.exportCsv({ from, to, eventType, userId });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/report/:vaultId ───────────────────────────────────────

export async function getIntelligenceReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { vaultId } = req.params;
  try {
    await assertVaultOwner(vaultId, getAuthUserId(req));
    const payload = await buildIntelligenceReportPayload(vaultId);
    if (!payload) {
      res.status(404).json({ success: false, error: `Vault record not found: ${vaultId}` });
      return;
    }
    res.json({ success: true, ...payload });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/stats ──────────────────────────────────────────────────

export async function getIntelligenceStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const ownedDnaIds = (await prisma.dnaRecord.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    })).map((d) => d.id);

    const [ocrStats, lineageCount, auditStats, indexSize] = await Promise.all([
      prisma.ocrRecord.aggregate({
        where: { dnaRecordId: { in: ownedDnaIds } },
        _count: true, _sum: { wordCount: true }, _avg: { confidence: true },
      }),
      prisma.documentLineage.count({
        where: {
          OR: [
            { fromDnaRecordId: { in: ownedDnaIds } },
            { toDnaRecordId: { in: ownedDnaIds } },
          ],
        },
      }),
      auditService.getStats(userId),
      searchService.getIndexSize().catch(() => 0),
    ]);

    res.status(200).json({
      success: true,
      intelligence: {
        ocr: {
          totalExtracted:  ocrStats._count,
          totalWords:      ocrStats._sum.wordCount ?? 0,
          avgConfidence:   Math.round((ocrStats._avg.confidence ?? 0) * 100) / 100,
          indexedDocuments: indexSize,
        },
        lineage: {
          totalRelationships: lineageCount,
        },
        audit: auditStats,
      },
    });
  } catch (err) {
    next(err);
  }
}
