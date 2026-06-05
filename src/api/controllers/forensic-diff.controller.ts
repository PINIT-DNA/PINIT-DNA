/**
 * POST /api/v1/forensic/diff
 * Accepts fileA + fileB, returns full forensic difference report.
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { ForensicDiffOrchestrator } from '../../services/forensic/forensic-diff.orchestrator';
import { AppError } from '../middleware/error.middleware';
import { logger }   from '../../lib/logger';

const orchestrator = new ForensicDiffOrchestrator();

export async function forensicDiff(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const files  = req.files as Record<string, Express.Multer.File[]> | undefined;
  const multerA = files?.['fileA']?.[0];
  const multerB = files?.['fileB']?.[0];

  if (!multerA) return next(new AppError(400, 'Missing "fileA" — use multipart field "fileA"'));
  if (!multerB) return next(new AppError(400, 'Missing "fileB" — use multipart field "fileB"'));

  let bufferA: Buffer, bufferB: Buffer;
  try {
    [bufferA, bufferB] = await Promise.all([
      fs.readFile(multerA.path),
      fs.readFile(multerB.path),
    ]);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded files'));
  }

  try {
    const report = await orchestrator.analyze(
      { filePath: multerA.path, originalName: multerA.originalname,
        declaredMimeType: multerA.mimetype, sizeBytes: multerA.size, buffer: bufferA },
      { filePath: multerB.path, originalName: multerB.originalname,
        declaredMimeType: multerB.mimetype, sizeBytes: multerB.size, buffer: bufferB },
    );

    res.status(200).json({ success: true, ...report });
  } catch (err) {
    next(err);
  } finally {
    await Promise.allSettled([
      fs.unlink(multerA.path),
      fs.unlink(multerB.path),
    ]).catch(e => logger.warn('Forensic diff temp cleanup failed', { error: e }));
  }
}
