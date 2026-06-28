/**
 * PINIT-DNA — Tika Metadata Controller
 * GET  /api/v1/intelligence/tika/health
 * POST /api/v1/intelligence/tika/:dnaRecordId
 */

import { Request, Response, NextFunction } from 'express';
import { tikaService }   from '../../services/tika/tika.service';
import { VaultService }  from '../../services/vault/vault.service';
import { prisma }        from '../../lib/prisma';
import { AppError }      from '../middleware/error.middleware';
import { getAuthUserId } from '../../lib/tenant-scope';

const vaultService = new VaultService();

export async function tikaHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const available = await tikaService.isAvailable();
    res.status(available ? 200 : 503).json({
      success:   available,
      available,
      url:       process.env['TIKA_URL'] ?? 'http://localhost:9998',
      message:   available ? 'Apache Tika is running' : 'Apache Tika is not available',
    });
  } catch (err) { next(err); }
}

export async function extractTikaMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  try {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      include: { vaultRecord: true },
    });
    if (!record) return next(new AppError(404, `DNA record not found: ${dnaRecordId}`));
    if (!record.vaultRecord) return next(new AppError(400, 'File not in vault — store in vault first'));

    const userId = getAuthUserId(req);
    const retrieved = await vaultService.retrieve(record.vaultRecord.id, userId);
    const result    = await tikaService.extract(retrieved.originalBuffer, record.imageMimeType);
    const normalized = tikaService.normalize(result.metadata);

    res.status(200).json({
      success:     true,
      filename:    record.imageFilename,
      dnaRecordId: record.id,
      tikaAvailable: result.available,
      metadata:    result.metadata,
      normalized,
      textLength:  result.text.length,
      textPreview: result.text.slice(0, 500),
      totalFields: Object.keys(result.metadata).length,
    });
  } catch (err) { next(err); }
}
