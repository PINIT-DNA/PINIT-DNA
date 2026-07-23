/**
 * PINIT-DNA — Vault Controller
 *
 * POST /vault/store           — Encrypt image and store in vault
 * GET  /vault/:id             — Get vault record metadata
 * POST /vault/:id/retrieve    — Decrypt and return original image
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import { VaultService } from '../../services/vault/vault.service';
import { AppError } from '../middleware/error.middleware';
import { getAuthUserId } from '../../lib/tenant-scope';
import { logger } from '../../lib/logger';
import { auditService } from '../../services/audit/audit.service';
import { autoIndexer }  from '../../services/ai/auto-indexer.service';
import { protectedDownloadService } from '../../services/vault/protected-download.service';
import { vaultDownloadIdentityService } from '../../services/vault/vault-download-identity.service';
import { geoFromIp } from '../../services/share/share-link.service';
import {
  tepService,
  protectedDownloadTepChannelId,
  isTepProtectedDownloadEnabled,
} from '../../services/tep/tep.service';
import { resolveClientIp } from '../../lib/request-utils';
import {
  detectSensitiveTypes,
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPlain,
} from '../../services/privacy/privacy-masking.service';

const vaultService = new VaultService();

// ─── GET /vault ───────────────────────────────────────────────────────────────

export async function listVaultRecords(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const { prisma } = await import('../../lib/prisma');
    const { vaultAccessWhere } = await import('../../services/organization/org-asset.service');
    const records = await prisma.vaultRecord.findMany({
      where: await vaultAccessWhere(userId),
      orderBy: { createdAt: 'desc' },
      include: {
        dnaRecord: { select: { id: true, status: true, imageFilename: true } },
      },
    });

    const { getLocationStatusForAssets } = await import('../../services/forensics/forensic-provenance.service');
    const locationByDna = await getLocationStatusForAssets(records.map((r) => r.dnaRecordId));

    res.status(200).json({
      success: true,
      count: records.length,
      vaults: records.map((r) => ({
        id:                  r.id,
        dnaRecordId:         r.dnaRecordId,
        originalFileName:    r.originalFileName,
        originalMimeType:    r.originalMimeType,
        encryptedSizeBytes:  r.encryptedSizeBytes,
        originalSizeBytes:   r.originalSizeBytes,
        encryptionAlgorithm: r.encryptionAlgorithm,
        keyDerivation:       r.keyDerivation,
        createdAt:           r.createdAt.toISOString(),
        dnaRecord: {
          id:       r.dnaRecord.id,
          status:   r.dnaRecord.status,
          filename: r.dnaRecord.imageFilename,
        },
        // Custody location — not part of DNA (immutable identity)
        location: locationByDna.get(r.dnaRecordId) ?? { status: 'UNAVAILABLE' as const },
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /vault/store ────────────────────────────────────────────────────────

export async function storeInVault(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    return next(new AppError(400, 'No image file provided. Use multipart field name "image".'));
  }

  const { dnaRecordId } = req.body as { dnaRecordId?: string };
  if (!dnaRecordId?.trim()) {
    return next(new AppError(400, 'dnaRecordId is required in the request body.'));
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(req.file.path);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded file from disk.'));
  }

  try {
    const ownerUserId = getAuthUserId(req);
    // Subscription storage quota (edge check only — does not change encrypt/store pipeline)
    const { entitlementService } = await import('../../services/subscription');
    await entitlementService.assertCanUpload(ownerUserId, buffer.length);

    const result = await vaultService.store({
      dnaRecordId:      dnaRecordId.trim(),
      ownerUserId,
      imageBuffer:      buffer,
      originalFileName: req.file.originalname,
      originalMimeType: req.file.mimetype,
    });

    // Custody location (optional GPS from client + IP) — never written into DNA
    try {
      const { forensicProvenanceService } = await import('../../services/forensics/forensic-provenance.service');
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || null;
      const country = (req.headers['cf-ipcountry'] as string) || null;
      const gpsLat = parseFloat(String((req.body as { gpsLat?: string })?.gpsLat ?? ''));
      const gpsLng = parseFloat(String((req.body as { gpsLng?: string })?.gpsLng ?? ''));
      const locationShared = String((req.body as { locationShared?: string })?.locationShared ?? '') === 'true';
      const hasGps = locationShared && Number.isFinite(gpsLat) && Number.isFinite(gpsLng);
      if (ip || country || hasGps) {
        forensicProvenanceService.appendAsync({
          eventType: 'VAULT_STORED',
          summary: hasGps
            ? `Stored in vault — ${result.originalFileName} (location shared)`
            : `Vault store location context — ${result.originalFileName}`,
          dnaRecordId: result.dnaRecordId,
          vaultId: result.vaultId,
          actorUserId: ownerUserId,
          ipAddress: ip,
          country: country && country !== 'XX' ? country : null,
          latitude: hasGps ? gpsLat : null,
          longitude: hasGps ? gpsLng : null,
          locationSource: hasGps ? 'gps' : (country && country !== 'XX' ? 'ip' : 'none'),
          payload: { note: 'Custody location at vault store', locationShared: hasGps },
          dedupeKey: `vault_stored_geo:${result.vaultId}`,
        });
      }
    } catch {
      /* non-fatal */
    }

    // Fire-and-forget: OCR + auto-index in FAISS after vault store
    autoIndexer.indexAfterVaultStore({
      dnaRecordId: result.dnaRecordId,
      vaultId:     result.vaultId,
      filename:    result.originalFileName,
      mimeType:    result.originalMimeType,
      buffer,
    });

    res.status(201).json({
      success: true,
      vaultId:             result.vaultId,
      dnaRecordId:         result.dnaRecordId,
      originalFileName:    result.originalFileName,
      originalMimeType:    result.originalMimeType,
      encryptedSizeBytes:  result.encryptedSizeBytes,
      originalSizeBytes:   result.originalSizeBytes,
      encryptionAlgorithm: result.encryptionAlgorithm,
      storedAt:            result.createdAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('already in the vault')) {
      return next(new AppError(409, err.message));
    }
    next(err);
  } finally {
    // Clean up temp upload file
    fs.unlink(req.file.path).catch((e) =>
      logger.warn('Failed to delete temp file', { path: req.file?.path, error: e })
    );
  }
}

