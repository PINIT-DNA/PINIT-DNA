/**
 * Publish Guardian HTTP controllers — thin orchestration only.
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { getAuthUserId } from '../../lib/tenant-scope';
import { AppError } from '../middleware/error.middleware';
import { resolveClientIp } from '../../lib/request-utils';
import { publishGuardianService } from '../../services/publish-guardian/publish-guardian.service';
import { extensionAuthService } from '../../services/publish-guardian/extension-auth.service';
import { logger } from '../../lib/logger';

function cleanupUpload(file?: Express.Multer.File) {
  if (file?.path) void fs.unlink(file.path).catch(() => {});
}

/** POST /extension/publish-protect */
export async function publishProtect(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = req.file;
  if (!file) {
    return next(new AppError(400, 'No media provided. Use multipart field "media" or "image".'));
  }

  try {
    const ownerUserId = getAuthUserId(req);
    const body = req.body as Record<string, string | undefined>;
    const buffer = file.buffer?.length ? file.buffer : await fs.readFile(file.path);

    if (!buffer.length) {
      return next(new AppError(400, 'Uploaded media is empty'));
    }

    const platform = (body.platform ?? 'web').trim();
    if (!platform) return next(new AppError(400, 'platform is required'));

    const result = await publishGuardianService.publishProtect({
      ownerUserId,
      buffer,
      originalFileName: file.originalname || 'publish-media.bin',
      mimeType: file.mimetype || 'application/octet-stream',
      platform,
      postUrl: body.postUrl ?? null,
      pageUrl: body.pageUrl ?? null,
      mediaUrl: body.mediaUrl ?? null,
      profileUrl: body.profileUrl ?? null,
      platformPostId: body.platformPostId ?? null,
      ownerAccount: body.ownerAccount ?? null,
      caption: body.caption ?? null,
      pageTitle: body.pageTitle ?? null,
      enrollMonitoring: body.enrollMonitoring !== 'false',
      issueCertificate: body.issueCertificate !== 'false',
      extensionVersion: body.extensionVersion ?? null,
      clientRequestId: body.clientRequestId ?? null,
      capturedVia: body.capturedVia ?? 'extension_publish_guardian',
      captureReason: body.captureReason ?? null,
      ownerAction: body.ownerAction ?? null,
      captureMethod: body.captureMethod ?? null,
      platformType: body.platformType ?? null,
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

/** POST /extension/register-post */
export async function registerPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const body = req.body as {
      vaultId?: string;
      protectedPostId?: string;
      platform?: string;
      platformPostId?: string;
      postUrl?: string;
      ownerAccount?: string;
      mediaUrl?: string;
      profileUrl?: string;
      publishedAt?: string;
    };

    if (!body.platform) return next(new AppError(400, 'platform is required'));
    if (!body.vaultId && !body.protectedPostId) {
      return next(new AppError(400, 'vaultId or protectedPostId is required'));
    }

    const post = await publishGuardianService.registerPost({
      ownerUserId,
      vaultId: body.vaultId,
      protectedPostId: body.protectedPostId,
      platform: body.platform,
      platformPostId: body.platformPostId ?? null,
      postUrl: body.postUrl ?? null,
      ownerAccount: body.ownerAccount ?? null,
      mediaUrl: body.mediaUrl ?? null,
      profileUrl: body.profileUrl ?? null,
      publishedAt: body.publishedAt ?? null,
    });

    res.status(200).json({ success: true, post });
  } catch (err) {
    next(err);
  }
}

/** GET /posts */
export async function listProtectedPosts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const posts = await publishGuardianService.listPosts(ownerUserId, { platform, status, q });
    res.status(200).json({ success: true, count: posts.length, posts });
  } catch (err) {
    next(err);
  }
}

/** GET /posts/:id */
export async function getProtectedPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const post = await publishGuardianService.getPost(ownerUserId, req.params.id);
    res.status(200).json({ success: true, post });
  } catch (err) {
    next(err);
  }
}

/** PATCH /posts/:id */
export async function updateProtectedPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const post = await publishGuardianService.updatePost(ownerUserId, req.params.id, req.body ?? {});
    res.status(200).json({ success: true, post });
  } catch (err) {
    next(err);
  }
}

/** DELETE /posts/:id — soft archive */
export async function deleteProtectedPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const post = await publishGuardianService.deletePost(ownerUserId, req.params.id);
    res.status(200).json({ success: true, post });
  } catch (err) {
    next(err);
  }
}

/** GET /posts/stats — ops metrics dashboard */
export async function getProtectedPostsStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const { getPublishGuardianStats } = await import('../../services/publish-guardian/analytics.service');
    const stats = await getPublishGuardianStats(ownerUserId);
    res.status(200).json({ success: true, stats });
  } catch (err) {
    next(err);
  }
}

/** GET /extension/sync — cross-browser extension sync */
export async function syncExtensionState(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const sync = await publishGuardianService.syncForExtension(ownerUserId);
    res.status(200).json({ success: true, ...sync });
  } catch (err) {
    next(err);
  }
}

/** POST /auth/extension/issue-code — Hub logged-in user starts extension connect */
export async function issueExtensionAuthCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const extensionId = String((req.body as { extensionId?: string })?.extensionId ?? '').trim();
    const result = await extensionAuthService.issueCode(ownerUserId, extensionId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** POST /auth/extension/token — exchange code for JWT */
export async function exchangeExtensionAuthToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, extensionId } = req.body as { code?: string; extensionId?: string };
    if (!code || !extensionId) return next(new AppError(400, 'code and extensionId are required'));
    const result = await extensionAuthService.exchangeCode({ code, extensionId });
    logger.info('[ExtensionAuth] Token issued', { extensionId: extensionId.slice(0, 12), userId: result.user.id.slice(0, 8) });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}
