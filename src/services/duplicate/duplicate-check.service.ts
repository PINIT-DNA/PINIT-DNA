/**
 * PINIT-DNA — Duplicate File Prevention Service
 *
 * Runs BEFORE DNA generation. Checks the registry for:
 *   1. SHA-256 exact match  — catches any identical file (all types)
 *   2. TEP tracked export   — share-link download bytes
 *   3. Embedded PINIT identity — vault / LSB / binary tail
 *   4. PINIT vault signature  — visible watermarks + OCR (share-viewer screenshots)
 *   5. Normalized pixel hash  — survives metadata / re-save
 *   6. pHash near-duplicate   — visually identical images (configurable threshold)
 *
 * Policy:
 *   • Same PINIT account (ownerUserId) → ALLOW — user may protect the same file again
 *   • Different PINIT account → BLOCK — file already has DNA under another user
 *
 * The caller (dna.controller.ts) must abort processing and return 409 Conflict when blocked.
 */

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
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
import { buildVideoAssetDna } from '../assets/video-asset-dna.service';
import { compareVideoFrameHashes } from '../forensics/video-dna-enhancements.service';

// ─── Configurable near-duplicate threshold ────────────────────────────────────
// Hamming similarity ≥ this → considered a near-duplicate for images.
// 1.0 = exact, 0.9 = very close, 0.8 = same image resized/filtered
const PHASH_NEAR_DUPLICATE_THRESHOLD = 0.90;
/** Max ms for duplicate checks before DNA generate — keeps upload path in seconds */
const DUPLICATE_CHECK_BUDGET_MS = parseInt(process.env['DUPLICATE_CHECK_BUDGET_MS'] ?? '8000', 10);
const PHASH_SCAN_LIMIT = parseInt(process.env['DUPLICATE_PHASH_SCAN_LIMIT'] ?? '400', 10);
/**
 * Video gets its own budget. Decoding keyframes from the probe needs ffmpeg and can
 * take several seconds on its own — well past the 8s shared image budget. Video
 * protect is already the slowest path, and a bounded few seconds here is what stops
 * a re-encoded copy being minted a second identity.
 */
const DUPLICATE_VIDEO_BUDGET_MS = parseInt(process.env['DUPLICATE_VIDEO_BUDGET_MS'] ?? '45000', 10);
/** Share of probe keyframes that must strongly match before it counts as the same video. */
const VIDEO_FRAME_MATCH_THRESHOLD = parseFloat(process.env['DUPLICATE_VIDEO_FRAME_THRESHOLD'] ?? '0.6');
const VIDEO_SCAN_LIMIT = parseInt(process.env['DUPLICATE_VIDEO_SCAN_LIMIT'] ?? '300', 10);

// ─── Types ────────────────────────────────────────────────────────────────────

