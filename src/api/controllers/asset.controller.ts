/**
 * Universal Asset HTTP controllers (additive).
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { getAuthUserId } from '../../lib/tenant-scope';
import { AppError } from '../middleware/error.middleware';
import { resolveClientIp } from '../../lib/request-utils';
import { assetService } from '../../services/assets/asset.service';

function cleanupUpload(file?: Express.Multer.File) {
  if (file?.path) void fs.unlink(file.path).catch(() => {});
}

/** POST /assets/protect */
export async function protectAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = req.file;
  if (!file) return next(new AppError(400, 'No media provided. Use multipart field "media" or "image".'));

  try {
    const ownerUserId = getAuthUserId(req);
    const body = req.body as Record<string, string | undefined>;
    const buffer = file.buffer?.length ? file.buffer : await fs.readFile(file.path);
    if (!buffer.length) return next(new AppError(400, 'Uploaded media is empty'));

    const result = await assetService.protect({
      ownerUserId,
      buffer,
      originalFileName: file.originalname || 'asset.bin',
      mimeType: file.mimetype || 'application/octet-stream',
      platform: body.platform ?? 'web',
      sourceUrl: body.sourceUrl ?? body.postUrl ?? null,
      mediaUrl: body.mediaUrl ?? null,
      profileUrl: body.profileUrl ?? null,
      caption: body.caption ?? null,
      pageTitle: body.pageTitle ?? null,
      ownerAccount: body.ownerAccount ?? null,
      platformPostId: body.platformPostId ?? null,
      clientRequestId: body.clientRequestId ?? null,
      capturedVia: body.capturedVia ?? 'hub_asset_protect',
      extensionVersion: body.extensionVersion ?? null,
      enrollMonitoring: body.enrollMonitoring !== 'false',
      issueCertificate: body.issueCertificate !== 'false',
      userAgent: req.headers['user-agent'] as string | undefined,
      ip: resolveClientIp(req),
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  } finally {
    cleanupUpload(file);
  }
}

export async function listAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const assets = await assetService.list(ownerUserId, {
      assetType: typeof req.query.assetType === 'string' ? req.query.assetType : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json({ success: true, assets });
  } catch (err) {
    next(err);
  }
}

export async function getAssetStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const stats = await assetService.getStats(ownerUserId);
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
}

export async function getAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const asset = await assetService.get(ownerUserId, req.params.id);
    res.json({ success: true, asset });
  } catch (err) {
    next(err);
  }
}

export async function transitionAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const status = (req.body as { status?: string }).status;
    if (!status) return next(new AppError(400, 'status is required'));
    const asset = await assetService.transition(ownerUserId, req.params.id, status);
    res.json({ success: true, asset });
  } catch (err) {
    next(err);
  }
}
