/**
 * PINIT-DNA — FAISS Index Debug Controller
 * GET /api/v1/intelligence/debug/indexed
 *
 * Shows EXACTLY what text was indexed for each document.
 * Reads from Python AI metadata + OCR records + vault extraction.
 */

import { Request, Response, NextFunction } from 'express';
import axios  from 'axios';
import fs     from 'fs';
import path   from 'path';
import { prisma }           from '../../lib/prisma';
import { extractDocumentText } from '../../services/text-extraction/document-text-extractor';
import { VaultService }     from '../../services/vault/vault.service';
import { logger }           from '../../lib/logger';
import { getAuthUserId }    from '../../lib/tenant-scope';

const vaultService = new VaultService();
const AI_BASE = process.env['AI_SERVICE_URL'] ?? 'http://localhost:8001';

export async function debugIndexed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // ── Step 1: Read FAISS metadata.json directly from disk ──────────────────
    const metaFile = path.resolve(__dirname, '../../../python-ai/data/metadata.json');
    let faissEntries: Record<string, unknown>[] = [];

    if (fs.existsSync(metaFile)) {
      const raw = fs.readFileSync(metaFile, 'utf-8');
      const all = JSON.parse(raw) as Record<string, unknown>[];
      // Deduplicate: keep latest entry per dnaRecordId
      const latest = new Map<string, Record<string, unknown>>();
      for (const e of all) {
        if (!e['_deleted']) {
          latest.set(e['dnaRecordId'] as string, e);
        }
      }
      faissEntries = [...latest.values()];
    }

    // ── Step 2: Get AI health (vector count) ─────────────────────────────────
    let vectorCount = 0;
    try {
      const { data } = await axios.get(`${AI_BASE}/health`, { timeout: 3000 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vectorCount = (data as any).indexed ?? 0;
    } catch { /* AI offline */ }

    // ── Step 3: Cross-reference with DB records ───────────────────────────────
    const userId = getAuthUserId(req);
    const testDnaId = req.query['testDnaId'] as string | undefined;

    const dbRecords = await prisma.dnaRecord.findMany({
      where: testDnaId
        ? { id: testDnaId, ownerUserId: userId }
        : { ownerUserId: userId },
      include: {
        vaultRecord: { select: { id: true, originalMimeType: true } },
        ocrRecord:   { select: { extractedText: true, wordCount: true, ocrStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: testDnaId ? 1 : 60,
    });

    // ── Step 4: Build report ──────────────────────────────────────────────────
    const report: unknown[] = [];

    for (const record of dbRecords) {
      const faiss = faissEntries.find(e => e['dnaRecordId'] === record.id);

      // What text is in FAISS right now
      const faissSnippet  = faiss ? String(faiss['snippet']  ?? '') : '';
      const faissFullText = faiss ? String(faiss['fullText'] ?? '') : '';
      const faissText     = faissFullText || faissSnippet;
      const isInFaiss     = !!faiss;

      // What's in OCR records
      const ocrText = record.ocrRecord?.extractedText ?? '';

      // Try extracting fresh from vault (only for testDnaId to avoid timeout)
      let freshExtracted = '';
      let freshWordCount = 0;
      let freshMethod = 'not_extracted';
      let freshError = '';

      if (testDnaId && record.vaultRecord) {
        try {
          const retrieved = await vaultService.retrieve(record.vaultRecord.id, userId);
          const result = await extractDocumentText(
            retrieved.originalBuffer,
            record.vaultRecord.originalMimeType,
            record.imageFilename,
          );
          freshExtracted = result.text;
          freshWordCount = result.wordCount;
          freshMethod    = result.method;
        } catch (err) {
          freshError = String(err).slice(0, 100);
        }
      }

      // What would be sent to FAISS (simulate index text)
      const cleanName = record.imageFilename
        .replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      const indexCandidate = (freshExtracted || ocrText || faissText || cleanName).slice(0, 1000);

      // Classify content quality
      let contentType: string;
      if (indexCandidate.length > 200 && !indexCandidate.startsWith(cleanName)) {
        contentType = 'FULL_DOCUMENT_CONTENT';
      } else if (indexCandidate.length > 80) {
        contentType = 'FILENAME_PLUS_CONTENT';
      } else {
        contentType = 'FILENAME_ONLY';
      }

      // Test for specific strings (when testing a resume)
      const testStrings = ['CMR Institute', 'Full Stack', 'Ashwitha', 'Kavvam'];
      const stringTests: Record<string, boolean> = {};
      for (const s of testStrings) {
        stringTests[s] = indexCandidate.toLowerCase().includes(s.toLowerCase());
      }

      report.push({
        dnaRecordId:          record.id,
        filename:             record.imageFilename,
        fileType:             record.fileType ?? 'IMAGE',
        mimeType:             record.imageMimeType,

        // FAISS current state
        isIndexedInFaiss:     isInFaiss,
        faissTextLength:      faissText.length,
        faissText_first1000:  faissText.slice(0, 1000) || '(empty)',
        embeddingGenerated:   isInFaiss,

        // OCR record
        ocrStatus:            record.ocrRecord?.ocrStatus ?? 'NO_OCR_RECORD',
        ocrWordCount:         record.ocrRecord?.wordCount ?? 0,
        ocrText_first200:     ocrText.slice(0, 200) || '(no OCR text)',

        // Fresh extraction (only when testDnaId provided)
        freshExtraction: testDnaId ? {
          method:       freshMethod,
          wordCount:    freshWordCount,
          text_first1000: freshExtracted.slice(0, 1000) || '(extraction failed)',
          error:        freshError || null,
        } : 'run_with_?testDnaId=xxx for fresh extraction',

        // What WOULD be indexed if reindexed now
        indexCandidate_first1000: indexCandidate,
        contentType,
        stringTests: testDnaId ? stringTests : 'run_with_?testDnaId=xxx',

        verdict: contentType === 'FILENAME_ONLY'
          ? 'PROBLEM: Only filename is indexed — content extraction needed'
          : 'OK: Real content indexed',
      });
    }

    // ── Step 5: Summary ───────────────────────────────────────────────────────
    const withContent  = (report as Record<string,unknown>[]).filter(r => r['contentType'] !== 'FILENAME_ONLY').length;
    const filenameOnly = report.length - withContent;

    res.status(200).json({
      success:       true,
      summary: {
        totalChecked:      report.length,
        faissVectorCount:  vectorCount,
        withRealContent:   withContent,
        filenameOnly,
        ocrRecords:        dbRecords.filter(r => r.ocrRecord?.extractedText).length,
        verdict:           filenameOnly === 0
          ? 'ALL documents have real content indexed'
          : `${filenameOnly} documents are indexed with filename only`,
        fix: filenameOnly > 0
          ? 'Click "Reindex with Content" after restarting backend with updated Python AI'
          : null,
      },
      tip: 'Add ?testDnaId=YOUR_DNA_RECORD_ID to test a specific document with fresh extraction',
      documents: report,
    });

  } catch (err) {
    logger.error('Debug index failed', { error: String(err) });
    next(err);
  }
}