export type DuplicateMatchType =
  | 'EXACT_HASH'
  | 'NORMALIZED_HASH'
  | 'NEAR_DUPLICATE_PHASH'
  | 'NEAR_DUPLICATE_VIDEO_FRAMES'
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

    // ── 1. SHA-256 exact match (all file types) ───────────────────────────────
    // Cross-account: block. Same account: allow re-upload (new DNA allowed).
    // Only owned records can establish that a file already belongs to someone.
    // Unowned probe/verification rows are excluded here as well as guarded below.
    let exactMatchRecord = await prisma.dnaRecord.findFirst({
      where: {
        sha256Hash: sha256,
        status: { in: ['COMPLETE', 'PARTIAL', 'PROCESSING'] },
        ownerUserId: { not: null },
      },
      select: recordSelect,
    });

    if (!exactMatchRecord) {
      const cryptoMatch = await prisma.cryptoLayer.findFirst({
        where: { sha256Hash: sha256, dnaRecord: { is: { ownerUserId: { not: null } } } },
        include: { dnaRecord: { select: recordSelect } },
      });
      if (cryptoMatch) exactMatchRecord = cryptoMatch.dnaRecord;
    }

    if (exactMatchRecord) {
      const rec = exactMatchRecord;
      if (this._isUnownedRecord(rec.ownerUserId)) {
        logger.info('[DuplicateCheck] Match on an unowned record — not a claim, allowing', {
          sha256: sha256.slice(0, 16) + '…',
          existingRecordId: rec.id,
          existingFilename: rec.imageFilename,
        });
        return { isDuplicate: false, isHighRisk: false, sha256Hash: sha256 };
      }
      if (this._isSameAccount(rec.ownerUserId, uploaderUserId)) {
        logger.info('[DuplicateCheck] Same-account re-upload allowed (EXACT_HASH)', {
          sha256: sha256.slice(0, 16) + '…',
          existingRecordId: rec.id,
          uploaderUserId,
        });
        return { isDuplicate: false, isHighRisk: false, sha256Hash: sha256 };
      }

      const ownerShortId = rec.ownerUser?.shortId ?? undefined;
      const isHighRisk = true;

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

      logger.warn('[DuplicateCheck] EXACT duplicate blocked (cross-account)', {
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

    // ── 2–4. Independent detectors in parallel (same budget) ────────────────
    if (hasBudget()) {
      const detectors: Array<Promise<DuplicateCheckResult | null | undefined>> = [
        withTimeoutSoft(
          () => this._checkTepExport(buffer, mimeType, originalName, sha256, uploaderIp, req),
          3_000,
          'duplicate-tep',
        ),
        withTimeoutSoft(
          () => this._checkEmbeddedIdentity(buffer, mimeType, originalName, sha256, uploaderIp, req),
          4_000,
          'duplicate-embedded-identity',
        ),
      ];
      if (mimeType.startsWith('image/')) {
        detectors.push(withTimeoutSoft(
          () => this._checkPinitVaultSignature(buffer, mimeType, originalName, sha256, uploaderIp, req),
          4_000,
          'duplicate-pinit-signature',
        ));
      }
      const hits = await Promise.all(detectors);
      const hit = hits.find((r) => r && r.isDuplicate);
      if (hit) return hit;
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

    // ── 7. Video keyframe near-duplicate (survives re-encode) ────────────────
    // Images have three perceptual detectors; video had none, so a re-encoded copy
    // uploaded to another account was caught by nothing at all.
    if (mimeType.startsWith('video/')) {
      const startedAt = Date.now();
      const videoMatch = await withTimeoutSoft(
        () => this._checkVideoFrameDuplicate(buffer, sha256, req, originalName, mimeType, uploaderIp),
        DUPLICATE_VIDEO_BUDGET_MS,
        'duplicate-video-frames',
      );
      // withTimeoutSoft returns null both for "checked, not a duplicate" and for
      // "gave up". Those are opposite outcomes — one is protection working, the
      // other is protection silently absent — so the timeout has to say so.
      if (videoMatch === null && Date.now() - startedAt >= DUPLICATE_VIDEO_BUDGET_MS - 250) {
        logger.warn('[DuplicateCheck] Video frame check timed out — upload NOT screened', {
          elapsedMs: Date.now() - startedAt,
          budgetMs: DUPLICATE_VIDEO_BUDGET_MS,
          originalName,
        });
      }
      if (videoMatch) return videoMatch;
    }

    // ── No duplicate found ────────────────────────────────────────────────────
    return { isDuplicate: false, isHighRisk: false, sha256Hash: sha256 };
  }

  // ── Video keyframe near-duplicate ──────────────────────────────────────────

  /**
   * Catch a video whose bytes changed but whose pictures did not.
   *
   * Re-encoding rewrites every byte and strips the container tail, so the exact-hash
   * and embedded-identity detectors both miss it. Decoded keyframes survive that,
   * which is the same signal `partial-video-recovery` uses during an investigation.
   *
   * Stored hashes come from `Asset.fingerprints`, already written for every
   * Hub-protected video, so nothing has to be decrypted to run this.
   */
  private async _checkVideoFrameDuplicate(
    buffer: Buffer,
    sha256: string,
    req: Request,
    originalName: string,
    mimeType: string,
    uploaderIp: string,
  ): Promise<DuplicateCheckResult | null> {
    try {
      const probe = await buildVideoAssetDna(buffer);
      const probeHashes = probe.framePHashes ?? [];
      if (!probeHashes.length) {
        // No ffmpeg, or the file yielded no decodable frames. Never guess from
        // container bytes — a wrong block here refuses someone their own upload.
        logger.warn('[DuplicateCheck] No probe keyframes — video NOT screened for duplicates', {
          ffmpegAvailable: probe.ffmpegAvailable,
          originalName,
        });
        return null;
      }

      const candidates = await prisma.asset.findMany({
        where: {
          assetType: 'VIDEO',
          fingerprints: { not: Prisma.DbNull },
          dnaId: { not: null },
        },
        select: { dnaId: true, fingerprints: true },
        orderBy: { createdAt: 'desc' },
        take: VIDEO_SCAN_LIMIT,
      });

      let best: { dnaId: string; similarity: number } | null = null;
      let bestSeen = 0;
      let comparable = 0;
      for (const c of candidates) {
        if (!c.dnaId) continue;
        const stored = (c.fingerprints as { framePHashes?: string[] } | null)?.framePHashes;
        if (stored?.length) comparable++;
        const { similarity } = compareVideoFrameHashes(probeHashes, stored);
        if (similarity > bestSeen) bestSeen = similarity;
        if (similarity >= VIDEO_FRAME_MATCH_THRESHOLD && (!best || similarity > best.similarity)) {
          best = { dnaId: c.dnaId, similarity };
        }
      }

      logger.info('[DuplicateCheck] Video frame scan complete', {
        probeFrames: probeHashes.length,
        candidates: candidates.length,
        comparable,
        bestSimilarity: Number(bestSeen.toFixed(2)),
        threshold: VIDEO_FRAME_MATCH_THRESHOLD,
        matched: !!best,
      });

      if (!best) return null;

      const rec = await prisma.dnaRecord.findUnique({
        where: { id: best.dnaId },
        select: {
          id: true, imageFilename: true, createdAt: true, ownerUserId: true,
          ownerUser: { select: { shortId: true } },
        },
      });
      if (!rec) return null;

      logger.info('[DuplicateCheck] Video keyframe match', {
        existingRecordId: rec.id,
        similarity: best.similarity,
        probeFrames: probeHashes.length,
      });

      // Ownership policy (unowned ignored, same account allowed, cross-account
      // blocked) is inherited from the shared path rather than restated here.
      return this._finalizeMatch({
        rec,
        sha256,
        originalName,
        mimeType,
        uploaderIp,
        req,
        matchType: 'NEAR_DUPLICATE_VIDEO_FRAMES',
        pHashSimilarity: best.similarity,
      });
    } catch (err) {
      logger.warn('[DuplicateCheck] Video frame check failed (non-fatal)', { error: String(err) });
      return null;
    }
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

      if (this._isSameAccount(rec.ownerUserId, (req as { user?: { sub?: string } }).user?.sub)) {
        logger.info('[DuplicateCheck] Same-account TEP re-upload allowed', { dnaRecordId: rec.id });
        return null;
      }

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

      if (rec && this._isSameAccount(rec.ownerUserId, uploaderUserId)) {
        logger.info('[DuplicateCheck] Same-account PINIT signature re-upload allowed', {
          dnaRecordId: rec.id,
        });
        return null;
      }

      const ownerShortId = rec?.ownerUser?.shortId ?? hit.ownerShortId;
      const isHighRisk = rec
        ? await this._isHighRisk(rec.id, uploaderIp)
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

      const uploaderUserId = (req as { user?: { sub?: string } }).user?.sub;
      if (this._isSameAccount(rec.ownerUserId, uploaderUserId)) {
        logger.info('[DuplicateCheck] Same-account embedded identity re-upload allowed', {
          dnaId: identity.dnaId,
        });
        return null;
      }

      const ownerShortId = rec.ownerUser?.shortId ?? undefined;
      const isHighRisk = !identity.valid || await this._isHighRisk(rec.id, uploaderIp);

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
        where: {
          normalizedHash: probe.data.normalizedHash,
          dnaRecord: { is: { ownerUserId: { not: null } } },
        },
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
        where: { dnaRecord: { is: { ownerUserId: { not: null } } } },
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
    const uploaderUserId = (req as { user?: { sub?: string } }).user?.sub;

    if (this._isUnownedRecord(rec.ownerUserId)) {
      logger.info(`[DuplicateCheck] ${matchType} matched an unowned record — not a claim, allowing`, {
        existingRecordId: rec.id,
        existingFilename: rec.imageFilename,
      });
      return { isDuplicate: false, isHighRisk: false };
    }

    if (this._isSameAccount(rec.ownerUserId, uploaderUserId)) {
      logger.info(`[DuplicateCheck] Same-account re-upload allowed (${matchType})`, {
        existingRecordId: rec.id,
        uploaderUserId,
      });
      return { isDuplicate: false, isHighRisk: false };
    }

    const ownerShortId = rec.ownerUser?.shortId ?? undefined;
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

    logger.warn(`[DuplicateCheck] ${matchType} blocked (cross-account)`, {
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

  // ── Same PINIT account → allow duplicate uploads ───────────────────────────

  private _isSameAccount(originalOwnerId: string | null | undefined, uploaderUserId?: string): boolean {
    if (!originalOwnerId || !uploaderUserId) return false;
    return originalOwnerId === uploaderUserId;
  }

  /**
   * A record with no owner cannot establish that a file belongs to anybody.
   *
   * Verification probes and other internal artifacts are written without an
   * ownerUserId. They are neither the uploader's account nor another user's, so
   * blocking on them tells a real owner their own file belongs to a stranger who
   * cannot be named. Never block on an unowned record.
   */
  private _isUnownedRecord(originalOwnerId: string | null | undefined): boolean {
    return !originalOwnerId;
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
        scope:               'CROSS_ACCOUNT_REGISTRY',
        crossUser:           this._isCrossUserUpload(params.ownerUserId, uploaderUserId),
        ...params.extraDetail,
      },
    });

    const crossUser = this._isCrossUserUpload(params.ownerUserId, uploaderUserId);

    // Same-account re-upload: allowed — no block, no owner alert.
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
