/**
 * PINIT-DNA — Global Error Handler Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { Prisma } from '@prisma/client';
import { config } from '../../config';
import { logger } from '../../lib/logger';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    logger.error('Unhandled error after response started', { error: err.message, stack: err.stack });
    return;
  }
  if (err.name === 'SubscriptionRequiredError') {
    const e = err as AppError & { requiredPlan?: string; feature?: string };
    res.status(403).json({
      success: false,
      error: 'Subscription Required',
      requiredPlan: e.requiredPlan ?? 'PRO',
      feature: e.feature,
    });
    return;
  }

  if (err.name === 'StorageLimitError') {
    const e = err as AppError & {
      usedBytes?: number;
      limitBytes?: number;
      requiredPlan?: string;
    };
    res.status(403).json({
      success: false,
      error: err.message,
      requiredPlan: e.requiredPlan ?? 'PRO',
      usedBytes: e.usedBytes,
      limitBytes: e.limitBytes,
    });
    return;
  }

  if (err.name === 'AssetQuotaExceededError') {
    const e = err as AppError & {
      usedAssets?: number;
      assetLimit?: number;
      planCode?: string;
      requiredPlan?: string;
    };
    res.status(403).json({
      success: false,
      error: err.message,
      code: 'ASSET_QUOTA_EXCEEDED',
      usedAssets: e.usedAssets,
      assetLimit: e.assetLimit,
      planCode: e.planCode,
      requiredPlan: e.requiredPlan ?? 'PRO',
    });
    return;
  }

  if (err.name === 'InvalidAccountPlanCombinationError') {
    res.status(409).json({
      success: false,
      error: err.message,
      code: 'INVALID_ACCOUNT_PLAN_COMBINATION',
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details ?? {}),
    });
    return;
  }

  // Service-layer errors: Object.assign(new Error(msg), { status: 4xx })
  const status = (err as Error & { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    res.status(status).json({ success: false, error: err.message });
    return;
  }

  // Multer errors
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Math.round(config.upload.maxFileSizeBytes / (1024 * 1024));
      res.status(400).json({ success: false, error: `File too large. Maximum size is ${maxMb} MB.` });
      return;
    }
    res.status(400).json({ success: false, error: err.message });
    return;
  }
  if (err.message.startsWith('Unsupported file type') || err.message.includes('File too large') || err.message.includes('JPG, PNG, WEBP')) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  // Vault storage / decryption — surface actionable message (share links, downloads)
  if (
    err.message.includes('Vault file unavailable')
    || err.message.includes('Vault decrypt failed')
    || err.message.includes('Supabase download failed')
    || err.message.includes('SUPABASE_URL')
    || err.message.includes('Failed to create storage bucket')
    || /egress_quota|project is restricted/i.test(err.message)
  ) {
    const quota = /egress_quota|project is restricted|Failed to create storage bucket/i.test(err.message);
    const missing = /not in cloud storage|Object not found|Vault file unavailable/i.test(err.message);
    res.status(503).json({
      success: false,
      error: quota
        ? 'Vault storage is temporarily unavailable (Supabase quota). Protect the file again after storage is restored.'
        : missing
          ? 'This protected file is not in cloud storage. Protect the file again, then create a new share link.'
          : 'The file could not be loaded. Try again or ask the owner to share a new link.',
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error('Prisma error', { code: err.code, meta: err.meta, error: err.message });
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: 'That portfolio URL is already taken.' });
      return;
    }
    if (err.code === 'P2028' || err.code === 'P2034') {
      res.status(503).json({ success: false, error: 'Save timed out. Please try again.' });
      return;
    }
    if (err.code === 'P2021' || err.code === 'P2022') {
      res.status(503).json({
        success: false,
        error: 'Portfolio storage is still updating. Wait a minute, refresh, and try again.',
      });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({ success: false, error: 'One of the selected files is no longer in your vault.' });
      return;
    }
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
}
