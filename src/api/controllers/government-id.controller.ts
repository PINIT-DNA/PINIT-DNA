import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { governmentIdService } from '../../services/profile/government-id.service';
import type { PadEvidence } from '../../services/auth/face-liveness.service';
import { parseDeviceFace } from './identity-verification.controller';

const DOC_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

export const governmentIdUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (DOC_MIMES.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error('Use a JPG, PNG, WEBP, or PDF of the document.'));
  },
});

function userId(req: Request): string {
  return (req as Request & { user?: { sub?: string } }).user?.sub || '';
}

export async function clearGovernmentId(req: Request, res: Response, next: NextFunction) {
  try {
    const view = await governmentIdService.clearForUser(userId(req));
    res.json({ success: true, governmentId: view });
  } catch (err) { next(err); }
}

export async function getGovernmentId(req: Request, res: Response, next: NextFunction) {
  try {
    const view = await governmentIdService.getForUser(userId(req));
    res.json({ success: true, governmentId: view });
  } catch (err) { next(err); }
}

/** Owner-only: the details read from the verified ID. Masked unless ?reveal=1. */
export async function getGovernmentIdDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const details = await governmentIdService.verifiedDetailsForUser(userId(req), req.query.reveal === '1');
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, details });
  } catch (err) { next(err); }
}

/** Owner-only: correct the address read from the ID. */
export async function updateGovernmentIdAddress(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = typeof req.body?.address === 'string' ? req.body.address : '';
    const address = [...raw].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
    if (address.length < 10 || address.length > 400) {
      res.status(400).json({ success: false, error: 'Enter the full address, between 10 and 400 characters.' });
      return;
    }
    const ok = await governmentIdService.updateVerifiedAddress(userId(req), address);
    if (!ok) {
      res.status(404).json({ success: false, error: 'There are no verified details to correct yet.' });
      return;
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function checkGovernmentIdFace(req: Request, res: Response, next: NextFunction) {
  try {
    const intent = req.body?.intent === 'recheck' ? 'recheck' : 'seal';
    const embedding = req.body?.embedding;
    if (!Array.isArray(embedding) || embedding.some((n: unknown) => typeof n !== 'number')) {
      res.status(400).json({ success: false, error: 'Look at the camera and hold still for a second.' });
      return;
    }
    const result = await governmentIdService.checkFace(
      userId(req),
      embedding as number[],
      req.body?.padEvidence as PadEvidence | undefined,
      intent,
    );
    if (!result.ok) {
      res.status(200).json({
        success: false,
        error: result.message,
        faceBinding: result.faceBinding ?? null,
      });
      return;
    }
    res.json({
      success: true,
      faceBinding: result.faceBinding,
      sealToken: result.sealToken ?? null,
      checkedAt: result.checkedAt,
    });
  } catch (err) { next(err); }
}

export async function sealGovernmentId(req: Request, res: Response, next: NextFunction) {
  try {
    const files = (req as Request & { files?: Record<string, Express.Multer.File[]> }).files ?? {};
    const file = files.document?.[0];
    const back = files.documentBack?.[0];
    if (!file?.buffer?.length) {
      res.status(400).json({ success: false, error: 'Add the front side of your ID.' });
      return;
    }
    const result = await governmentIdService.sealDocument({
      userId: userId(req),
      sealToken: String(req.body?.sealToken || ''),
      documentType: String(req.body?.documentType || ''),
      mimeType: file.mimetype,
      bytes: file.buffer,
      backMimeType: back?.mimetype,
      backBytes: back?.buffer,
      // Face on the document photograph, found on the device. Optional.
      documentFace: parseDeviceFace(req.body?.documentFace),
    });
    if (!result.ok) {
      res.status(400).json({ success: false, error: result.message });
      return;
    }
    res.json({ success: true, governmentId: result.view });
  } catch (err) { next(err); }
}
