/**
 * PINIT-DNA — TEP (Tracked Export Package) Controller
 *
 * GET /tep/manifests?dnaRecordId=  — List TEP manifests for a DNA record (owner)
 * GET /tep/:tepCode                — Get single TEP manifest detail
 */

import { Request, Response, NextFunction } from 'express';
import { tepService } from '../../services/tep/tep.service';
import { prisma } from '../../lib/prisma';

export async function listTepManifests(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    const dnaRecordId = req.query['dnaRecordId'] as string | undefined;

    if (!dnaRecordId) {
      res.status(400).json({ success: false, error: 'dnaRecordId query param required' });
      return;
    }

    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { ownerUserId: true },
    });
    if (!record || record.ownerUserId !== userId) {
      res.status(403).json({ success: false, error: 'Not authorized for this DNA record' });
      return;
    }

    const manifests = await tepService.listByDnaRecord(dnaRecordId, userId);

    res.json({
      success: true,
      count: manifests.length,
      manifests: manifests.map(m => ({
        id:            m.id,
        tepCode:       m.tepCode,
        dnaRecordId:   m.dnaRecordId,
        vaultId:       m.vaultId,
        shareLinkId:   m.shareLinkId,
        watermarkCode: m.watermarkCode,
        recipientId:   m.recipientId,
        exportSha256:  m.exportSha256,
        geoCountry:    m.geoCountry,
        ipAddress:     m.ipAddress,
        status:        m.status,
        createdAt:     m.createdAt.toISOString(),
        expiresAt:     m.expiresAt?.toISOString() ?? null,
        rediscoveredAt: m.rediscoveredAt?.toISOString() ?? null,
        embeddedLayers: m.embeddedLayers,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getTepManifest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    const tepCode = req.params['tepCode']!;

    const manifest = await tepService.getByTepCode(tepCode);
    if (!manifest) {
      res.status(404).json({ success: false, error: 'TEP manifest not found' });
      return;
    }

    if (manifest.ownerUserId && manifest.ownerUserId !== userId) {
      res.status(403).json({ success: false, error: 'Not authorized' });
      return;
    }

    res.json({
      success: true,
      manifest: {
        ...manifest,
        createdAt: manifest.createdAt.toISOString(),
        expiresAt: manifest.expiresAt?.toISOString() ?? null,
        rediscoveredAt: manifest.rediscoveredAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
}
