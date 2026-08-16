/**
 * Spatial Auth Phase 1 — API controllers (additive)
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { AppError } from '../middleware/error.middleware';
import { isSpatialAuthEnabled } from '../../config/spatial-auth';
import { enrollSpatialAuth, spatialAuthStatus } from '../../services/spatial/enroll.service';
import { verifyExactSpatialAuthForDna } from '../../services/spatial/verify-exact.service';
import { prisma } from '../../lib/prisma';

export async function getSpatialAuthStatus(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json({ success: true, spatialAuth: spatialAuthStatus() });
}

/**
 * POST /dna/:id/spatial-auth/enroll
 * Multipart field "image" — builds SpatialAuthPackage for this DNA record.
 */
export async function enrollSpatialAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isSpatialAuthEnabled()) {
    return next(new AppError(503, 'Spatial auth is disabled (SPATIAL_AUTH_ENABLED=false)'));
  }
  if (!req.file) {
    return next(new AppError(400, 'No file provided. Use multipart field name "image".'));
  }

  const dnaRecordId = req.params['id'];
  if (!dnaRecordId) {
    return next(new AppError(400, 'Missing DNA record id'));
  }

  const ownerUserId = (req as { user?: { sub?: string } }).user?.sub;
  if (!ownerUserId) {
    return next(new AppError(401, 'Authentication required'));
  }

  try {
    const dna = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: {
        id: true,
        ownerUserId: true,
        sha256Hash: true,
        universalFingerprints: true,
      },
    });
    if (!dna) {
      return next(new AppError(404, 'DNA record not found'));
    }

    const buffer = await fs.readFile(req.file.path);
    const fp = dna.universalFingerprints as
      | { identityDeterministic?: { contentSealHmac?: string } }
      | null;
    const contentSeal = fp?.identityDeterministic?.contentSealHmac ?? null;

    const enrollment = await enrollSpatialAuth({
      imageBuffer: buffer,
      dnaRecordId,
      ownerUserId: dna.ownerUserId ?? ownerUserId,
      contentSealHmac: contentSeal,
      sha256Hash: dna.sha256Hash,
    });

    res.status(201).json({
      success: true,
      enrollment,
      note: 'Mode A exact spatial integrity only — not robust provenance.',
    });
  } catch (err) {
    next(err);
  } finally {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }
}

/**
 * POST /dna/:id/spatial-auth/verify-exact
 * Multipart field "image" — Mode A exact block verification + tamper map.
 */
export async function verifyExactSpatialAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isSpatialAuthEnabled()) {
    return next(new AppError(503, 'Spatial auth is disabled (SPATIAL_AUTH_ENABLED=false)'));
  }
  if (!req.file) {
    return next(new AppError(400, 'No file provided. Use multipart field name "image".'));
  }

  const dnaRecordId = req.params['id'];
  if (!dnaRecordId) {
    return next(new AppError(400, 'Missing DNA record id'));
  }

  try {
    const buffer = await fs.readFile(req.file.path);
    const result = await verifyExactSpatialAuthForDna({
      dnaRecordId,
      candidateImageBuffer: buffer,
      primaryScaleOnly: true,
    });

    res.status(200).json({
      success: true,
      result,
      disclaimer:
        'Mode A provides exact spatial integrity only when the candidate image is evaluated under the enrolled geometry/normalization policy. It must not be interpreted as robust provenance.',
      localizationDisclaimer:
        'Phase 2 tamper map is derived evidence from HMAC block authentication. It is not an independent cryptographic trust source and does not identify exact modified pixels.',
      fineLocalizationDisclaimer:
        'Phase 3A fine map localizes to 8×8 cells via server-side HKCA. It does NOT claim exact single-pixel identification. No green/blue LSB embedding in 3A.',
      investigationDisclaimer:
        'Phase 3C provides visualization and investigation of Phase 3A 8×8 authentication results. It does not increase cryptographic resolution beyond the enrolled 8×8 cell. Overlay is presentation-only.',
    });
  } catch (err) {
    next(err);
  } finally {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
  }
}
