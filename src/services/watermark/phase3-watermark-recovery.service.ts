/**
 * Phase 3 — Watermark recovery: extract → verify token → resolve vault → fallback DNA.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { isPhase3WatermarkRecoveryActive } from '../../config/dna-phase3';
import { extractWatermarkFromFile } from './watermark.service';
import {
  parseIdentityToken,
  verifyIdentityToken,
  IDENTITY_TOKEN_PREFIX,
} from '../evidence/identity-token.service';
import { extractImageDctWatermark } from './phase3/image-dct-watermark';

export interface Phase3RecoveryResult {
  recovered: boolean;
  method: string;
  vaultId?: string;
  dnaRecordId?: string;
  certificateId?: string | null;
  ownerUserId?: string;
  tokenValid?: boolean;
  detail: string;
  fallbackToDna: boolean;
}

export class Phase3WatermarkRecoveryService {
  async recover(
    buffer: Buffer,
    mimeType: string,
    ownerUserId?: string,
  ): Promise<Phase3RecoveryResult> {
    if (!isPhase3WatermarkRecoveryActive()) {
      return { recovered: false, method: 'disabled', detail: 'Phase 3 recovery disabled', fallbackToDna: true };
    }
    return this.recoverForensic(buffer, mimeType, ownerUserId);
  }

  /** Always-on forensic watermark/token extraction (vault + share watermarks). */
  async recoverForensic(
    buffer: Buffer,
    mimeType: string,
    ownerUserId?: string,
  ): Promise<Phase3RecoveryResult> {
    const legacy = await extractWatermarkFromFile(buffer, mimeType);
    if (legacy.watermarkCode) {
      const profile = await prisma.watermarkProfile.findUnique({
        where: { watermarkCode: legacy.watermarkCode },
      });
      if (profile) {
        const share = await prisma.shareLink.findUnique({
          where: { id: profile.shareLinkId },
          select: { dnaRecordId: true, ownerUserId: true },
        });
        if (share) {
          return {
            recovered: true,
            method: legacy.method,
            dnaRecordId: share.dnaRecordId,
            ownerUserId: share.ownerUserId ?? undefined,
            detail: 'Share watermark recovered',
            fallbackToDna: false,
          };
        }
      }
    }

    // 2. Phase 3 identity token from file tail / DCT / PDF metadata
    const tokenRaw = await this.extractPhase3Payload(buffer, mimeType);
    if (!tokenRaw) {
      return {
        recovered: false,
        method: 'none',
        detail: 'No Phase 3 watermark payload found',
        fallbackToDna: true,
      };
    }

    if (tokenRaw.includes(IDENTITY_TOKEN_PREFIX)) {
      const token = parseIdentityToken(tokenRaw);
      if (!token) {
        return { recovered: false, method: 'phase3-token', detail: 'Malformed identity token', fallbackToDna: true };
      }
      const v = verifyIdentityToken(token);
      if (!v.valid || !v.inner?.vaultId) {
        return {
          recovered: false,
          method: 'phase3-token',
          tokenValid: false,
          detail: v.detail,
          fallbackToDna: true,
        };
      }

      if (ownerUserId && v.inner.ownerUserId && v.inner.ownerUserId !== ownerUserId) {
        return {
          recovered: false,
          method: 'phase3-token',
          tokenValid: true,
          detail: 'Token belongs to another tenant',
          fallbackToDna: true,
        };
      }

      return {
        recovered: true,
        method: 'phase3-identity-token',
        vaultId: v.inner.vaultId,
        dnaRecordId: v.inner.dnaRecordId,
        certificateId: v.inner.certificateId,
        ownerUserId: v.inner.ownerUserId,
        tokenValid: true,
        detail: 'Identity token verified — vault resolved',
        fallbackToDna: false,
      };
    }

    return {
      recovered: false,
      method: 'phase3-partial',
      detail: 'Watermark fragment found but token verification failed',
      fallbackToDna: true,
    };
  }

  private async extractPhase3Payload(buffer: Buffer, mimeType: string): Promise<string | null> {
    const tail = buffer.slice(Math.max(0, buffer.length - 8192)).toString('utf8');
    const latin = buffer.slice(Math.max(0, buffer.length - 8192)).toString('latin1');
    const tailMatch = tail.match(/PINIT-P3TAIL\|([^\n]+)/)
      ?? tail.match(/PINIT-VAULT-TAIL\|([^\n]+)/)
      ?? tail.match(/PINIT-VAULT-IMG\|([^\n]+)/)
      ?? tail.match(/PINIT-IDT\|([A-Za-z0-9_-]+)/)
      ?? latin.match(/PINIT-DNA-SIG:(PINIT-DNA:v1:[^\x00]+)/);
    if (tailMatch) {
      return tailMatch[0].includes('PINIT-IDT') ? tailMatch[0] : `PINIT-IDT|${tailMatch[1]}`;
    }

    if (mimeType.startsWith('image/')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sharp = require('sharp') as typeof import('sharp');
        const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const extracted = extractImageDctWatermark(data, info.width, info.height);
        if (extracted?.includes('PINIT-IDT')) return extracted;
      } catch (err) {
        logger.warn('[Phase3] Image DCT extract failed', { error: String(err) });
      }
    }

    if (mimeType === 'application/pdf') {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const creator = pdf.getCreator() ?? '';
        if (creator.startsWith('PINIT-DNA|')) {
          const b64 = creator.replace('PINIT-DNA|', '');
          const decoded = Buffer.from(b64, 'base64url').toString('utf8');
          if (decoded.includes('PINIT-IDT')) return decoded;
        }
      } catch { /* fall through */ }
    }

    return null;
  }
}

export const phase3WatermarkRecovery = new Phase3WatermarkRecoveryService();
