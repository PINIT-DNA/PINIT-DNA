/**
 * PINIT-DNA — Tracked Export Package (TEP) v3.0
 *
 * Per-recipient tracked downloads from share links / vault exports.
 * Multi-layer attribution survives rename, re-encode, and re-upload.
 *
 * Flow:
 *   1. Recipient downloads via share link
 *   2. TEP embeds: watermark + metadata + binary manifest tail
 *   3. Manifest registered in DB (Lineage / provenance registry)
 *   4. Re-upload to DNA generation → extract TEP → block duplicate
 */

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { auditService } from '../audit/audit.service';
import {
  createWatermarkProfile,
  embedWatermark,
  extractWatermarkFromFile,
} from '../watermark/watermark.service';

const TEP_SECRET = process.env['TEP_SIGNING_SECRET']
  ?? process.env['LSB_SIGNATURE_SECRET']
  ?? 'pinit-tep-default-secret';

export const TEP_MARKER_PREFIX = 'TEP:v1:';
const TEP_TAIL_START = '\x00TEP-MANIFEST:';
const TEP_TAIL_END   = ':END-TEP-MANIFEST\x00';

const TEP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTepCode(): string {
  const seg = () => Array.from({ length: 4 }, () => TEP_CHARS[Math.floor(Math.random() * TEP_CHARS.length)]).join('');
  return `TEP-${seg()}-${seg()}`;
}

function buildTepSignature(params: {
  tepCode: string;
  dnaRecordId: string;
  vaultId: string;
  shareLinkId: string;
  recipientId: string;
  sessionToken: string;
  timestamp: number;
}): string {
  const data = [
    params.tepCode,
    params.dnaRecordId,
    params.vaultId,
    params.shareLinkId,
    params.recipientId,
    params.sessionToken,
    String(params.timestamp),
  ].join(':');
  const hmac = crypto.createHmac('sha256', TEP_SECRET).update(data).digest('hex');
  return `${TEP_MARKER_PREFIX}${data}:${hmac}`;
}

function verifyTepSignature(sig: string): {
  valid: boolean;
  tepCode?: string;
  dnaRecordId?: string;
  vaultId?: string;
  shareLinkId?: string;
  recipientId?: string;
  sessionToken?: string;
} {
  if (!sig.startsWith(TEP_MARKER_PREFIX)) return { valid: false };
  const inner = sig.slice(TEP_MARKER_PREFIX.length);
  const parts = inner.split(':');
  if (parts.length < 8) return { valid: false };

  const [tepCode, dnaRecordId, vaultId, shareLinkId, recipientId, sessionToken, _ts, ...hmacParts] = parts;
  const hmacHex = hmacParts.join(':');
  const data = [tepCode, dnaRecordId, vaultId, shareLinkId, recipientId, sessionToken, _ts].join(':');
  const expected = crypto.createHmac('sha256', TEP_SECRET).update(data).digest('hex');

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(hmacHex, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    valid = false;
  }

  return {
    valid,
    tepCode,
    dnaRecordId,
    vaultId,
    shareLinkId,
    recipientId,
    sessionToken,
  };
}

/** Append TEP manifest tail — survives share watermark re-encode when tail is preserved. */
export function appendTepTail(buffer: Buffer, signature: string): Buffer {
  const marker = Buffer.from(TEP_TAIL_START, 'latin1');
  const sigBuf = Buffer.from(signature, 'utf8');
  const end    = Buffer.from(TEP_TAIL_END, 'latin1');
  return Buffer.concat([buffer, marker, sigBuf, end]);
}

/** Extract TEP signature from binary tail. */
export function extractTepTail(buffer: Buffer): string | null {
  const latin = buffer.toString('latin1');
  const start = latin.lastIndexOf(TEP_TAIL_START);
  if (start === -1) return null;
  const sigStart = start + TEP_TAIL_START.length;
  const end = latin.indexOf(TEP_TAIL_END, sigStart);
  if (end === -1) return null;
  return latin.slice(sigStart, end);
}