// ─── GET /vault/:id ───────────────────────────────────────────────────────────

export async function getVaultRecord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  try {
    const record = await vaultService.getRecord(id);
    const { getLocationStatusForAssets } = await import('../../services/forensics/forensic-provenance.service');
    const locationByDna = await getLocationStatusForAssets([record.dnaRecordId]);

    res.status(200).json({
      success: true,
      vault: {
        id:                  record.id,
        dnaRecordId:         record.dnaRecordId,
        originalFileName:    record.originalFileName,
        originalMimeType:    record.originalMimeType,
        encryptedSizeBytes:  record.encryptedSizeBytes,
        originalSizeBytes:   record.originalSizeBytes,
        encryptionAlgorithm: record.encryptionAlgorithm,
        keyDerivation:       record.keyDerivation,
        createdAt:           record.createdAt.toISOString(),
        dnaRecord: {
          id:            record.dnaRecord.id,
          status:        record.dnaRecord.status,
          schemaVersion: record.dnaRecord.schemaVersion,
        },
        location: locationByDna.get(record.dnaRecordId) ?? { status: 'UNAVAILABLE' as const },
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    next(err);
  }
}

// ─── GET /vault/:id/preview ─────────────────────────────────────────────────
// Clean decrypted bytes for in-app thumbnails — no download identity re-embedding.

export async function previewVaultFile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id } = req.params;

  try {
    const userId = getAuthUserId(req);
    const result = await vaultService.retrieve(id, userId);

    res.set({
      'Content-Type':        result.originalMimeType,
      'Content-Length':      String(result.originalBuffer.length),
      'Content-Disposition': `inline; filename="${result.originalFileName}"`,
      'X-Vault-Id':          result.vaultId,
      'Cache-Control':       'private, max-age=300',
    });

    res.status(200).send(result.originalBuffer);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('Unsupported state')) {
      return next(new AppError(422, 'Vault file integrity check failed — auth tag mismatch.'));
    }
    next(err);
  }
}

// ─── POST /vault/:id/retrieve ─────────────────────────────────────────────────

