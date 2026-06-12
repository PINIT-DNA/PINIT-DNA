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
import { OcrService }            from '../../services/ocr/ocr.service';
import { SemanticSearchService } from '../../services/semantic/semantic-search.service';
import { DocumentLineageService } from '../../services/lineage/document-lineage.service';
import { auditService }          from '../../services/audit/audit.service';
import { VaultService }          from '../../services/vault/vault.service';

const ocrService      = new OcrService();
const searchService   = new SemanticSearchService();
const lineageService  = new DocumentLineageService();
const vaultService    = new VaultService();

// ─── POST /intelligence/ocr/:dnaRecordId ─────────────────────────────────────

export async function runOcr(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;

  try {
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
      const retrieved = await vaultService.retrieve(record.vaultRecord.id);
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
    const results = await searchService.search(query, topK);

    await auditService.log({
      eventType: 'SEMANTIC_SEARCH',
      detail: { query, resultCount: results.length },
      req,
    });

    res.status(200).json({
      success: true,
      query,
      count:   results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/lineage/:dnaRecordId ───────────────────────────────────

export async function getLineage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  try {
    const graph = await lineageService.getLineage(dnaRecordId);
    res.status(200).json({ success: true, dnaRecordId, ...graph });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/duplicates ─────────────────────────────────────────────

export async function getDuplicates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clusters = await lineageService.getDuplicateClusters();
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
    const events = await auditService.getRecentEvents(limit);
    res.status(200).json({ success: true, count: events.length, events });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/audit/:dnaRecordId ─────────────────────────────────────

export async function getAuditForRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  try {
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
    const csv = await auditService.exportCsv({ from, to, eventType });
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
    // ── Core record ───────────────────────────────────────────────────────────
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: {
        dnaRecord: {
          include: {
            cryptoLayer:    true,
            metadataLayer:  true,
            perceptualLayer: true,
            ocrRecord:      true,
            verifications:  { orderBy: { createdAt: 'desc' }, take: 1 },
            monitorRecords: {
              include: {
                crawlResults:   { orderBy: { createdAt: 'desc' }, take: 20 },
                monitoringRuns: { orderBy: { startedAt: 'desc' }, take: 5 },
              },
            },
          },
        },
      },
    });
    if (!vault) {
      res.status(404).json({ success: false, error: `Vault record not found: ${vaultId}` });
      return;
    }

    const dna = vault.dnaRecord;

    // ── Share links + access logs ─────────────────────────────────────────────
    const shareLinks = await prisma.shareLink.findMany({
      where: { vaultId },
      include: { accessLogs: { orderBy: { createdAt: 'desc' }, take: 100 } },
    });

    // ── Evidence ──────────────────────────────────────────────────────────────
    const evidence = await prisma.evidenceRecord.findMany({
      where: { dnaRecordId: dna.id },
      orderBy: { createdAt: 'desc' },
    });

    // ── Owner ─────────────────────────────────────────────────────────────────
    const owner = await prisma.user.findFirst({ select: { shortId: true } });

    // ─── Assemble sections ────────────────────────────────────────────────────

    // Identity
    const identity = {
      ownerUserId:  owner?.shortId ?? 'PINIT-UNKNOWN',
      uploaderId:   owner?.shortId ?? 'PINIT-UNKNOWN',
      mfid:         vault.id,
      dnaRecordId:  dna.id,
      filename:     vault.originalFileName,
      mimeType:     vault.originalMimeType,
      fileSize:     vault.originalSizeBytes,
      encryptedSize: vault.encryptedSizeBytes,
      fileType:     dna.fileType ?? 'IMAGE',
      engineVersion: dna.engineVersion ?? '1.0.0',
    };

    // Provenance
    const meta = dna.metadataLayer;
    const provenance = {
      uploadedAt:   dna.createdAt.toISOString(),
      vaultedAt:    vault.createdAt.toISOString(),
      capturedAt:   meta?.capturedAt?.toISOString() ?? null,
      gpsLatitude:  meta?.gpsLatitude  ?? null,
      gpsLongitude: meta?.gpsLongitude ?? null,
      country:      null as string | null,
      city:         null as string | null,
      deviceMake:   meta?.deviceMake  ?? null,
      deviceModel:  meta?.deviceModel ?? null,
      software:     meta?.software    ?? null,
    };
    // Derive country/city from first share access if metadata GPS missing
    if (!meta?.gpsLatitude) {
      const firstAccess = shareLinks.flatMap(l => l.accessLogs).sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )[0];
      if (firstAccess) {
        provenance.country = firstAccess.country ?? null;
        provenance.city    = firstAccess.city    ?? null;
        (provenance as any).accessDevice  = firstAccess.device  ?? null;
        (provenance as any).accessBrowser = firstAccess.browser ?? null;
      }
    }

    // Integrity
    const lastVerif = dna.verifications[0];
    const sha256 = dna.cryptoLayer?.sha256Hash ?? dna.sha256Hash ?? null;
    let tamperStatus = 'UNVERIFIED';
    if (lastVerif) tamperStatus = lastVerif.passed ? 'VERIFIED' : 'TAMPERED';
    const integrity = {
      sha256Hash:       sha256,
      normalizedHash:   dna.cryptoLayer?.normalizedHash ?? null,
      dnaStatus:        dna.status,
      layersComplete:   6,
      tamperStatus,
      lastVerification: lastVerif
        ? { passed: lastVerif.passed, confidenceScore: lastVerif.confidenceScore, at: lastVerif.createdAt.toISOString() }
        : null,
    };

    // Discovery
    const monitor  = dna.monitorRecords[0] ?? null;
    const allResults = dna.monitorRecords.flatMap(m => m.crawlResults);
    const matches  = allResults.filter(r => r.matchType !== 'NO_MATCH');
    const discovery = {
      monitoringActive: monitor?.status === 'ACTIVE',
      scanType:         monitor?.scanType ?? null,
      totalRuns:        dna.monitorRecords.reduce((s, m) => s + m.monitoringRuns.length, 0),
      totalMatches:     monitor?.totalMatches ?? 0,
      exactMatches:     matches.filter(r => r.matchType === 'EXACT_MATCH' || r.matchType === 'DUPLICATE').length,
      highMatches:      matches.filter(r => r.matchType === 'HIGH_MATCH'  || r.matchType === 'NEAR_MATCH').length,
      possibleMatches:  matches.filter(r => r.matchType === 'POSSIBLE_MATCH' || r.matchType === 'POSSIBLE').length,
      recentMatches:    matches.slice(0, 5).map(r => ({
        url:       r.url,
        matchType: r.matchType,
        similarity: r.similarity,
        foundAt:   r.createdAt.toISOString(),
      })),
      ocrIndexed:       dna.ocrRecord?.indexed ?? false,
      ocrWordCount:     dna.ocrRecord?.wordCount ?? 0,
      ocrLanguage:      dna.ocrRecord?.language ?? null,
    };

    // Distribution
    const allLogs    = shareLinks.flatMap(l => l.accessLogs);
    const countries  = [...new Set(allLogs.map(l => l.country).filter(Boolean))] as string[];
    const devices    = [...new Set(allLogs.map(l => l.device).filter(Boolean))]  as string[];
    const browsers   = [...new Set(allLogs.map(l => l.browser).filter(Boolean))] as string[];
    const recipients = [...new Set(allLogs.map(l => l.recipientName).filter(Boolean))] as string[];
    const distribution = {
      totalShareLinks: shareLinks.length,
      activeLinks:     shareLinks.filter(l => l.isActive).length,
      totalViews:      shareLinks.reduce((s, l) => s + l.viewCount, 0),
      totalDownloads:  shareLinks.reduce((s, l) => s + l.downloadCount, 0),
      totalEvents:     allLogs.length,
      uniqueCountries: countries,
      uniqueDevices:   devices,
      uniqueBrowsers:  browsers,
      recipients:      recipients.slice(0, 20),
      timeline: allLogs
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(0, 30)
        .map(l => ({
          action:  l.action,
          at:      l.createdAt.toISOString(),
          country: l.country  ?? null,
          device:  l.device   ?? null,
          browser: l.browser  ?? null,
          riskLevel: l.riskLevel ?? null,
        })),
    };

    // Risk
    const highRiskEvents = allLogs.filter(l => l.riskLevel === 'HIGH' || l.riskLevel === 'CRITICAL').length;
    const avgRiskScore   = allLogs.length > 0
      ? Math.round(allLogs.reduce((s, l) => s + (l.riskScore ?? 0), 0) / allLogs.length)
      : 0;
    const leakIndicators: string[] = [];
    if (discovery.exactMatches > 0)  leakIndicators.push(`${discovery.exactMatches} exact match(es) found online`);
    if (discovery.highMatches  > 0)  leakIndicators.push(`${discovery.highMatches} high-similarity match(es) online`);
    if (highRiskEvents > 0)          leakIndicators.push(`${highRiskEvents} high-risk access event(s)`);
    if (distribution.totalDownloads > 10) leakIndicators.push('High download volume detected');
    const overallRisk = leakIndicators.length >= 3 ? 'CRITICAL'
      : leakIndicators.length === 2                ? 'HIGH'
      : leakIndicators.length === 1                ? 'MEDIUM'
      : avgRiskScore > 50                          ? 'MEDIUM'
      : 'LOW';
    const risk = {
      riskScore:         Math.max(avgRiskScore, leakIndicators.length * 25),
      riskLevel:         overallRisk,
      evidenceCount:     evidence.length,
      suspiciousEvents:  highRiskEvents,
      leakIndicators,
      recentEvidence: evidence.slice(0, 5).map(e => ({
        code: e.evidenceCode, type: e.evidenceType, description: e.description, at: e.createdAt.toISOString(),
      })),
    };

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      vaultId,
      identity, provenance, integrity, discovery, distribution, risk,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /intelligence/stats ──────────────────────────────────────────────────

export async function getIntelligenceStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [ocrStats, lineageCount, auditStats, indexSize] = await Promise.all([
      prisma.ocrRecord.aggregate({ _count: true, _sum: { wordCount: true }, _avg: { confidence: true } }),
      prisma.documentLineage.count(),
      auditService.getStats(),
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
