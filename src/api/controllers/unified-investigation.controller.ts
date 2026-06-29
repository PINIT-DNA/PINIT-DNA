/**
 * POST /api/v1/forensics/unified-investigate
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

  try {
    const userId = getAuthUserId(req);
    const report = await unifiedInvestigationOrchestrator.investigate(
      buffer,
      file.mimetype,
      file.originalname,
      userId,
    );
    res.status(200).json({ success: true, report });
  } catch (err) {
    next(err);
  } finally {
    if (file.path) await fs.unlink(file.path).catch(() => {});
  }
}
