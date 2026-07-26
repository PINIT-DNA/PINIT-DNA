/**
 * PINIT-DNA — Duplicate File Prevention Service
 *
 * Runs BEFORE DNA generation. Checks the entire registry for:
 *   1. SHA-256 exact match  — catches any identical file (all types)
 *   2. TEP tracked export   — share-link download bytes
 *   3. Embedded PINIT identity — vault / LSB / binary tail
 *   4. PINIT vault signature  — visible watermarks + OCR (share-viewer screenshots)
 *   5. Normalized pixel hash  — survives metadata / re-save
 *   6. pHash near-duplicate   — visually identical images (configurable threshold)
 *
 * If a duplicate is found:
 *   - Returns the existing DNA record ID + match details
 *   - Logs a DUPLICATE_UPLOAD_ATTEMPT audit event
 *   - Marks as HIGH_RISK when the uploader is different from the original
 *
 * The caller (dna.controller.ts) must abort processing and return 409 Conflict.
 */

import crypto from 'crypto';
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { auditService } from '../audit/audit.service';
import { resolveClientIp } from '../../lib/request-utils';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { tepService } from '../tep/tep.service';
import { pinitSignatureDetector } from './pinit-signature-detector.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { CryptographicLayer } from '../layers/layer1.cryptographic';
import { withTimeoutSoft } from '../../lib/safe-runner';

// ─── Configurable near-duplicate threshold ────────────────────────────────────
// Hamming similarity ≥ this → considered a near-duplicate for images.
// 1.0 = exact, 0.9 = very close, 0.8 = same image resized/filtered
const PHASH_NEAR_DUPLICATE_THRESHOLD = 0.90;
/** Max ms for duplicate checks before DNA generate — keeps upload path in seconds */
const DUPLICATE_CHECK_BUDGET_MS = parseInt(process.env['DUPLICATE_CHECK_BUDGET_MS'] ?? '12000', 10);
const PHASH_SCAN_LIMIT = parseInt(process.env['DUPLICATE_PHASH_SCAN_LIMIT'] ?? '400', 10);

// ─── Types ────────────────────────────────────────────────────────────────────

export type DuplicateMatchType =
  | 'EXACT_HASH'
  | 'NORMALIZED_HASH'
  | 'NEAR_DUPLICATE_PHASH'
  | 'EMBEDDED_IDENTITY'
  | 'TEP_TRACKED_EXPORT'
  | 'PINIT_VAULT_SIGNATURE';

export interface DuplicateCheckResult {
  isDuplicate:     boolean;
  matchType?:      DuplicateMatchType;
  existingRecordId?: string;
  existingFilename?: string;
  existingCreatedAt?: string;
  ownerShortId?:   string;
  ownerUserId?:    string;
  sha256Hash?:     string;
  pHashSimilarity?: number; // 0–1, only for NEAR_DUPLICATE_PHASH
  isHighRisk:      boolean; // true when a different PINIT user uploads an existing file
}

// Hamming similarity helpers removed — PerceptualLayer.verify() used instead.

// ─── Service ──────────────────────────────────────────────────────────────────

export class DuplicateCheckService {
  private readonly perceptualLayer = new PerceptualLayer();
  private readonly cryptoLayer     = new CryptographicLayer();

