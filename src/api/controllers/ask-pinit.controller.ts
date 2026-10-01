import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { AppError } from '../middleware/error.middleware';
import { askPinit, getAskPinitInsights } from '../../services/intelligence/ask-pinit.service';
import type { ConversationHint } from '../../services/intelligence/ask-pinit-resolve';

function strOpt(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t || t.length > max) return undefined;
  return t;
}

function parseConversation(raw: unknown): ConversationHint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ConversationHint[] = [];
  for (const row of raw.slice(-12)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    out.push({
      vaultId: strOpt(r.vaultId, 80),
      assetId: strOpt(r.assetId, 80),
      filename: strOpt(r.filename, 200),
    });
  }
  return out;
}

export async function askPinitHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const question = String(body.question ?? '').trim();
    if (question.length < 2) throw new AppError(400, 'Ask a question about your protected assets.');
    if (question.length > 500) throw new AppError(400, 'Question is too long.');

    const ctx = (body.context && typeof body.context === 'object')
      ? body.context as Record<string, unknown>
      : body;

    const reply = await askPinit(ownerUserId, {
      question,
      vaultId: strOpt(ctx.vaultId ?? body.vaultId, 80),
      pathname: strOpt(ctx.route ?? ctx.pathname ?? body.pathname, 200),
      assetId: strOpt(ctx.assetId ?? body.assetId, 80),
      portfolioId: strOpt(ctx.portfolioId, 80),
      reportId: strOpt(ctx.reportId, 80),
      conversation: parseConversation(body.conversation),
    });

    res.json({
      success: true,
      answer: reply.answer,
      intent: reply.intent,
      confidence: reply.confidence,
      evidence: reply.blocks.map((b) => ({ text: b.text, citation: b.citation })),
      actions: reply.links,
      title: reply.title,
      spoken: reply.spoken,
      blocks: reply.blocks,
      links: reply.links,
      resolved: reply.resolved,
    });
  } catch (err) {
    next(err);
  }
}

export async function askPinitInsightsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const insights = await getAskPinitInsights(ownerUserId);
    res.json({ success: true, ...insights });
  } catch (err) {
    next(err);
  }
}
