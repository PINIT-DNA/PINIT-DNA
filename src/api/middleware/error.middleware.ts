/**
 * PINIT-DNA — Global Error Handler Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
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
  if (err.message.startsWith('Unsupported file type') || err.message.includes('File too large')) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  // Vault storage / decryption — surface actionable message (share links, downloads)
  if (
    err.message.includes('Vault file unavailable')
    || err.message.includes('Vault decrypt failed')
    || err.message.includes('Supabase download failed')
    || err.message.includes('SUPABASE_URL')
  ) {
    res.status(503).json({ success: false, error: err.message });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
}
