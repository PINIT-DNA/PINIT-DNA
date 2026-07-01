/**
 * POST /api/v1/forensics/unified-investigate
 * Optional ?stream=true for SSE progressive results (same endpoint, backward compatible).
 */
import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { AppError } from '../middleware/error.middleware';
import { getAuthUserId } from '../../lib/tenant-scope';
import { unifiedInvestigationOrchestrator } from '../../services/forensics/unified-investigation.orchestrator';

export async function unifiedInvestigate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const file = req.file;
  if (!file) {
    return next(new AppError(400, 'No file uploaded. Use field "image".'));
  }

  let buffer: Buffer;
  try {
    buffer = file.buffer ?? await fs.readFile(file.path);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded file.'));
  }

  const stream = req.query.stream === 'true' || req.headers.accept === 'text/event-stream';

  try {
    const userId = getAuthUserId(req);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': heartbeat\n\n');
      }, 10_000);

      try {
        const report = await unifiedInvestigationOrchestrator.investigate(
          buffer,
          file.mimetype,
          file.originalname,
          userId,
          {
            onProgress: (event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            },
          },
        );

        res.write(`data: ${JSON.stringify({ type: 'complete', report })}\n\n`);
        res.end();
      } finally {
        clearInterval(heartbeat);
      }
      return;
    }

    const report = await unifiedInvestigationOrchestrator.investigate(
      buffer,
      file.mimetype,
      file.originalname,
      userId,
    );
    res.status(200).json({ success: true, report });
  } catch (err) {
    if (stream && !res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      res.end();
      return;
    }
    next(err);
  } finally {
    if (file.path) await fs.unlink(file.path).catch(() => {});
  }
}