  /**
   * Compute SHA-256 of raw bytes synchronously.
   * This is the same hash stored in CryptoLayer.sha256Hash.
   */
  computeSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Main entry point — call this BEFORE generating DNA.
   *
   * @param buffer       Raw file bytes
   * @param mimeType     Declared MIME type
   * @param originalName Original filename
   * @param req          Express request (for IP / user-agent logging)
   * @returns DuplicateCheckResult — caller must check .isDuplicate
   */
  async check(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    req: Request,
  ): Promise<DuplicateCheckResult> {

    const sha256 = this.computeSha256(buffer);
    const uploaderIp = resolveClientIp(req);
    const uploaderUserId = (req as { user?: { sub?: string } }).user?.sub;
    const deadline = Date.now() + DUPLICATE_CHECK_BUDGET_MS;
    const hasBudget = () => Date.now() < deadline;

    const recordSelect = {
      id: true,
      imageFilename: true,
      createdAt: true,
      imageMimeType: true,
      ownerUserId: true,
      ownerUser: { select: { shortId: true } },
    } as const;

    // ── 1. SHA-256 exact match (all file types) — GLOBAL vault registry ───────
    // Any user, any vault: identical bytes = same DNA identity (L1 Cryptographic Hash)
    let exactMatchRecord = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: sha256, status: { in: ['COMPLETE', 'PARTIAL', 'PROCESSING'] } },
      select: recordSelect,
    });

    if (!exactMatchRecord) {
      const cryptoMatch = await prisma.cryptoLayer.findFirst({
        where: { sha256Hash: sha256 },
        include: { dnaRecord: { select: recordSelect } },
      });
      if (cryptoMatch) exactMatchRecord = cryptoMatch.dnaRecord;
    }

    if (exactMatchRecord) {
      const rec = exactMatchRecord;
      const ownerShortId = rec.ownerUser?.shortId ?? undefined;
      const isHighRisk = this._isCrossUserUpload(rec.ownerUserId, uploaderUserId)
        || await this._isHighRisk(rec.id, uploaderIp);

      await this._logAttempt({
        sha256,
        existingRecordId: rec.id,
        existingFilename:  rec.imageFilename,
        originalName,
        mimeType,
        matchType: 'EXACT_HASH',
        isHighRisk,
        pHashSimilarity: undefined,
        ownerShortId,
        ownerUserId: rec.ownerUserId ?? undefined,
        req,
      });

      logger.warn('[DuplicateCheck] EXACT duplicate blocked (global registry)', {
        sha256: sha256.slice(0, 16) + '…',
        existingRecordId: rec.id,
        ownerShortId,
        uploaderUserId,
      });

      return {
        isDuplicate:       true,
        matchType:         'EXACT_HASH',
        existingRecordId:  rec.id,
        existingFilename:  rec.imageFilename,
        existingCreatedAt: rec.createdAt.toISOString(),
        ownerShortId,
        ownerUserId:       rec.ownerUserId ?? undefined,
        sha256Hash:        sha256,
        isHighRisk,
      };
    }

    // ── 2. TEP Tracked Export Package (share-link download re-upload) ─────────
    if (hasBudget()) {
      const tepMatch = await withTimeoutSoft(
        () => this._checkTepExport(buffer, mimeType, originalName, sha256, uploaderIp, req),
        4_000,
        'duplicate-tep',
      );
      if (tepMatch) return tepMatch;
    }

    // ── 3. Embedded PINIT identity (vault / share-link downloads) ─────────────
    if (hasBudget()) {
      const identityMatch = await withTimeoutSoft(
        () => this._checkEmbeddedIdentity(buffer, mimeType, originalName, sha256, uploaderIp, req),
        5_000,
        'duplicate-embedded-identity',
      );
      if (identityMatch) return identityMatch;
    }

    // ── 4. PINIT vault visible signature (share-viewer screenshots / OCR) ─────
    if (mimeType.startsWith('image/') && hasBudget()) {
      const signatureMatch = await withTimeoutSoft(
        () => this._checkPinitVaultSignature(buffer, mimeType, originalName, sha256, uploaderIp, req),
        5_000,
        'duplicate-pinit-signature',
      );
      if (signatureMatch) return signatureMatch;
    }

    // ── 5. Normalized pixel hash (images — survives metadata / re-save) ───────
    if (mimeType.startsWith('image/') && hasBudget()) {
      const normalizedMatch = await withTimeoutSoft(
        () => this._checkNormalizedHash(buffer, mimeType, originalName, sha256, uploaderIp, req),
        6_000,
        'duplicate-normalized-hash',
      );
      if (normalizedMatch) return normalizedMatch;
    }

    // ── 6. pHash near-duplicate (images — share watermark / compression) ─────
    if (mimeType.startsWith('image/') && hasBudget()) {
      const nearMatch = await withTimeoutSoft(
        () => this._checkPHashNearDuplicate(buffer, sha256, req, originalName, mimeType, uploaderIp),
        5_000,
        'duplicate-phash',
      );
      if (nearMatch) return nearMatch;
    }

    // ── No duplicate found ────────────────────────────────────────────────────
    return { isDuplicate: false, isHighRisk: false };
  }

  // ── TEP tracked export (share download → re-upload) ────────────────────────

  private async _checkTepExport(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sha256: string,
    uploaderIp: string,
    req: Request,
  ): Promise<DuplicateCheckResult | null> {
    try {
      const tep = await tepService.extractFromFile(buffer, mimeType, originalName);
      if (!tep.found || !tep.dnaRecordId) return null;

      const rec = await prisma.dnaRecord.findUnique({
        where: { id: tep.dnaRecordId },
        select: {
          id: true, imageFilename: true, createdAt: true, ownerUserId: true,
          ownerUser: { select: { shortId: true } },
        },
      });
      if (!rec) return null;

      if (tep.tepCode) {
        await tepService.markRediscovered(tep.tepCode);
        await auditService.log({
          eventType: 'TEP_REDISCOVERED' as never,
          dnaRecordId: rec.id,
          filename: originalName,
          fileType: mimeType,
          req,
          detail: {
            tepCode: tep.tepCode,
            watermarkCode: tep.watermarkCode,
            method: tep.method,
            valid: tep.valid,
          },
        });
      }

      const result = await this._finalizeMatch({
        rec,
        sha256,
        originalName,
        mimeType,
        uploaderIp,
        req,
        matchType: 'TEP_TRACKED_EXPORT',
      });

      logger.warn('[DuplicateCheck] TEP tracked export blocked re-upload', {
        tepCode: tep.tepCode,
        dnaRecordId: rec.id,
        method: tep.method,
      });

      return result;
    } catch (err) {
      logger.warn('[DuplicateCheck] TEP check failed (non-fatal)', { error: String(err) });
      return null;
    }
  }

  // ── PINIT vault signature (screenshots, visible watermarks, metadata) ────────

  private async _checkPinitVaultSignature(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sha256: string,
    uploaderIp: string,
    req: Request,
  ): Promise<DuplicateCheckResult | null> {
    try {
      const hit = await pinitSignatureDetector.detect(buffer, mimeType, originalName, { fast: true });
      if (!hit.detected) return null;

      let rec: {
        id: string;
        imageFilename: string;
        createdAt: Date;
        ownerUserId: string | null;
        ownerUser: { shortId: string } | null;
      } | null = null;

      if (hit.dnaRecordId) {
        rec = await prisma.dnaRecord.findUnique({
          where: { id: hit.dnaRecordId },
          select: {
            id: true, imageFilename: true, createdAt: true, ownerUserId: true,
            ownerUser: { select: { shortId: true } },
          },
        });
      }

      const uploaderUserId = (req as { user?: { sub?: string } }).user?.sub;
      const ownerShortId = rec?.ownerUser?.shortId ?? hit.ownerShortId;
      const isHighRisk = rec
        ? this._isCrossUserUpload(rec.ownerUserId, uploaderUserId) || await this._isHighRisk(rec.id, uploaderIp)
        : true;

      await this._logAttempt({
        sha256,
        existingRecordId: rec?.id ?? 'PINIT_SIGNATURE_UNRESOLVED',
        existingFilename: rec?.imageFilename ?? originalName,
        originalName,
        mimeType,
        matchType: 'PINIT_VAULT_SIGNATURE',
        isHighRisk,
        pHashSimilarity: undefined,
        ownerShortId,
        ownerUserId: rec?.ownerUserId ?? hit.ownerUserId,
        req,
        extraDetail: {
          signatureMethod: hit.method,
          signals: hit.signals.slice(0, 10),
          shareToken: hit.shareToken,
          watermarkCode: hit.watermarkCode,
        },
      });

      logger.warn('[DuplicateCheck] PINIT vault signature blocked DNA generation', {
        method: hit.method,
        shareToken: hit.shareToken,
        watermarkCode: hit.watermarkCode,
        dnaRecordId: hit.dnaRecordId,
        ownerShortId,
      });

      return {
        isDuplicate: true,
        matchType: 'PINIT_VAULT_SIGNATURE',
        existingRecordId: rec?.id,
        existingFilename: rec?.imageFilename,
        existingCreatedAt: rec?.createdAt.toISOString(),
        ownerShortId,
        ownerUserId: rec?.ownerUserId ?? hit.ownerUserId,
        sha256Hash: sha256,
        isHighRisk,
      };
    } catch (err) {
      logger.warn('[DuplicateCheck] PINIT signature check failed (non-fatal)', { error: String(err) });
      return null;
    }
  }

  // ── Embedded identity (vault / share-link re-upload) ───────────────────────

  private async _checkEmbeddedIdentity(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sha256: string,
    uploaderIp: string,
    req: Request,
  ): Promise<DuplicateCheckResult | null> {
    try {
      const identity = await identityEmbeddingService.extractAndVerify(buffer, mimeType, originalName);
      if (!identity.found || !identity.dnaId) return null;

      const rec = await prisma.dnaRecord.findUnique({
        where: { id: identity.dnaId },
        select: {
          id: true, imageFilename: true, createdAt: true, ownerUserId: true,
          ownerUser: { select: { shortId: true } },
        },
      });
      if (!rec) return null;

      const ownerShortId = rec.ownerUser?.shortId ?? undefined;
      const uploaderUserId = (req as { user?: { sub?: string } }).user?.sub;
      const isHighRisk = this._isCrossUserUpload(rec.ownerUserId, uploaderUserId)
        || !identity.valid
        || await this._isHighRisk(rec.id, uploaderIp);

      await this._logAttempt({
        sha256,
        existingRecordId: rec.id,
        existingFilename: rec.imageFilename,
        originalName,
        mimeType,
        matchType: 'EMBEDDED_IDENTITY',
        isHighRisk,
        pHashSimilarity: undefined,
        ownerShortId,
        ownerUserId: rec.ownerUserId ?? undefined,
        req,
      });

      logger.warn('[DuplicateCheck] EMBEDDED IDENTITY duplicate blocked', {
        dnaId: identity.dnaId,
        vaultId: identity.vaultId,
        ownerShortId,
        valid: identity.valid,
      });

      return {
        isDuplicate: true,
        matchType: 'EMBEDDED_IDENTITY',
        existingRecordId: rec.id,
        existingFilename: rec.imageFilename,
        existingCreatedAt: rec.createdAt.toISOString(),
        ownerShortId,
        ownerUserId: rec.ownerUserId ?? undefined,
        sha256Hash: sha256,
        isHighRisk,
      };
    } catch (err) {
      logger.warn('[DuplicateCheck] Identity extraction failed (non-fatal)', { error: String(err) });
      return null;
    }
  }

  // ── Normalized pixel hash (Layer 1 content fingerprint) ──────────────────────

  private async _checkNormalizedHash(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sha256: string,
    uploaderIp: string,
    req: Request,
  ): Promise<DuplicateCheckResult | null> {
    try {
      const probe = await this.cryptoLayer.generate({
        buffer,
        mimeType,
        originalName,
        filePath: '',
        sizeBytes: buffer.length,
      });
      if (!probe.success || !probe.data.normalizedHash) return null;

      const cryptoMatch = await prisma.cryptoLayer.findFirst({
        where: { normalizedHash: probe.data.normalizedHash },
        include: {
          dnaRecord: {
            select: {
              id: true, imageFilename: true, createdAt: true, ownerUserId: true,
              ownerUser: { select: { shortId: true } },
            },
          },
        },
      });
      if (!cryptoMatch?.dnaRecord) return null;

      return this._finalizeMatch({
        rec: cryptoMatch.dnaRecord,
        sha256,
        originalName,
        mimeType,
        uploaderIp,
        req,
        matchType: 'NORMALIZED_HASH',
      });
    } catch (err) {
      logger.warn('[DuplicateCheck] Normalized hash check failed (non-fatal)', { error: String(err) });
      return null;
    }
  }

  // ── pHash near-duplicate check (Layer 3) ───────────────────────────────────

  private async _checkPHashNearDuplicate(
    buffer: Buffer,
    sha256: string,
    req: Request,
    originalName: string,
    mimeType: string,
    uploaderIp: string,
  ): Promise<DuplicateCheckResult | null> {
    try {
      const probe = await this.perceptualLayer.computeFingerprints(buffer);

      const stored = await prisma.perceptualLayer.findMany({
        select: { pHash64: true, aHash64: true, dHash64: true, dnaRecordId: true },
        orderBy: { dnaRecord: { createdAt: 'desc' } },
        take: PHASH_SCAN_LIMIT,
      });

      let bestMatch: { similarity: number; recordId: string } | null = null;

      for (const s of stored) {
        if (!s.pHash64) continue;
        const sim = this.perceptualLayer.verify(probe, {
          pHash64: s.pHash64,
          aHash64: s.aHash64 ?? '',
          dHash64: s.dHash64 ?? '',
        });
        if (sim >= PHASH_NEAR_DUPLICATE_THRESHOLD) {
          if (!bestMatch || sim > bestMatch.similarity) {
            bestMatch = { similarity: sim, recordId: s.dnaRecordId };
          }
        }
      }

      if (!bestMatch) return null;

      const rec = await prisma.dnaRecord.findUnique({
        where: { id: bestMatch.recordId },
        select: {
          id: true, imageFilename: true, createdAt: true, ownerUserId: true,
          ownerUser: { select: { shortId: true } },
        },
      });
      if (!rec) return null;

      return this._finalizeMatch({
        rec,
        sha256,
        originalName,
        mimeType,
        uploaderIp,
        req,
        matchType: 'NEAR_DUPLICATE_PHASH',
        pHashSimilarity: bestMatch.similarity,
      });
    } catch (err) {
      logger.warn('[DuplicateCheck] pHash check failed (non-fatal)', { error: String(err) });
    }

    return null;
  }

  private async _finalizeMatch(params: {
    rec: {
      id: string;
      imageFilename: string;
      createdAt: Date;
      ownerUserId: string | null;
      ownerUser: { shortId: string } | null;
    };
    sha256: string;
    originalName: string;
    mimeType: string;
    uploaderIp: string;
    req: Request;
    matchType: DuplicateMatchType;
    pHashSimilarity?: number;
  }): Promise<DuplicateCheckResult> {
    const { rec, sha256, originalName, mimeType, uploaderIp, req, matchType, pHashSimilarity } = params;
    const ownerShortId = rec.ownerUser?.shortId ?? undefined;
    const uploaderUserId = (req as { user?: { sub?: string } }).user?.sub;
    const isHighRisk = this._isCrossUserUpload(rec.ownerUserId, uploaderUserId)
      || await this._isHighRisk(rec.id, uploaderIp);

    await this._logAttempt({
      sha256,
      existingRecordId: rec.id,
      existingFilename: rec.imageFilename,
      originalName,
      mimeType,
      matchType,
      isHighRisk,
      pHashSimilarity,
      ownerShortId,
      ownerUserId: rec.ownerUserId ?? undefined,
      req,
    });

    logger.warn(`[DuplicateCheck] ${matchType} blocked (global registry)`, {
      existingRecordId: rec.id,
      ownerShortId,
      pHashSimilarity,
    });

    return {
      isDuplicate: true,
      matchType,
      existingRecordId: rec.id,
      existingFilename: rec.imageFilename,
      existingCreatedAt: rec.createdAt.toISOString(),
      ownerShortId,
      ownerUserId: rec.ownerUserId ?? undefined,
      sha256Hash: sha256,
      pHashSimilarity,
      isHighRisk,
    };
  }

  // ── Cross-user: different PINIT account re-uploading an existing file ────────

  private _isCrossUserUpload(originalOwnerId: string | null | undefined, uploaderUserId?: string): boolean {
    if (!originalOwnerId || !uploaderUserId) return false;
    return originalOwnerId !== uploaderUserId;
  }

  // ── Risk heuristic: different uploader IP than original record ─────────────

  private async _isHighRisk(existingRecordId: string, uploaderIp: string): Promise<boolean> {
    try {
      const original = await prisma.auditEvent.findFirst({
        where: { dnaRecordId: existingRecordId, eventType: 'DNA_GENERATED' },
        orderBy: { createdAt: 'asc' },
        select: { ipAddress: true },
      });
      if (!original?.ipAddress) return false;
      // Different IP → likely different user → HIGH RISK
      return original.ipAddress !== uploaderIp;
    } catch {
      return false;
    }
  }

  // ── Audit event ─────────────────────────────────────────────────────────────

  private async _logAttempt(params: {
    sha256: string;
    existingRecordId: string;
    existingFilename: string;
    originalName: string;
    mimeType: string;
    matchType: DuplicateMatchType;
    isHighRisk: boolean;
    pHashSimilarity: number | undefined;
    ownerShortId?: string;
    ownerUserId?: string;
    req: Request;
    extraDetail?: Record<string, unknown>;
  }): Promise<void> {
    const uploaderUserId = (params.req as { user?: { sub?: string } }).user?.sub;
    let uploaderShortId: string | undefined;
    if (uploaderUserId) {
      const uploader = await prisma.user.findUnique({
        where: { id: uploaderUserId },
        select: { shortId: true },
      });
      uploaderShortId = uploader?.shortId;
    }

    await auditService.log({
      eventType:  'DUPLICATE_UPLOAD_ATTEMPT' as never,
      filename:   params.originalName,
      fileType:   params.mimeType,
      dnaRecordId: params.existingRecordId,
      req:        params.req,
      detail: {
        sha256Hash:          params.sha256,
        existingDnaRecordId: params.existingRecordId,
        existingFilename:    params.existingFilename,
        ownerShortId:        params.ownerShortId,
        ownerUserId:         params.ownerUserId,
        uploaderUserId,
        uploaderShortId,
        matchType:           params.matchType,
        riskLevel:           params.isHighRisk ? 'HIGH' : 'LOW',
        pHashSimilarity:     params.pHashSimilarity,
        blocked:             true,
        scope:               'GLOBAL_VAULT_REGISTRY',
        crossUser:           this._isCrossUserUpload(params.ownerUserId, uploaderUserId),
        ...params.extraDetail,
      },
    });

    const crossUser = this._isCrossUserUpload(params.ownerUserId, uploaderUserId);

    // Same-account re-upload: keep block + audit only (no owner spam).
    // Cross-account: alert the file owner that another PINIT ID tried to upload their file.
    if (crossUser && params.ownerUserId) {
      import('../platform-events/module-events').then(({ emitDuplicateUploadBlocked, emitDuplicateUploadAdminAlert }) => {
        emitDuplicateUploadBlocked({
          ownerUserId: params.ownerUserId!,
          dnaRecordId: params.existingRecordId,
          filename: params.existingFilename || params.originalName,
          matchType: params.matchType,
          uploaderLabel: uploaderShortId,
          crossUser: true,
        });

        // Admin Console / platform-owner inbox
        void (async () => {
          try {
            const { getPlatformOwnerShortIds } = await import('../../lib/platform-owner');
            const ownerIds = getPlatformOwnerShortIds();
            if (!ownerIds.length) return;
            const admins = await prisma.user.findMany({
              where: { shortId: { in: ownerIds } },
              select: { id: true, shortId: true },
            });
            for (const admin of admins) {
              // Don't double-notify if the platform owner is also the file owner
              if (admin.id === params.ownerUserId) continue;
              emitDuplicateUploadAdminAlert({
                adminUserId: admin.id,
                ownerShortId: params.ownerShortId,
                uploaderShortId,
                filename: params.existingFilename || params.originalName,
                dnaRecordId: params.existingRecordId,
                matchType: params.matchType,
              });
            }
          } catch {
            /* non-fatal */
          }
        })();
      }).catch(() => {});
    }
  }
}

export const duplicateCheckService = new DuplicateCheckService();