export async function retrieveFromVault(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  try {
    const userId = getAuthUserId(req);
    const result = await vaultService.retrieve(id, userId);

    const embedded = await vaultDownloadIdentityService.embedForDownload(
      result.originalBuffer,
      result.originalMimeType,
      result.originalFileName,
      id,
      result.dnaRecordId,
      userId,
      req,
    );

    res.set({
      'Content-Type':        result.originalMimeType,
      'Content-Length':      String(embedded.buffer.length),
      'Content-Disposition': `attachment; filename="${result.originalFileName}"`,
      'X-Vault-Id':          result.vaultId,
      'X-Original-Size':     String(result.originalSizeBytes),
      'X-PINIT-Identity-Embedded': String(embedded.identityEmbedded),
    });

    auditService.log({
      eventType: 'VAULT_RETRIEVED', vaultId: id,
      dnaRecordId: result.dnaRecordId,
      filename: result.originalFileName, fileType: result.originalMimeType,
      detail: { sizeBytes: result.originalSizeBytes, identityEmbedded: embedded.identityEmbedded },
      req,
    });

    res.status(200).send(embedded.buffer);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('Unsupported state')) {
      return next(new AppError(422, 'Vault file integrity check failed — auth tag mismatch. File may be tampered.'));
    }
    next(err);
  }
}

// ─── POST /vault/:id/protected-download/prepare ───────────────────────────────

export async function prepareProtectedDownload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id } = req.params;
  try {
    const userId = getAuthUserId(req);
    const result = await protectedDownloadService.prepare(id, userId);

    auditService.log({
      eventType: 'PROTECTED_DOWNLOAD_PREPARED' as never,
      vaultId: id,
      dnaRecordId: result.dnaRecordId,
      filename: result.originalFileName,
      fileType: result.originalMimeType,
      detail: {
        certificateId: result.certificateId,
        forensicPreserved: result.forensicPreserved,
        fileSha256: result.fileSha256,
      },
      req,
    });

    res.status(200).json({
      success: true,
      ready: true,
      vaultId: result.vaultId,
      dnaRecordId: result.dnaRecordId,
      certificateId: result.certificateId,
      ownerShortId: result.ownerShortId,
      forensicPreserved: result.forensicPreserved,
      fileSha256: result.fileSha256,
      steps: result.steps,
      originalFileName: result.originalFileName,
      originalMimeType: result.originalMimeType,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('Certificate verification failed')) {
      return next(new AppError(422, err.message));
    }
    if (err instanceof Error && (
      err.message.includes('Unsupported state')
      || err.message.includes('Vault decrypt failed')
      || err.message.includes('auth tag')
    )) {
      return next(new AppError(
        422,
        'Vault file integrity check failed — cannot decrypt. '
        + 'Ensure VAULT_MASTER_SECRET matches the key used when this file was vaulted.',
      ));
    }
    if (err instanceof Error && err.message.includes('disabled')) {
      return next(new AppError(503, err.message));
    }
    next(err);
  }
}

// ─── POST /vault/:id/protected-download ───────────────────────────────────────

