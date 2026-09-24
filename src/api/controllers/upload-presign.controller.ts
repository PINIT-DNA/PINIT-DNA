/**
 * PINIT-DNA — Presigned S3 Upload Controller
 *
 * Mints a presigned S3 PUT URL for direct browser-to-S3 asset intake, per the
 * ECS readiness audit §5 ("S3 Direct Uploads"), then runs the same
 * generate-DNA + store-in-vault pipeline POST /dna/generate + POST
 * /vault/store already run today (src/api/controllers/dna.controller.ts,
 * src/api/controllers/vault.controller.ts) once the upload completes —
 * fetching the bytes from S3 instead of a multer temp file. Inert until
 * STORAGE_BACKEND=s3 and S3_BUCKET are actually configured (Phase 1).
 *
 * Deliberately scoped: this reuses the DNA-generation + vault-storage core
 * (duplicate check, UniversalFileRouter, VaultService.store) exactly, but
 * intentionally does NOT yet replicate every peripheral fire-and-forget side
 * effect generateDna/storeInVault also perform today (org webhook dispatch,
 * auto web-monitoring enrollment, vault content-analysis, audit logging).
 * Those are independent, additive features or"orthogonal to the storage
 * migration this endpoint exists to prove out, and adding all of them here
 * before this path has been exercised for real would widen the risk surface
 * of a single change well past what Step 2 asked for. Noted explicitly so
 * it's a visible, reviewable scoping decision, not a silent gap.
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getAuthUserId } from '../../lib/tenant-scope';
import { AppError } from '../middleware/error.middleware';
import { config } from '../../config';
import { createPresignedRawUploadUrl, headRawUpload, fetchRawUpload } from '../../lib/s3-presigned-upload';
import { isS3StorageConfigured } from '../../lib/s3-storage';
import { getS3Client } from '../../lib/s3-storage';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { UniversalFileRouter } from '../../services/universal-file-router';
import { duplicateCheckService } from '../../services/duplicate/duplicate-check.service';
import { VaultService } from '../../services/vault/vault.service';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { buildDuplicateMessage } from './dna.controller';

const router = new UniversalFileRouter();
const vaultService = new VaultService();

const presignRequestSchema = z.object({
  // Client-declared size — a preflight signal only. The real size is
  // re-checked server-side via HeadObject once the upload completes
  // (headRawUpload below), since a presigned PUT enforces nothing on its
  // own and a client can lie about this value.
  declaredSizeBytes: z.number().int().positive(),
  contentType: z.string().max(255).optional(),
});

export async function presignUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (config.storage.backend !== 's3' || !isS3StorageConfigured()) {
      return next(new AppError(503, 'S3 direct upload is not configured on this deployment yet.'));
    }

    const ownerUserId = getAuthUserId(req);
    const parsed = presignRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(400, 'Invalid presign request', parsed.error.flatten()));
    }

    // Preflight against the client-declared size — the same quota gate every
    // other protect route already applies (entitlementService.assertCanUpload,
    // introduced in commit aa0cacd).
    const { entitlementService } = await import('../../services/subscription');
    await entitlementService.assertCanUpload(ownerUserId, parsed.data.declaredSizeBytes);

    const presigned = await createPresignedRawUploadUrl({
      ownerUserId,
      contentType: parsed.data.contentType,
    });

    logger.info('[UploadPresign] Minted presigned upload URL', {
      ownerUserId: ownerUserId.slice(0, 8),
      uploadId: presigned.uploadId,
      declaredSizeBytes: parsed.data.declaredSizeBytes,
    });

    res.json({
      uploadId: presigned.uploadId,
      key: presigned.key,
      url: presigned.url,
      expiresInSeconds: presigned.expiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
}

const completeRequestSchema = z.object({
  key: z.string().min(1),
  declaredSizeBytes: z.number().int().positive(),
  originalFileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
});

/** Best-effort S3 cleanup — never lets a cleanup failure mask the real error. */
async function deleteRawUpload(key: string): Promise<void> {
  try {
    const bucket = config.storage.s3Bucket.trim();
    if (!bucket) return;
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    logger.debug('[UploadPresign] Deleted raw upload object', { key });
  } catch (err) {
    logger.warn('[UploadPresign] Failed to delete raw upload object (non-fatal)', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Confirms a presigned upload landed in S3, re-validates its real size, then
 * runs the full generate-DNA + store-in-vault pipeline against it.
 *
 * Every exit path either results in the object being consumed into the
 * vault (and the raw 'incoming/' copy deleted, since it is now redundant)
 * or the object being deleted outright — a completed upload is never left
 * orphaned in S3 by: a duplicate-content rejection, a validation failure
 * (quota/ownership), a processing failure, or a retried request (the
 * dnaRecordId/vaultRecord uniqueness already enforced by the DNA/vault
 * layer themselves makes a retry of the same key idempotent rather than a
 * second full pipeline run — see the "already vaulted" replay handling in
 * VaultService.store()).
 */
export async function confirmPresignedUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  let tempFilePath: string | null = null;
  let cleanupS3OnExit = true; // flipped to false only once the object is safely superseded by a vault copy

  try {
    if (config.storage.backend !== 's3' || !isS3StorageConfigured()) {
      return next(new AppError(503, 'S3 direct upload is not configured on this deployment yet.'));
    }

    const ownerUserId = getAuthUserId(req);
    const parsed = completeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(400, 'Invalid completion request', parsed.error.flatten()));
    }
    const { key, originalFileName, mimeType } = parsed.data;

    // Only ever confirm a key under this owner's own prefix — never trust a
    // client-supplied key blindly, even though it was server-generated at
    // presign time.
    if (!key.startsWith(`incoming/${ownerUserId}/`)) {
      return next(new AppError(403, 'Upload key does not belong to this account.'));
    }

    const head = await headRawUpload(key);
    if (!head) {
      return next(new AppError(404, 'Upload not found — it may not have completed yet.'));
    }

    // Re-validate against the REAL observed size, not what the client
    // originally declared at presign time. A failure here is a validation
    // failure per Step 2 — clean up the orphaned object before returning.
    try {
      const { entitlementService } = await import('../../services/subscription');
      await entitlementService.assertCanUpload(ownerUserId, head.sizeBytes);
    } catch (err) {
      await deleteRawUpload(key);
      return next(err);
    }

    // Fetch into a real temp file — UniversalFileRouter.route() takes a
    // filePath (several engines read it directly), so this stages the
    // S3-fetched bytes exactly where a multer upload would have put them.
    // This is the "minimal-diff seam" the ECS readiness audit describes:
    // DnaOrchestrator/UniversalFileRouter's own contract does not change.
    const buffer = await fetchRawUpload(key);
    tempFilePath = path.join(config.upload.tempDir, `s3_${randomUUID()}${path.extname(originalFileName) || ''}`);
    await fs.mkdir(config.upload.tempDir, { recursive: true });
    await fs.writeFile(tempFilePath, buffer);

    // ── Duplicate check — identical policy to POST /dna/generate ──────────
    const dupResult = await duplicateCheckService.check(buffer, mimeType, originalFileName, req);
    if (dupResult.isDuplicate) {
      await deleteRawUpload(key);
      const duplicateReason = buildDuplicateMessage(dupResult.matchType, dupResult.ownerShortId);
      logger.warn('[UploadPresign] Duplicate upload blocked (cross-account)', {
        matchType: dupResult.matchType,
        existingRecordId: dupResult.existingRecordId,
      });
      res.status(409).json({
        success: false,
        duplicate: true,
        error: duplicateReason,
        matchType: dupResult.matchType,
        existingRecordId: dupResult.existingRecordId,
        existingFilename: dupResult.existingFilename,
        existingCreatedAt: dupResult.existingCreatedAt,
        ownerShortId: dupResult.ownerShortId ?? null,
        sha256Hash: dupResult.sha256Hash,
        pHashSimilarity: dupResult.pHashSimilarity,
        riskLevel: dupResult.isHighRisk ? 'HIGH' : 'LOW',
      });
      return;
    }

    // ── Generate DNA (same call shape as POST /dna/generate) ──────────────
    const genResult = await router.route({
      filePath: tempFilePath,
      originalName: originalFileName,
      declaredMimeType: mimeType,
      sizeBytes: head.sizeBytes,
      buffer,
      ownerUserId,
      uploadStartMs: Date.now(),
    });

    if (ownerUserId) {
      await prisma.dnaRecord.update({
        where: { id: genResult.dnaRecordId },
        data: { ownerUserId },
      });
    }

    // ── Store in vault (same call shape as POST /vault/store) ─────────────
    const storeResult = await vaultService.store({
      dnaRecordId: genResult.dnaRecordId,
      ownerUserId,
      imageBuffer: buffer,
      originalFileName,
      originalMimeType: mimeType,
    });

    // The vault now holds its own encrypted copy under a different key
    // (`{ownerUserId}/{vaultId}.enc`, via s3-storage.ts) — the raw
    // 'incoming/' object served its purpose and would otherwise sit in S3
    // forever, doubling storage for every asset.
    cleanupS3OnExit = true;
    await deleteRawUpload(key);
    cleanupS3OnExit = false;

    logger.info('[UploadPresign] Upload processed end-to-end', {
      ownerUserId: ownerUserId.slice(0, 8),
      dnaRecordId: genResult.dnaRecordId,
      vaultId: storeResult.vaultId,
    });

    res.status(201).json({
      success: true,
      dnaRecordId: genResult.dnaRecordId,
      vaultId: storeResult.vaultId,
      assetId: storeResult.assetId ?? null,
      status: genResult.status,
      fileType: genResult.fileType,
      originalFileName: storeResult.originalFileName,
      originalMimeType: storeResult.originalMimeType,
      encryptedSizeBytes: storeResult.encryptedSizeBytes,
      originalSizeBytes: storeResult.originalSizeBytes,
    });
  } catch (err) {
    // Processing failure — do not leave the object orphaned in S3.
    if (cleanupS3OnExit) {
      const parsed = completeRequestSchema.safeParse(req.body);
      if (parsed.success) await deleteRawUpload(parsed.data.key);
    }
    if (err instanceof Error && err.message.includes('not yet available')) {
      return next(new AppError(422, err.message));
    }
    if (err instanceof Error && err.message.includes('Unsupported file type')) {
      return next(new AppError(415, err.message));
    }
    next(err);
  } finally {
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch((e) =>
        logger.warn('[UploadPresign] Failed to delete staged temp file', { path: tempFilePath, error: String(e) }),
      );
    }
  }
}
