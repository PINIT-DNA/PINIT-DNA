/**
 * PINIT-DNA — Global Error Handler Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../lib/logger';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
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
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: err.message });
    return;
  }

  // Multer errors
  if (err.message.startsWith('Unsupported file type') || err.message.includes('File too large')) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
}