export async function protectedDownloadFromVault(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id } = req.params;
  try {
    const userId = getAuthUserId(req);
    const result = await protectedDownloadService.prepare(id, userId);

    let fileBuffer = result.buffer;
    let tepCode: string | undefined;

    const realIp = resolveClientIp(req);
    const geo = realIp ? await geoFromIp(realIp) : null;
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? undefined;
    let tepTrackingFailed = false;
    let tepFailReason: string | undefined;

    logger.info('[ProtectedDownload] Download request', {
      packageVaultId: result.vaultId,
      dnaRecordId: result.dnaRecordId,
      authenticatedUser: userId,
      recipient: `owner:${userId}`,
      ip: realIp,
      country: geo?.country,
      city: geo?.city,
    });

    if (isTepProtectedDownloadEnabled()) {
      try {
        const tep = await tepService.createTrackedExport({
          fileBuffer: result.buffer,
          mimeType: result.originalMimeType,
          filename: result.originalFileName,
          dnaRecordId: result.dnaRecordId,
          vaultId: result.vaultId,
          shareLinkId: protectedDownloadTepChannelId(result.vaultId),
          // Logical recipient only — not a RecipientProfile FK (see watermark.service)
          recipientId: `owner:${userId}`,
          sessionToken: req.headers['x-session-id'] as string | undefined,
          ipAddress: realIp ?? undefined,
          geoCountry: geo?.country ?? undefined,
          geoCity: geo?.city ?? undefined,
          deviceContext: userAgent,
          ownerUserId: userId,
        });
        fileBuffer = tep.buffer;
        tepCode = tep.tepCode;
        logger.info('[ProtectedDownload] TEP package created', {
          tepCode,
          vaultId: result.vaultId,
          dnaRecordId: result.dnaRecordId,
        });
        import('../../services/platform-events/module-events').then(({ emitProtectedDownloadReady }) => {
          emitProtectedDownloadReady({
            ownerUserId: userId,
            vaultId: result.vaultId,
            dnaRecordId: result.dnaRecordId,
            filename: result.originalFileName,
            tepCode: tep.tepCode,
          });
        }).catch(() => {});
      } catch (tepErr) {
        tepTrackingFailed = true;
        tepFailReason = (tepErr as Error).message;
        logger.warn('[TEP] Protected download tracking failed — serving file, still recording download event', {
          vaultId: id,
          error: tepFailReason,
        });
      }
    }

    // Phase B — provenance download event (never blocks download)
    const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose : null;
    const expiryDays = Number.isFinite(Number(req.body?.expiryDays))
      ? Number(req.body.expiryDays)
      : null;
    const recipientLabel = typeof req.body?.recipientLabel === 'string'
      ? req.body.recipientLabel
      : `owner:${userId}`;

    let downloadEventId: string = crypto.randomUUID();
    try {
      const { recordProtectedDownload } = await import('../../services/provenance');
      const recorded = await recordProtectedDownload({
        dnaRecordId: result.dnaRecordId,
        vaultId: result.vaultId,
        actorUserId: userId,
        certificateId: result.certificateId,
        tepCode: tepCode ?? null,
        shareLinkId: protectedDownloadTepChannelId(result.vaultId),
        ipAddress: realIp ?? null,
        userAgent: userAgent ?? null,
        recipientLabel,
        purpose,
        expiryDays,
        forensicPreserved: result.forensicPreserved,
        fileSha256: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
        tepTrackingFailed,
        tepFailReason: tepFailReason ?? null,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
        region: geo?.region ?? null,
      });
      downloadEventId = String(recorded.downloadEventId);
    } catch (provErr) {
      logger.warn('[ProtectedDownload] Provenance append failed (non-fatal)', {
        error: String(provErr),
      });
    }

    res.set({
      'Content-Type': result.originalMimeType,
      'Content-Length': String(fileBuffer.length),
      'Content-Disposition': `attachment; filename="${result.originalFileName}"`,
      'X-Vault-Id': result.vaultId,
      'X-DNA-Record-Id': result.dnaRecordId,
      'X-Certificate-Id': result.certificateId ?? '',
      'X-PINIT-Protected-Download': 'true',
      'X-PINIT-Forensic-Preserved': String(result.forensicPreserved),
      'X-PINIT-Download-Event-Id': downloadEventId,
      'X-Original-Size': String(fileBuffer.length),
      ...(tepCode ? { 'X-TEP-Code': tepCode } : {}),
      ...(tepTrackingFailed ? { 'X-PINIT-TEP-Tracking': 'partial' } : { 'X-PINIT-TEP-Tracking': tepCode ? 'full' : 'off' }),
    });

    auditService.log({
      eventType: 'PROTECTED_DOWNLOAD' as never,
      vaultId: id,
      dnaRecordId: result.dnaRecordId,
      filename: result.originalFileName,
      fileType: result.originalMimeType,
      detail: {
        certificateId: result.certificateId,
        forensicPreserved: result.forensicPreserved,
        fileSha256: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
        steps: result.steps.map((s) => s.id),
        tepCode,
        downloadEventId,
        tepTrackingFailed,
      },
      req,
    });

    res.status(200).send(fileBuffer);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('Certificate verification failed')) {
      return next(new AppError(422, err.message));
    }
    if (err instanceof Error && (
      err.message.includes('Unsupported state')
      || err.message.includes('Vault decrypt failed')
      || err.message.includes('auth tag')
    )) {
      return next(new AppError(
        422,
        'Vault file integrity check failed — cannot decrypt. '
        + 'Ensure VAULT_MASTER_SECRET matches the key used when this file was vaulted.',
      ));
    }
    next(err);
  }
}

// ─── POST /vault/:id/scan-sensitive ───────────────────────────────────────────
// Decrypt the vault file, extract text, detect which sensitive types are present.
// Returns detection flags WITHOUT masking anything.
// Called by the share modal when the owner enables Privacy Masking.