export interface CreateTepInput {
  fileBuffer: Buffer;
  mimeType: string;
  filename: string;
  dnaRecordId: string;
  vaultId: string;
  shareLinkId: string;
  recipientId?: string;
  sessionToken?: string;
  recipientEmail?: string;
  ipAddress?: string;
  geoCountry?: string;
  geoCity?: string;
  deviceContext?: string;
  ownerUserId?: string;
  expiresInHours?: number;
}

export interface CreateTepResult {
  buffer: Buffer;
  tepCode: string;
  watermarkCode: string;
  exportSha256: string;
  manifestId: string;
}

export interface TepExtractionResult {
  found: boolean;
  valid: boolean;
  tepCode?: string;
  dnaRecordId?: string;
  vaultId?: string;
  shareLinkId?: string;
  recipientId?: string;
  watermarkCode?: string;
  method?: string;
}

export class TepService {

  /**
   * Generate a Tracked Export Package — embed multi-layer markers + register manifest.
   */
  async createTrackedExport(input: CreateTepInput): Promise<CreateTepResult> {
    const sourceSha256 = crypto.createHash('sha256').update(input.fileBuffer).digest('hex');
    const timestamp = Date.now();
    const sessionToken = input.sessionToken ?? crypto.randomBytes(16).toString('hex');
    const recipientId = input.recipientId ?? 'anonymous';

    let tepCode = generateTepCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.trackedExportPackage.findUnique({ where: { tepCode } });
      if (!exists) break;
      tepCode = generateTepCode();
    }

    const signature = buildTepSignature({
      tepCode,
      dnaRecordId: input.dnaRecordId,
      vaultId: input.vaultId,
      shareLinkId: input.shareLinkId,
      recipientId,
      sessionToken,
      timestamp,
    });

    const watermarkHash = crypto.createHash('sha256').update(signature).digest('hex');

    // Layer (a)+(c): existing invisible watermark + metadata
    const { watermarkCode, payload, profileId } = await createWatermarkProfile({
      dnaRecordId: input.dnaRecordId,
      shareLinkId: input.shareLinkId,
      recipientId: input.recipientId,
    });

    let buffer = await embedWatermark(
      input.fileBuffer,
      input.mimeType,
      watermarkCode,
      JSON.stringify({
        ...JSON.parse(payload),
        tepCode,
        tepVersion: '3.0',
        sessionToken,
        geo: input.geoCountry,
        device: input.deviceContext,
      }),
    );

    // Layer (d): structural — TEP manifest binary tail
    buffer = appendTepTail(buffer, signature);

