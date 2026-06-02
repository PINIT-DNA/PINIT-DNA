/**
 * PINIT-DNA — DNA Comparison Controller (Phase 3.1)
 *
 * POST /api/v1/dna/compare
 *
 * Accepts two files via multipart form-data:
 *   fileA  — the "original" file
 *   fileB  — the "comparison" file
 *
 * Returns a full DnaComparisonResult with forensic analysis.
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { AppError } from '../middleware/error.middleware';
import { logger }   from '../../lib/logger';
import { DnaComparisonService } from '../../services/verification/dna-comparison.service';

const service = new DnaComparisonService();

export async function compareDna(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // multer .fields() puts files on req.files as a dictionary
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;

  const multerA = files?.['fileA']?.[0];
  const multerB = files?.['fileB']?.[0];

  if (!multerA) {
    return next(new AppError(400, 'Missing "fileA". Use multipart field "fileA" for the original file.'));
  }
  if (!multerB) {
    return next(new AppError(400, 'Missing "fileB". Use multipart field "fileB" for the comparison file.'));
  }

  // ── Load both buffers ─────────────────────────────────────────────────────
  let bufferA: Buffer, bufferB: Buffer;
  try {
    [bufferA, bufferB] = await Promise.all([
      fs.readFile(multerA.path),
      fs.readFile(multerB.path),
    ]);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded files from disk.'));
  }

  try {
    const result = await service.compare(
      {
        filePath:        multerA.path,
        originalName:    multerA.originalname,
        declaredMimeType: multerA.mimetype,
        sizeBytes:       multerA.size,
        buffer:          bufferA,
      },
      {
        filePath:        multerB.path,
        originalName:    multerB.originalname,
        declaredMimeType: multerB.mimetype,
        sizeBytes:       multerB.size,
        buffer:          bufferB,
      }
    );

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  } finally {
    // Clean up both temp upload files
    await Promise.allSettled([
      fs.unlink(multerA.path),
      fs.unlink(multerB.path),
    ]).catch((e) =>
      logger.warn('Failed to clean up comparison temp files', { error: e })
    );
  }
}
