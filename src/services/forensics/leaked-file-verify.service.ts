/**
 * PINIT-DNA — Leaked File Verification (multi-vector forensics)
 *
 * Detects PINIT-protected content leaked via download re-upload, screenshot,
 * screen recording, copy/paste, or original file with embedded identity.
 *
 * Does NOT modify duplicate-check on /dna/generate — read-only forensics only.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { tepService } from '../tep/tep.service';
import { extractTepTail } from '../tep/tep.service';
import { pinitSignatureDetector } from '../duplicate/pinit-signature-detector.service';
import { extractWatermarkFromFile } from '../watermark/watermark.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { CryptographicLayer } from '../layers/layer1.cryptographic';
import {
  resolveShareTokenFromText,
  resolveShareLinkByFilenameInText,
  resolveShareLinkByExactFilename,
  resolveShareTokenFuzzy,
  resolveShareTokenLevenshtein,
  resolveShareLinkByLooseFilenameInText,
} from '../share/share-token-resolver';

const PHASH_LEAK_THRESHOLD = 0.88;

export type LeakDetectionMethod =
  | 'EMBEDDED_IDENTITY'
  | 'EXACT_HASH'
  | 'NORMALIZED_HASH'
  | 'TEP_EXPORT'
  | 'PINIT_VAULT_SIGNATURE'
  | 'WATERMARK'
  | 'NEAR_DUPLICATE_PHASH';

export type LeakVector =
  | 'ORIGINAL_FILE'
  | 'DOWNLOAD_REUPLOAD'
  | 'SCREENSHOT'
  | 'RECORDING'
  | 'COPY_PASTE'
  | 'UNKNOWN';

export interface LeakedFileAccessEntry {
  timestamp: string;
  action: string;
  ipAddress?: string;
  country?: string;
  city?: string;
  region?: string;
  device?: string;
  browser?: string;
  os?: string;
  riskLevel?: string;
  locationShared?: boolean;
  gpsLat?: number;
  gpsLng?: number;
}

export interface LeakedFileVerifyResult {
  found: boolean;
  valid?: boolean;
  tampered?: boolean;
  detectionMethod?: LeakDetectionMethod;
  leakVector?: LeakVector;
  confidence?: number;
  message: string;
  identity?: {
    dnaId?: string;
    vaultId?: string;
    ownerUserId?: string;
    ownerEmail?: string;
    ownerName?: string;
    ownerShortId?: string;
    originalFilename?: string;
    dnaCreatedAt?: string;
  };
  shareLink?: {
    id?: string;
    token?: string;
    shareUrl?: string;
    filename?: string;
    createdAt?: string;
    expiresAt?: string;
    linkType?: string;
    recipientLabel?: string;
    recipientEmail?: string;
  };
  recipient?: {
    label?: string;
    recipientCode?: string;
    email?: string;
    firstAccessAt?: string;
    lastAccessAt?: string;
    knownCountries?: string[];
  };
  watermark?: {
    code?: string;
    extractionMethod?: string;
  };
  tep?: {
    code?: string;
    valid?: boolean;
  };
  forensic?: {
    signals?: string[];
    shareToken?: string;
    pHashSimilarity?: number;
    signatureMethod?: string;
  };
  accessHistory?: LeakedFileAccessEntry[];
}

const recordSelect = {
  id: true,
  imageFilename: true,
  vaultRecord: { select: { id: true } },
  ownerUserId: true,
  createdAt: true,
  ownerUser: { select: { email: true, fullName: true, shortId: true } },
} as const;

export class LeakedFileVerifyService {
  private readonly perceptualLayer = new PerceptualLayer();
  private readonly cryptoLayer = new CryptographicLayer();

  async verify(buffer: Buffer, mimeType: string, fileName: string): Promise<LeakedFileVerifyResult> {
    const effectiveMime = this._resolveMimeType(mimeType, fileName);

    // ── 0. Share-link filename registry (works for downloaded PDF/DOCX/images) ─
    try {
      const byName = await this._resolveByShareFilename(fileName);
      if (byName) return byName;
    } catch (err) {
      logger.warn('[LeakedVerify] Filename registry lookup failed', { error: String(err) });
    }

    // ── 0b. TEP export hash registry (exact downloaded bytes from share link) ───
    try {
      const byExport = await this._checkTepExportRegistry(buffer);
      if (byExport) return byExport;
    } catch (err) {
      logger.warn('[LeakedVerify] TEP export registry failed', { error: String(err) });
    }

    // ── 1. Embedded identity (original or HMAC-tampered) ─────────────────────
    const embedded = await identityEmbeddingService.extractLoose(buffer, effectiveMime, fileName);
    if (embedded.found && embedded.dnaId) {
      return this._fromDnaRecord(embedded.dnaId, {
        detectionMethod: 'EMBEDDED_IDENTITY',
        leakVector: embedded.valid ? 'ORIGINAL_FILE' : 'COPY_PASTE',
        valid: embedded.valid,
        tampered: embedded.tampered,
        confidence: embedded.valid ? 99 : 88,
        message: embedded.valid
          ? 'Embedded PINIT-DNA identity verified — original protected file (vault or intact download).'
          : 'Embedded identity recovered but HMAC invalid — file was modified/tampered after protection.',
      });
    }

    // ── 2. Exact SHA-256 match (untouched download / identical re-upload) ───
    try {
      const exact = await this._checkExactHash(buffer);
      if (exact) return exact;
    } catch (err) {
      logger.warn('[LeakedVerify] Exact hash check failed (non-fatal)', { error: String(err) });
    }

    // ── 3. TEP tracked export (share-link download) ─────────────────────────
    try {
      const tep = await tepService.extractFromFile(buffer, effectiveMime, fileName);
      if (tep.found && tep.dnaRecordId) {
        const base = await this._buildFromIds({
          dnaRecordId: tep.dnaRecordId,
          vaultId: tep.vaultId,
          shareLinkId: tep.shareLinkId,
          detectionMethod: 'TEP_EXPORT',
          leakVector: 'DOWNLOAD_REUPLOAD',
          valid: tep.valid,
          tampered: !tep.valid,
          confidence: tep.valid ? 97 : 85,
          message: tep.valid
            ? 'Tracked Export Package (TEP) detected — file was downloaded via a PINIT share link.'
            : 'TEP markers found but signature damaged — file was downloaded then tampered.',
        });
        return {
          ...base,
          tep: { code: tep.tepCode, valid: tep.valid },
          watermark: tep.watermarkCode
            ? { code: tep.watermarkCode, extractionMethod: tep.method }
            : base.watermark,
        };
      }
    } catch (err) {
      logger.warn('[LeakedVerify] TEP check failed (non-fatal)', { error: String(err) });
    }

    // ── 3. Share-viewer screenshot (images) — OCR + DB before heavy hash scans ─
    if (effectiveMime.startsWith('image/')) {
      try {
        const screenshot = await this._traceScreenshotLeak(buffer, effectiveMime, fileName);
        if (screenshot) return screenshot;
      } catch (err) {
        logger.warn('[LeakedVerify] Screenshot trace failed (non-fatal)', { error: String(err) });
      }
    }

    // ── 4. Normalized pixel hash (re-saved / metadata stripped / partial tamper) ─
    try {
      const normalized = await this._checkNormalizedHash(buffer, effectiveMime, fileName);
      if (normalized) return normalized;
    } catch (err) {
      logger.warn('[LeakedVerify] Normalized hash check failed (non-fatal)', { error: String(err) });
    }

    // ── 5. Forensic watermark extraction (PDF/DOCX/image metadata) ───────────
    try {
      const wm = await extractWatermarkFromFile(buffer, effectiveMime);
      if (wm.watermarkCode) {
        const profile = await prisma.watermarkProfile.findUnique({
          where: { watermarkCode: wm.watermarkCode },
          include: { recipientProfile: true },
        });
        if (profile) {
          const base = await this._buildFromIds({
            dnaRecordId: profile.dnaRecordId ?? undefined,
            shareLinkId: profile.shareLinkId,
            detectionMethod: 'WATERMARK',
            leakVector: 'DOWNLOAD_REUPLOAD',
            valid: true,
            tampered: true,
            confidence: 96,
            message: 'PINIT watermark extracted — file originated from a tracked share download (may be tampered).',
          });
          return {
            ...base,
            watermark: { code: wm.watermarkCode, extractionMethod: wm.method },
          };
        }
      }
    } catch (err) {
      logger.warn('[LeakedVerify] Watermark check failed (non-fatal)', { error: String(err) });
    }

    // ── 6. pHash visual match (screenshot / recording / re-encoded tampered copy) ─
    if (effectiveMime.startsWith('image/')) {
      try {
        const near = await this._checkPHashMatch(buffer);
        if (near) return near;
      } catch (err) {
        logger.warn('[LeakedVerify] pHash check failed (non-fatal)', { error: String(err) });
      }
    }

    return {
      found: false,
      message: 'No PINIT-DNA trace found. For best results: upload the file from the share link Download button (e.g. Kavyam_Ashwitha_Optum_Resume.pdf), or a screenshot that clearly shows the filename bar and Token line on the Link Intelligence or Secure Viewer page.',
    };
  }

  private _resolveMimeType(mimeType: string, fileName: string): string {
    if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',
    };
    return map[ext] ?? mimeType;
  }

  private async _resolveByShareFilename(fileName: string): Promise<LeakedFileVerifyResult | null> {
    const match =
      (fileName ? await resolveShareLinkByExactFilename(fileName) : undefined);
    if (!match) return null;

    return this._fromDnaRecord(match.dnaRecordId, {
      detectionMethod: 'EXACT_HASH',
      leakVector: 'DOWNLOAD_REUPLOAD',
      valid: true,
      tampered: false,
      confidence: 93,
      message: `File matched share link registry by filename "${fileName}" — traced to original shared file.`,
      shareToken: match.token,
      shareLinkId: match.shareLinkId,
    });
  }

  private async _checkTepExportRegistry(buffer: Buffer): Promise<LeakedFileVerifyResult | null> {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const manifest = await prisma.trackedExportPackage.findFirst({
      where: {
        OR: [{ exportSha256: sha256 }, { sourceSha256: sha256 }],
        status: { in: ['ACTIVE', 'REDISCOVERED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (manifest) {
      return this._buildFromIds({
        dnaRecordId: manifest.dnaRecordId,
        vaultId: manifest.vaultId,
        shareLinkId: manifest.shareLinkId,
        detectionMethod: 'TEP_EXPORT',
        leakVector: 'DOWNLOAD_REUPLOAD',
        valid: true,
        tampered: manifest.exportSha256 !== sha256,
        confidence: 98,
        message: manifest.exportSha256 === sha256
          ? 'Exact match with TEP tracked export registry — this is the downloaded share file.'
          : 'Matches pre-export vault bytes — file may be an unmarked copy of the shared content.',
      }).then((base) => ({
        ...base,
        tep: { code: manifest.tepCode, valid: true },
        watermark: manifest.watermarkCode
          ? { code: manifest.watermarkCode, extractionMethod: 'tep-registry' }
          : base.watermark,
      }));
    }

    // Binary TEP tail even when mime detection failed
    const tail = extractTepTail(buffer);
    if (tail?.includes('TEP:v1:')) {
      const tep = await tepService.extractFromFile(buffer, 'application/octet-stream', 'probe.bin');
      if (tep.found && tep.dnaRecordId) {
        const base = await this._buildFromIds({
          dnaRecordId: tep.dnaRecordId,
          vaultId: tep.vaultId,
          shareLinkId: tep.shareLinkId,
          detectionMethod: 'TEP_EXPORT',
          leakVector: 'DOWNLOAD_REUPLOAD',
          valid: tep.valid,
          tampered: !tep.valid,
          confidence: tep.valid ? 97 : 85,
          message: tep.valid
            ? 'TEP manifest tail detected in downloaded file.'
            : 'TEP tail found but signature damaged — file was tampered after download.',
        });
        return {
          ...base,
          tep: { code: tep.tepCode, valid: tep.valid },
        };
      }
    }

    return null;
  }

  private async _traceScreenshotLeak(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<LeakedFileVerifyResult | null> {
    const ocrText = await pinitSignatureDetector.extractOcrText(buffer, mimeType);
    const combined = [ocrText, fileName].filter(Boolean).join('\n');

    let shareToken = combined
      ? (await resolveShareTokenFromText(combined))
        ?? (await resolveShareTokenFuzzy(combined))
        ?? (await resolveShareTokenLevenshtein(combined))
      : undefined;
    let shareLinkId: string | undefined;
    let dnaRecordId: string | undefined;

    if (!shareToken && !dnaRecordId) {
      const byFilename =
        (combined ? await resolveShareLinkByLooseFilenameInText(combined) : undefined)
        ?? (combined ? await resolveShareLinkByFilenameInText(combined) : undefined)
        ?? (fileName ? await resolveShareLinkByExactFilename(fileName) : undefined);
      if (byFilename) {
        shareToken = byFilename.token;
        shareLinkId = byFilename.shareLinkId;
        dnaRecordId = byFilename.dnaRecordId;
      }
    }

    if (!dnaRecordId) {
      try {
        const wm = await extractWatermarkFromFile(buffer, mimeType);
        if (wm.watermarkCode) {
          const profile = await prisma.watermarkProfile.findUnique({
            where: { watermarkCode: wm.watermarkCode },
            select: { dnaRecordId: true, shareLinkId: true },
          });
          if (profile?.dnaRecordId) {
            dnaRecordId = profile.dnaRecordId;
            shareLinkId = profile.shareLinkId;
          }
        }
      } catch { /* non-fatal */ }
    }

    if (!dnaRecordId && shareToken) {
      const link = await prisma.shareLink.findUnique({
        where: { token: shareToken },
        select: { id: true, dnaRecordId: true },
      });
      if (link) {
        shareLinkId = link.id;
        dnaRecordId = link.dnaRecordId;
      } else {
        shareToken = undefined;
      }
    }

    if (shareToken || dnaRecordId) {
      const commonOpts = {
        detectionMethod: 'PINIT_VAULT_SIGNATURE' as const,
        leakVector: 'SCREENSHOT' as const,
        valid: true,
        tampered: true,
        signatureMethod: 'ocr_forensics',
      };
      if (dnaRecordId) {
        return this._fromDnaRecord(dnaRecordId, {
          ...commonOpts,
          confidence: shareToken ? 96 : 92,
          message: 'Share-viewer screenshot traced to vault file via OCR / share link.',
          shareToken,
          shareLinkId,
        });
      }
      if (shareToken) {
        return this._fromShareToken(shareToken, {
          ...commonOpts,
          confidence: 94,
          message: 'Share-viewer screenshot traced via share link token or filename.',
          shareToken,
        });
      }
    }

    const sig = await pinitSignatureDetector.detect(buffer, mimeType, fileName);
    if (!sig.detected) return null;

    return this._fromUnresolvedScreenshot({
      detectionMethod: 'PINIT_VAULT_SIGNATURE',
      leakVector: 'SCREENSHOT',
      valid: true,
      tampered: true,
      confidence: 75,
      message: 'PINIT share-viewer UI detected. Include the footer token or filename bar for full owner details.',
      signatureMethod: sig.method,
      signals: sig.signals,
      ocrText: combined,
    });
  }

  private async _fromDnaRecord(
    dnaRecordId: string,
    opts: {
      detectionMethod: LeakDetectionMethod;
      leakVector: LeakVector;
      valid: boolean;
      tampered: boolean;
      confidence: number;
      message: string;
      shareToken?: string;
      shareLinkId?: string;
      signatureMethod?: string;
      signals?: string[];
      pHashSimilarity?: number;
    },
  ): Promise<LeakedFileVerifyResult> {
    const rec = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: recordSelect,
    });
    if (!rec) {
      return { found: false, message: 'DNA record reference found but record no longer exists.' };
    }

    let shareLinkId = opts.shareLinkId;
    if (!shareLinkId && opts.shareToken) {
      const link = await prisma.shareLink.findUnique({
        where: { token: opts.shareToken },
        select: { id: true },
      });
      shareLinkId = link?.id;
    }
    if (!shareLinkId) {
      const link = await prisma.shareLink.findFirst({
        where: { dnaRecordId: rec.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      shareLinkId = link?.id;
    }

    return this._assemble(rec, shareLinkId, opts);
  }

  private async _fromUnresolvedScreenshot(opts: {
    detectionMethod: LeakDetectionMethod;
    leakVector: LeakVector;
    valid: boolean;
    tampered: boolean;
    confidence: number;
    message: string;
    signatureMethod?: string;
    signals?: string[];
    ocrText: string;
  }): Promise<LeakedFileVerifyResult> {
    return {
      found: true,
      valid: opts.valid,
      tampered: opts.tampered,
      detectionMethod: opts.detectionMethod,
      leakVector: opts.leakVector,
      confidence: opts.confidence,
      message: opts.message,
      forensic: {
        signals: opts.signals,
        signatureMethod: opts.signatureMethod,
      },
    };
  }

  private async _fromShareToken(
    shareToken: string | undefined,
    opts: {
      detectionMethod: LeakDetectionMethod;
      leakVector: LeakVector;
      valid: boolean;
      tampered: boolean;
      confidence: number;
      message: string;
      shareToken?: string;
      signatureMethod?: string;
      signals?: string[];
      watermarkCode?: string;
    },
  ): Promise<LeakedFileVerifyResult> {
    if (!shareToken) {
      return {
        found: true,
        valid: opts.valid,
        tampered: opts.tampered,
        detectionMethod: opts.detectionMethod,
        leakVector: opts.leakVector,
        confidence: opts.confidence,
        message: opts.message,
        forensic: {
          signals: opts.signals,
          shareToken: opts.shareToken,
          signatureMethod: opts.signatureMethod,
        },
      };
    }

    const link = await prisma.shareLink.findUnique({
      where: { token: shareToken },
      select: { id: true, dnaRecordId: true },
    });
    if (!link?.dnaRecordId) {
      return {
        found: true,
        valid: opts.valid,
        tampered: opts.tampered,
        detectionMethod: opts.detectionMethod,
        leakVector: opts.leakVector,
        confidence: Math.min(opts.confidence, 70),
        message: 'PINIT share-viewer UI detected but the share token could not be matched to a live link. Ensure the footer token or watermark is visible in the image.',
        forensic: {
          signals: opts.signals,
          signatureMethod: opts.signatureMethod,
        },
      };
    }

    const rec = await prisma.dnaRecord.findUnique({
      where: { id: link.dnaRecordId },
      select: recordSelect,
    });
    if (!rec) {
      return { found: false, message: 'Share link found but linked DNA record is missing.' };
    }

    return this._assemble(rec, link.id, { ...opts, shareToken });
  }

  private async _buildFromIds(params: {
    dnaRecordId?: string;
    vaultId?: string;
    shareLinkId?: string;
    detectionMethod: LeakDetectionMethod;
    leakVector: LeakVector;
    valid: boolean;
    tampered: boolean;
    confidence: number;
    message: string;
  }): Promise<LeakedFileVerifyResult> {
    let rec = params.dnaRecordId
      ? await prisma.dnaRecord.findUnique({ where: { id: params.dnaRecordId }, select: recordSelect })
      : null;

    if (!rec && params.vaultId) {
      const vault = await prisma.vaultRecord.findUnique({
        where: { id: params.vaultId },
        select: { dnaRecordId: true },
      });
      if (vault) {
        rec = await prisma.dnaRecord.findUnique({
          where: { id: vault.dnaRecordId },
          select: recordSelect,
        });
      }
    }

    if (!rec) {
      return { found: false, message: 'Tracking markers found but linked DNA record could not be resolved.' };
    }

    return this._assemble(rec, params.shareLinkId, params);
  }

  private async _assemble(
    rec: {
      id: string;
      imageFilename: string;
      vaultRecord: { id: string } | null;
      ownerUserId: string | null;
      createdAt: Date;
      ownerUser: { email: string | null; fullName: string | null; shortId: string } | null;
    },
    shareLinkId: string | undefined,
    opts: {
      detectionMethod: LeakDetectionMethod;
      leakVector: LeakVector;
      valid: boolean;
      tampered: boolean;
      confidence: number;
      message: string;
      shareToken?: string;
      signatureMethod?: string;
      signals?: string[];
      pHashSimilarity?: number;
    },
  ): Promise<LeakedFileVerifyResult> {
    const { shareLink, accessHistory, recipient } = await this._loadShareContext(shareLinkId, opts.shareToken);

    return {
      found: true,
      valid: opts.valid,
      tampered: opts.tampered,
      detectionMethod: opts.detectionMethod,
      leakVector: opts.leakVector,
      confidence: opts.confidence,
      message: opts.message,
      identity: {
        dnaId: rec.id,
        vaultId: rec.vaultRecord?.id,
        ownerUserId: rec.ownerUserId ?? undefined,
        ownerEmail: rec.ownerUser?.email ?? undefined,
        ownerName: rec.ownerUser?.fullName ?? undefined,
        ownerShortId: rec.ownerUser?.shortId,
        originalFilename: rec.imageFilename,
        dnaCreatedAt: rec.createdAt.toISOString(),
      },
      shareLink,
      recipient,
      accessHistory,
      forensic: {
        signals: opts.signals,
        shareToken: opts.shareToken ?? shareLink?.token,
        signatureMethod: opts.signatureMethod,
        pHashSimilarity: opts.pHashSimilarity,
      },
    };
  }

  private async _loadShareContext(
    shareLinkId?: string,
    shareToken?: string,
  ): Promise<{
    shareLink?: LeakedFileVerifyResult['shareLink'];
    accessHistory?: LeakedFileAccessEntry[];
    recipient?: LeakedFileVerifyResult['recipient'];
  }> {
    const link = shareLinkId
      ? await prisma.shareLink.findUnique({
          where: { id: shareLinkId },
          include: {
            accessLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
            shareRecipient: {
              select: {
                label: true,
                recipientCode: true,
                firstAccessAt: true,
                lastAccessAt: true,
                knownCountries: true,
              },
            },
          },
        })
      : shareToken
        ? await prisma.shareLink.findUnique({
            where: { token: shareToken },
            include: {
              accessLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
              shareRecipient: {
                select: {
                  label: true,
                  recipientCode: true,
                  firstAccessAt: true,
                  lastAccessAt: true,
                  knownCountries: true,
                },
              },
            },
          })
        : null;

    if (!link) return {};

    const accessHistory: LeakedFileAccessEntry[] = link.accessLogs.map((log) => ({
      timestamp: log.createdAt.toISOString(),
      action: log.action,
      ipAddress: log.ipAddress ?? undefined,
      country: log.country ?? undefined,
      city: log.city ?? log.gpsCity ?? undefined,
      region: log.region ?? undefined,
      device: log.device ?? undefined,
      browser: log.browser ?? undefined,
      os: log.os ?? undefined,
      riskLevel: log.riskLevel ?? undefined,
      locationShared: log.locationShared,
      gpsLat: log.gpsLat ?? log.lat ?? undefined,
      gpsLng: log.gpsLng ?? log.lng ?? undefined,
    }));

    return {
      shareLink: {
        id: link.id,
        token: link.token,
        shareUrl: `/s/${link.token}`,
        filename: link.filename ?? undefined,
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt?.toISOString(),
        linkType: link.linkType,
        recipientLabel: link.recipientLabel ?? link.shareRecipient?.label ?? undefined,
        recipientEmail: link.recipientEmail ?? undefined,
      },
      recipient: link.shareRecipient
        ? {
            label: link.shareRecipient.label,
            recipientCode: link.shareRecipient.recipientCode,
            email: link.recipientEmail ?? undefined,
            firstAccessAt: link.shareRecipient.firstAccessAt?.toISOString(),
            lastAccessAt: link.shareRecipient.lastAccessAt?.toISOString(),
            knownCountries: link.shareRecipient.knownCountries,
          }
        : link.recipientLabel
          ? { label: link.recipientLabel, email: link.recipientEmail ?? undefined }
          : undefined,
      accessHistory,
    };
  }

  private async _checkPHashMatch(buffer: Buffer): Promise<LeakedFileVerifyResult | null> {
    const probe = await this.perceptualLayer.computeFingerprints(buffer);
    const stored = await prisma.perceptualLayer.findMany({
      select: { pHash64: true, aHash64: true, dHash64: true, dnaRecordId: true },
      take: 5000,
    });

    let best: { similarity: number; recordId: string } | null = null;
    for (const s of stored) {
      if (!s.pHash64) continue;
      const sim = this.perceptualLayer.verify(probe, {
        pHash64: s.pHash64,
        aHash64: s.aHash64 ?? '',
        dHash64: s.dHash64 ?? '',
      });
      if (sim >= PHASH_LEAK_THRESHOLD && (!best || sim > best.similarity)) {
        best = { similarity: sim, recordId: s.dnaRecordId };
      }
    }
    if (!best) return null;

    return this._fromDnaRecord(best.recordId, {
      detectionMethod: 'NEAR_DUPLICATE_PHASH',
      leakVector: 'RECORDING',
      valid: true,
      tampered: true,
      confidence: Math.round(best.similarity * 100),
      message: `Visual fingerprint match (${(best.similarity * 100).toFixed(1)}% similar) — tampered copy, screenshot, or re-encoded leak of a protected file.`,
      pHashSimilarity: best.similarity,
    });
  }

  private async _checkExactHash(buffer: Buffer): Promise<LeakedFileVerifyResult | null> {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    let rec = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: sha256, status: { in: ['COMPLETE', 'PARTIAL', 'PROCESSING'] } },
      select: recordSelect,
    });

    if (!rec) {
      const cryptoMatch = await prisma.cryptoLayer.findFirst({
        where: { sha256Hash: sha256 },
        include: { dnaRecord: { select: recordSelect } },
      });
      rec = cryptoMatch?.dnaRecord ?? null;
    }

    if (!rec) return null;

    return this._fromDnaRecord(rec.id, {
      detectionMethod: 'EXACT_HASH',
      leakVector: 'DOWNLOAD_REUPLOAD',
      valid: true,
      tampered: false,
      confidence: 99,
      message: 'Exact byte-for-byte match with a protected PINIT-DNA file — untouched download or original upload.',
    });
  }

  private async _checkNormalizedHash(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<LeakedFileVerifyResult | null> {
    if (!mimeType.startsWith('image/')) return null;

    const probe = await this.cryptoLayer.generate({
      buffer,
      mimeType,
      originalName: fileName,
      filePath: '',
      sizeBytes: buffer.length,
    });
    if (!probe.success || !probe.data.normalizedHash) return null;

    const cryptoMatch = await prisma.cryptoLayer.findFirst({
      where: { normalizedHash: probe.data.normalizedHash },
      include: { dnaRecord: { select: recordSelect } },
    });
    if (!cryptoMatch?.dnaRecord) return null;

    const uploadSha = crypto.createHash('sha256').update(buffer).digest('hex');
    const bytesIdentical = cryptoMatch.sha256Hash === uploadSha;

    return this._fromDnaRecord(cryptoMatch.dnaRecord.id, {
      detectionMethod: 'NORMALIZED_HASH',
      leakVector: bytesIdentical ? 'DOWNLOAD_REUPLOAD' : 'COPY_PASTE',
      valid: bytesIdentical,
      tampered: !bytesIdentical,
      confidence: bytesIdentical ? 98 : 91,
      message: bytesIdentical
        ? 'Same pixel content and bytes as protected file.'
        : 'Same pixel content as protected file but bytes differ — re-saved, metadata edited, compressed, or tampered.',
    });
  }
}

export const leakedFileVerifyService = new LeakedFileVerifyService();
