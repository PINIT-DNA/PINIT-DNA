import { Request, Response, NextFunction } from 'express';
import { portfolioService } from '../../services/portfolio/portfolio.service';
import { AppError } from '../middleware/error.middleware';
import { correctImageMime, userContentHeaders } from '../../lib/user-content-headers';

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

export async function containsVaultInPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vaultId = String(req.params.vaultId || '').trim();
    const inPortfolio = await portfolioService.containsVault(userId(req), vaultId);
    res.json({ success: true, in_portfolio: inPortfolio });
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

export async function streamPublicPortfolioMedia(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug || '').trim();
    const vaultId = String(req.params.vaultId || '').trim();
    const previewToken = String(req.query.preview_token || req.query.pt || '').trim() || undefined;
    const result = await portfolioService.getPublicMedia(slug, vaultId, previewToken);

    let body = result.originalBuffer;
    let contentType = result.originalMimeType || 'application/octet-stream';
    if (!contentType.startsWith('image/') || /svg/i.test(contentType)) {
      throw new AppError(404, 'Media not found');
    }
    try {
      const sharp = (await import('sharp')).default;
      body = await sharp(result.originalBuffer)
        .rotate()
        .resize(960, 960, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      contentType = 'image/jpeg';
    } catch {
      body = result.originalBuffer;
      contentType = result.originalMimeType;
    }
    contentType = correctImageMime(contentType, body);
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=300',
      ...userContentHeaders(contentType),
    });
    res.status(200).send(body);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    next(err);
  }
}
