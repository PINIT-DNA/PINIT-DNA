import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { prisma } from '../../lib/prisma';
import { loadPublicScanDetails, scanPublicImage, type PublicScanDetail } from '../../services/scan/public-scan.service';
import { toPublicScanBody, type PublicScanDraft } from '../../services/scan/public-scan-decision';
import { checkScanChallenge, consumeScanAttempt, issuePublicDetailToken, issueScanChallenge, readPublicDetailToken } from '../../services/scan/scan-guard';
import { logger } from '../../lib/logger';

export interface PublicScanDeps {
  scanImage: (buffer: Buffer, mimeType: string) => Promise<PublicScanDraft>;
  loadPublicDetails?: (dnaRecordId: string) => Promise<PublicScanDetail | null>;
}

export const defaultPublicScanDeps: PublicScanDeps = {
  scanImage: scanPublicImage,
  loadPublicDetails: loadPublicScanDetails,
};

export function getScanChallenge(_req: Request, res: Response): void {
  res.json({ success: true, ...issueScanChallenge() });
}

export async function postPublicScan(req: Request, res: Response, deps: PublicScanDeps = defaultPublicScanDeps): Promise<void> {
  const honeypot = String(req.body?.company ?? '');
  const token = String(req.body?.challenge ?? '');
  if (!checkScanChallenge(token, honeypot)) {
    res.status(400).json({ success: false, error: 'Scan could not be checked. Refresh the page and try again.' });
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!consumeScanAttempt(ip)) {
    res.status(429).json({ success: false, error: 'Too many scans. Wait a few minutes and try again.' });
    return;
  }
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ success: false, error: 'Choose an image to scan.' });
    return;
  }
  try {
    const buffer = file.buffer;
    if (!buffer) {
      res.status(400).json({ success: false, error: 'Choose an image to scan.' });
      return;
    }
    if (!file.mimetype?.startsWith('image/')) {
      res.status(400).json({ success: false, error: 'Choose an image to scan.' });
      return;
    }
    const draft = await deps.scanImage(buffer, file.mimetype);
    const body = toPublicScanBody(draft);
    if (
      draft.dnaRecordId
      && (body.verdict === 'protected' || body.verdict === 'possible')
      && (body.title || body.recipientLabel)
    ) {
      body.detailsToken = issuePublicDetailToken(draft.dnaRecordId, body.verdict);
    }
    logger.info('Public scan finished', { verdict: body.verdict });
    res.json(body);
  } catch (err) {
    logger.warn('Public scan failed', { error: String(err) });
    res.status(503).json({ success: false, error: 'Scan could not be completed. Try again.' });
  }
}

export async function getPublicScanDetails(req: Request, res: Response, deps: PublicScanDeps = defaultPublicScanDeps): Promise<void> {
  const held = readPublicDetailToken(String(req.params['token'] ?? ''));
  if (!held) {
    res.status(404).json({ success: false, error: 'These details are no longer available.' });
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!consumeScanAttempt(`details:${ip}`)) {
    res.status(429).json({ success: false, error: 'Too many requests. Wait a few minutes and try again.' });
    return;
  }
  try {
    const load = deps.loadPublicDetails ?? loadPublicScanDetails;
    const detail = await load(held.dnaRecordId);
    if (!detail || detail.optOut) {
      res.status(404).json({ success: false, error: 'These details are no longer available.' });
      return;
    }
    const body: Record<string, unknown> = {
      success: true,
      verdict: held.verdict,
      ownerName: detail.ownerName || 'PINIT member',
      message: held.verdict === 'protected'
        ? 'Protected by PINIT. A match shows a relationship with a PINIT record. It does not by itself prove legal ownership.'
        : 'Possible match. This is not a confirmed result.',
    };
    if (detail.protectedAt) body.protectedAt = detail.protectedAt;
    if (detail.title) body.title = detail.title;
    if (detail.recipientLabel) body.recipientLabel = detail.recipientLabel;
    res.json(body);
  } catch (err) {
    logger.warn('Public scan details failed', { error: String(err) });
    res.status(404).json({ success: false, error: 'These details are no longer available.' });
  }
}

const DEFAULTS = { optOut: false, showTitle: false, showRecipient: false };

export async function getPublicScanSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const vaultId = req.params['vaultId'] ?? '';
    const vault = await prisma.vaultRecord.findFirst({
      where: { id: vaultId, dnaRecord: { ownerUserId } },
      select: { dnaRecordId: true },
    });
    if (!vault) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }
    try {
      const rows = await prisma.$queryRaw<Array<{ optOut: boolean; showTitle: boolean; showRecipient: boolean }>>`
        SELECT
          "publicScanOptOut" AS "optOut",
          "publicScanShowTitle" AS "showTitle",
          "publicScanShowRecipient" AS "showRecipient"
        FROM dna_records
        WHERE id = ${vault.dnaRecordId}
        LIMIT 1
      `;
      const row = rows[0] ?? DEFAULTS;
      res.json({
        success: true,
        available: true,
        optOut: Boolean(row.optOut),
        showTitle: Boolean(row.showTitle),
        showRecipient: Boolean(row.showRecipient),
      });
    } catch {
      res.json({ success: true, available: false, ...DEFAULTS });
    }
  } catch (err) {
    next(err);
  }
}

export async function updatePublicScanSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const vaultId = req.params['vaultId'] ?? '';
    const vault = await prisma.vaultRecord.findFirst({
      where: { id: vaultId, dnaRecord: { ownerUserId } },
      select: { dnaRecordId: true },
    });
    if (!vault) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }
    const optOut = Boolean(req.body?.optOut);
    const showTitle = Boolean(req.body?.showTitle);
    const showRecipient = Boolean(req.body?.showRecipient);
    try {
      await prisma.$executeRaw`
        UPDATE dna_records
        SET
          "publicScanOptOut" = ${optOut},
          "publicScanShowTitle" = ${showTitle},
          "publicScanShowRecipient" = ${showRecipient}
        WHERE id = ${vault.dnaRecordId}
      `;
      res.json({ success: true, available: true, optOut, showTitle, showRecipient });
    } catch {
      res.status(503).json({
        success: false,
        error: 'Public scan choices are not saved yet. The database update has not been applied.',
      });
    }
  } catch (err) {
    next(err);
  }
}