export async function scanVaultFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    const userId = getAuthUserId(req);
    const result = await vaultService.retrieve(id, userId);
    const mime   = result.originalMimeType;
    const buffer = result.originalBuffer;

    // Image / video / audio — no text to extract
    const IMAGE_TYPES  = ['image/jpeg','image/png','image/gif','image/webp','image/bmp','image/tiff'];
    const BINARY_TYPES = ['video/','audio/','application/octet-stream'];
    const isImage  = IMAGE_TYPES.includes(mime);
    const isBinary = BINARY_TYPES.some(t => mime.startsWith(t));

    if (isImage || isBinary) {
      res.json({
        success: true,
        supported: false,
        reason: isImage ? 'Images do not contain extractable text — masking cannot be applied to this file.' : 'Binary file type — no text to scan.',
        email: false, phone: false, aadhaar: false, pan: false, address: false,
        hasAnyMatch: false,
      });
      return;
    }

    // Extract text based on MIME
    let text = '';
    try {
      if (mime === 'application/pdf') {
        text = await extractTextFromPdf(buffer);
      } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        text = await extractTextFromDocx(buffer);
      } else if (mime.startsWith('text/') || mime === 'application/json') {
        text = extractTextFromPlain(buffer);
      } else {
        res.json({ success: true, supported: false, reason: 'Unsupported file type for text extraction.',
          email: false, phone: false, aadhaar: false, pan: false, address: false, hasAnyMatch: false });
        return;
      }
    } catch {
      res.json({ success: true, supported: false, reason: 'Could not extract text from this file.',
        email: false, phone: false, aadhaar: false, pan: false, address: false, hasAnyMatch: false });
      return;
    }

    const detection = detectSensitiveTypes(text);
    logger.info('[Privacy] Scan complete', { vaultId: id, ...detection });
    res.json({ success: true, ...detection });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    next(err);
  }
}


/**
 * POST /vault/verify-identity
 * Multi-vector leaked-file forensics: embedded identity, TEP, share-viewer OCR,
 * watermarks, and visual fingerprint — without touching duplicate-check on upload.
 */
export async function verifyFileIdentity(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) { res.status(400).json({ success: false, error: 'No file uploaded' }); return; }

  try {
    const buffer = file.buffer ?? await fs.readFile(file.path);
    let mimeType = file.mimetype;
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') mimeType = 'application/pdf';
      else if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
    }

    const { leakedFileVerifyService } = await import('../../services/forensics/leaked-file-verify.service');
    let ownerUserId: string | undefined;
    try {
      ownerUserId = getAuthUserId(req);
    } catch { /* public verify — no JWT */ }

    const result = await leakedFileVerifyService.verify(
      buffer,
      mimeType,
      file.originalname,
      ownerUserId ? { ownerUserId } : undefined,
    );

    logger.info('[LeakedVerify] Scan complete', {
      found: result.found,
      method: result.detectionMethod,
      fileName: file.originalname,
      size: buffer.length,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  } finally {
    if (file.path) fs.unlink(file.path).catch(() => {});
  }
}

/** POST /vault/local-dna/backfill — build patch indexes for existing vaulted images */
export async function backfillLocalDnaIndex(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const { localDnaIndexService } = await import('../../services/forensics/local-dna-index.service');
    const result = await localDnaIndexService.backfillOwner(ownerUserId);
    res.json({
      success: true,
      message: `Local DNA index backfill complete — ${result.indexed} indexed, ${result.failed} failed`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /vault/:id/tracking — Phase B tracking dashboard (TEP + downloads + custody) */
export async function getVaultTracking(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const { id } = req.params;
    const { getVaultTrackingDashboard } = await import('../../services/provenance');
    const dashboard = await getVaultTrackingDashboard({ vaultId: id, ownerUserId });
    if (!dashboard) {
      return next(new AppError(404, 'Vault record not found'));
    }
    res.status(200).json({ success: true, tracking: dashboard });
  } catch (err) {
    next(err);
  }
}

/** POST /vault/:id/tep/:tepCode/revoke — revoke a TEP package (append-only custody) */
export async function revokeVaultTep(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const { tepCode } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const { revokeTepPackage } = await import('../../services/provenance');
    const result = await revokeTepPackage({
      tepCode,
      ownerUserId,
      reason,
    });
    if (!result.success && result.status === 'NOT_FOUND') {
      return next(new AppError(404, result.message));
    }
    if (!result.success && result.status === 'FORBIDDEN') {
      return next(new AppError(403, result.message));
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/** DELETE /vault/:id — delete vaulted file and metadata */
export async function deleteVaultRecord(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const vaultId = req.params.id;
    const result = await vaultService.delete(vaultId, ownerUserId);

    auditService.log({
      eventType:   'VAULT_DELETED',
      vaultId,
      dnaRecordId: result.dnaRecordId,
      req,
    }).catch(() => {});

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) return next(new AppError(404, msg));
    if (msg.includes('Forbidden') || msg.includes('owner')) return next(new AppError(403, msg));
    next(err);
  }
}
