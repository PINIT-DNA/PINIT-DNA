import { Request, Response, NextFunction } from 'express';
import { portfolioService } from '../../services/portfolio/portfolio.service';

function userId(req: Request): string {
  return (req as { user?: { sub?: string } }).user?.sub || '';
}

export async function getMyPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = await portfolioService.getMine(userId(req));
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function saveMyPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = await portfolioService.saveDraft(userId(req), req.body || {});
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function publishMyPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = await portfolioService.publish(userId(req), req.body || {});
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function unpublishMyPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = await portfolioService.unpublish(userId(req));
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function previewMyPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const portfolio = await portfolioService.previewMine(userId(req));
    res.json({ success: true, portfolio });
  } catch (err) {
    next(err);
  }
}

export async function getPublicPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug || '').trim();
    const previewToken = String(req.query.preview_token || req.query.pt || '').trim() || undefined;
    const portfolio = await portfolioService.getPublicBySlug(slug, previewToken);
    res.json({ success: true, portfolio, ...portfolio });
  } catch (err) {
    next(err);
  }
}