    const exportSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const expiresAt = input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 3_600_000)
      : new Date(Date.now() + 90 * 24 * 3_600_000); // 90 days default

    const manifest = await prisma.trackedExportPackage.create({
      data: {
        tepCode,
        dnaRecordId: input.dnaRecordId,
        vaultId: input.vaultId,
        shareLinkId: input.shareLinkId,
        recipientId: input.recipientId ?? null,
        watermarkCode,
        watermarkProfileId: profileId,
        sessionToken,
        recipientEmail: input.recipientEmail ?? null,
        sourceSha256,
        exportSha256,
        watermarkHash,
        embeddedLayers: {
          visible: false,
          steganographic: true,
          metadata: true,
          structuralTail: true,
          watermarkCode,
        },
        geoCountry: input.geoCountry ?? null,
        geoCity: input.geoCity ?? null,
        deviceContext: input.deviceContext ?? null,
        ipAddress: input.ipAddress ?? null,
        ownerUserId: input.ownerUserId ?? null,
        expiresAt,
        status: 'ACTIVE',
      },
    });

    await auditService.log({
      eventType: 'TEP_GENERATED' as never,
      dnaRecordId: input.dnaRecordId,
      vaultId: input.vaultId,
      filename: input.filename,
      fileType: input.mimeType,
      detail: {
        tepCode,
        watermarkCode,
        shareLinkId: input.shareLinkId,
        recipientId: input.recipientId,
        exportSha256,
        geoCountry: input.geoCountry,
        ipAddress: input.ipAddress,
      },
    });

    logger.info('[TEP] Tracked export package created', {
      tepCode,
      dnaRecordId: input.dnaRecordId,
      watermarkCode,
      exportSha256: exportSha256.slice(0, 16),
    });

    return {
      buffer,
      tepCode,
      watermarkCode,
      exportSha256,
      manifestId: manifest.id,
    };
  }

  /**
   * Extract TEP markers from a file buffer (share download / leak re-upload).
   */
  async extractFromFile(buffer: Buffer, mimeType: string, _filename: string): Promise<TepExtractionResult> {
    // 1. Binary TEP tail (most reliable)
    const tailSig = extractTepTail(buffer);
    if (tailSig?.startsWith(TEP_MARKER_PREFIX)) {
      const verified = verifyTepSignature(tailSig);
      if (verified.tepCode) {
        return {
          found: true,
          valid: verified.valid,
          tepCode: verified.tepCode,
          dnaRecordId: verified.dnaRecordId,
          vaultId: verified.vaultId,
          shareLinkId: verified.shareLinkId,
          recipientId: verified.recipientId,
          method: 'tep-tail',
        };
      }
    }

    // 2. Watermark profile (share-link layer)
    try {
      const wm = await extractWatermarkFromFile(buffer, mimeType);
      if (wm.watermarkCode) {
        const manifest = await prisma.trackedExportPackage.findFirst({
          where: { watermarkCode: wm.watermarkCode },
          orderBy: { createdAt: 'desc' },
        });
        if (manifest) {
          return {
            found: true,
            valid: true,
            tepCode: manifest.tepCode,
            dnaRecordId: manifest.dnaRecordId,
            vaultId: manifest.vaultId,
            shareLinkId: manifest.shareLinkId,
            recipientId: manifest.recipientId ?? undefined,
            watermarkCode: wm.watermarkCode,
            method: wm.method,
          };
        }

        const profile = await prisma.watermarkProfile.findUnique({
          where: { watermarkCode: wm.watermarkCode },
        });
        if (profile) {
          return {
            found: true,
            valid: true,
            dnaRecordId: profile.dnaRecordId,
            shareLinkId: profile.shareLinkId,
            recipientId: profile.recipientId ?? undefined,
            watermarkCode: wm.watermarkCode,
            method: wm.method,
          };
        }
      }
    } catch (err) {
      logger.debug('[TEP] Watermark extraction failed', { error: String(err) });
    }

    // 3. Exact export byte hash match
    const exportSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const byHash = await prisma.trackedExportPackage.findFirst({
      where: { exportSha256, status: 'ACTIVE' },
    });
    if (byHash) {
      return {
        found: true,
        valid: true,
        tepCode: byHash.tepCode,
        dnaRecordId: byHash.dnaRecordId,
        vaultId: byHash.vaultId,
        shareLinkId: byHash.shareLinkId,
        recipientId: byHash.recipientId ?? undefined,
        watermarkCode: byHash.watermarkCode ?? undefined,
        method: 'export-sha256',
      };
    }

    return { found: false, valid: false };
  }

  /** Lookup manifest and mark rediscovered when file is re-uploaded to DNA. */
  async markRediscovered(tepCode: string): Promise<void> {
    await prisma.trackedExportPackage.updateMany({
      where: { tepCode, status: 'ACTIVE' },
      data: { status: 'REDISCOVERED', rediscoveredAt: new Date() },
    });
  }

  async listByDnaRecord(dnaRecordId: string, ownerUserId?: string) {
    return prisma.trackedExportPackage.findMany({
      where: {
        dnaRecordId,
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getByTepCode(tepCode: string) {
    return prisma.trackedExportPackage.findUnique({ where: { tepCode } });
  }
}

export const tepService = new TepService();
