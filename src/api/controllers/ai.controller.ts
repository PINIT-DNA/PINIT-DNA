/**
 * PINIT-DNA — AI Controller (Phase 2)
 *
 * Bridges the Express API to the Python AI microservice.
 * All endpoints degrade gracefully if Python service is offline.
 * NO changes to existing DNA/vault/certificate/audit logic.
 */

import { Request, Response, NextFunction } from 'express';
import { aiService }  from '../../services/ai/ai-embeddings.service';
import { prisma }     from '../../lib/prisma';
import { auditService } from '../../services/audit/audit.service';

// ─── GET /ai/health ───────────────────────────────────────────────────────────

export async function aiHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const health = await aiService.getHealth();
    const stats  = health.online ? await aiService.getStats() : null;

    res.status(health.online ? 200 : 503).json({
      success: true,
      ai: { ...health, stats },
    });
  } catch (err) { next(err); }
}

// ─── POST /ai/index/:dnaRecordId ──────────────────────────────────────────────

export async function indexDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  const { text } = req.body as { text?: string };

  if (!text?.trim()) {
    res.status(400).json({ success: false, error: 'text is required in request body' });
    return;
  }

  try {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { imageFilename: true, fileType: true },
    });

    if (!record) {
      res.status(404).json({ success: false, error: `DNA record not found: ${dnaRecordId}` });
      return;
    }

    const result = await aiService.indexDocument({
      dnaRecordId,
      filename: record.imageFilename,
      fileType: record.fileType ?? 'UNKNOWN',
      text,
    });

    if (!result) {
      res.status(503).json({ success: false, error: 'AI service is offline or unavailable' });
      return;
    }

    res.status(200).json({ success: true, result });
  } catch (err) { next(err); }
}

// ─── POST /ai/search ─────────────────────────────────────────────────────────

export async function semanticSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  const {
    query, topK, threshold,
    mode = 'hybrid',
    keywordWeight  = 0.40,
    semanticWeight = 0.60,
  } = req.body as {
    query?: string; topK?: number; threshold?: number;
    mode?: string; keywordWeight?: number; semanticWeight?: number;
  };

  if (!query?.trim()) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }

  try {
    let results;
    const AI_BASE = process.env['AI_SERVICE_URL'] ?? 'http://localhost:8001';
    const axiosLib = (await import('axios')).default;

    if (mode === 'hybrid') {
      // Phase 4: Hybrid search — keyword 40% + semantic 60%
      const { data } = await axiosLib.post(
        `${AI_BASE}/search/hybrid`,
        { query, topK: topK ?? 10, threshold: threshold ?? 0.50, keywordWeight, semanticWeight },
        { timeout: 15000 }
      );
      results = data;
    } else {
      // Pure semantic search with Phase 5 confidence threshold
      const { data } = await axiosLib.post(
        `${AI_BASE}/search`,
        { query, topK: topK ?? 10, threshold: threshold ?? 0.50 },
        { timeout: 15000 }
      );
      results = data;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = results as any;
    await auditService.log({
      eventType: 'SEMANTIC_SEARCH',
      detail: { query, resultCount: r.count, mode },
      req,
    });

    res.status(200).json({ success: true, ...r });
  } catch (err) { next(err); }
}

// ─── POST /ai/duplicates ──────────────────────────────────────────────────────

export async function detectDuplicates(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { text, threshold } = req.body as { text?: string; threshold?: number };

  if (!text?.trim()) {
    res.status(400).json({ success: false, error: 'text is required' });
    return;
  }

  try {
    const result = await aiService.detectDuplicates(text, threshold ?? 0.92);

    if (!result) {
      res.status(503).json({ success: false, error: 'AI service is offline' });
      return;
    }

    res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
}

// ─── POST /ai/similar ────────────────────────────────────────────────────────

export async function findSimilar(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { query, topK } = req.body as { query?: string; topK?: number };

  if (!query?.trim()) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }

  try {
    const results = await aiService.findSimilar(query, topK ?? 5);
    res.status(200).json({ success: true, data: results });
  } catch (err) { next(err); }
}

// ─── POST /ai/embed ──────────────────────────────────────────────────────────

export async function generateEmbedding(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { text } = req.body as { text?: string };

  if (!text?.trim()) {
    res.status(400).json({ success: false, error: 'text is required' });
    return;
  }

  try {
    const result = await aiService.embed(text);

    if (!result) {
      res.status(503).json({ success: false, error: 'AI service is offline' });
      return;
    }

    res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
}

// ─── GET /ai/stats ────────────────────────────────────────────────────────────

export async function aiStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await aiService.getStats();
    if (!stats) {
      res.status(503).json({ success: false, error: 'AI service is offline' });
      return;
    }
    res.status(200).json({ success: true, stats });
  } catch (err) { next(err); }
}
