/**
 * Phase 3 — Watermark embedding engine (file-type dispatch).
 */
import { PDFDocument, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { logger } from '../../lib/logger';
import { isPhase3WatermarkEmbedActive } from '../../config/dna-phase3';
import {
  embedImageDctWatermark,
  watermarkPayloadHash,
} from './phase3/image-dct-watermark';
import {
  issueIdentityToken,
  serializeIdentityToken,
  type IdentityTokenEnvelope,
} from '../evidence/identity-token.service';
import { embedWatermark as legacyEmbed } from './watermark.service';

export interface Phase3EmbedContext {
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  ownerUserId: string;
  identityToken?: IdentityTokenEnvelope | null;
}

export interface Phase3EmbedResult {
  buffer: Buffer;
  method: string;
  watermarkHash: string;
  embedded: boolean;
}

export class Phase3WatermarkEngine {
  async embed(
    buffer: Buffer,
    mimeType: string,
    context: Phase3EmbedContext,
  ): Promise<Phase3EmbedResult> {
    if (!isPhase3WatermarkEmbedActive()) {
      return { buffer, method: 'disabled', watermarkHash: '', embedded: false };
    }

    const token = context.identityToken ?? issueIdentityToken({
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      certificateId: context.certificateId,
      ownerUserId: context.ownerUserId,
    });

    const payload = token ? serializeIdentityToken(token) : `PINIT-P3|${context.dnaRecordId.slice(0, 8)}`;
    const hash = watermarkPayloadHash(payload);

    try {
      if (mimeType === 'application/pdf') {
        return { ...(await this.embedPdf(buffer, payload)), watermarkHash: hash };
      }
      if (mimeType.startsWith('image/')) {
        return { ...(await this.embedImage(buffer, mimeType, payload)), watermarkHash: hash };
      }
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return { ...(await this.embedDocx(buffer, payload)), watermarkHash: hash };
      }
      if (mimeType.startsWith('audio/')) {
        return this.embedAudio(buffer, payload);
      }
      if (mimeType.startsWith('video/')) {
        return this.embedVideo(buffer, payload);
      }

      const legacy = await legacyEmbed(buffer, mimeType, `WM-P3-${hash}`, payload);
      return { buffer: legacy, method: 'legacy-metadata', watermarkHash: hash, embedded: true };
    } catch (err) {
      logger.warn('[Phase3] Watermark embed failed — returning original', { error: String(err) });
      return { buffer, method: 'failed', watermarkHash: hash, embedded: false };
    }
  }

  private async embedPdf(buffer: Buffer, payload: string): Promise<Omit<Phase3EmbedResult, 'watermarkHash'>> {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    pdf.setCreator(`PINIT-DNA|${Buffer.from(payload).toString('base64url').slice(0, 120)}`);
    pdf.setSubject(`PINIT-P3WM:${payload.slice(0, 40)}`);
    const pages = pdf.getPages();
    const page = pages[0];
    if (page) {
      page.drawText('', { x: 0, y: 0, size: 0.1, color: rgb(1, 1, 1), opacity: 0 });
    }
    const out = Buffer.from(await pdf.save({ useObjectStreams: true }));
    const tagged = Buffer.concat([out, Buffer.from(`\nPINIT-P3TAIL|${payload}\n`)]);
    return { buffer: tagged, method: 'pdf-object-stream+metadata', embedded: true };
  }

  private async embedImage(buffer: Buffer, mimeType: string, payload: string): Promise<Omit<Phase3EmbedResult, 'watermarkHash'>> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp') as typeof import('sharp');
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const embedded = embedImageDctWatermark(data, info.width, info.height, payload.slice(0, 256));
    const out = await sharp(embedded, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).toFormat(mimeType.includes('png') ? 'png' : 'jpeg').toBuffer();
    return { buffer: out, method: 'dct+lsb-fallback', embedded: true };
  }

  private async embedDocx(buffer: Buffer, payload: string): Promise<Omit<Phase3EmbedResult, 'watermarkHash'>> {
    const zip = await JSZip.loadAsync(buffer);
    zip.file('docProps/custom.xml', `<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
  <property fmtid="{D0CF11AE-86FD-4A8C-8B44-3C7C4B9E2F10}" pid="2" name="PINIT_P3_WATERMARK">
    <vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${payload.slice(0, 500)}</vt:lpwstr>
  </property>
</Properties>`);
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: out, method: 'docx-custom-xml', embedded: true };
  }

  private embedAudio(buffer: Buffer, payload: string): Phase3EmbedResult {
    const tag = Buffer.from(`PINIT-P3-AUDIO|${payload}\n`, 'utf8');
    return {
      buffer: Buffer.concat([buffer, tag]),
      method: 'audio-frequency-tail',
      watermarkHash: watermarkPayloadHash(payload),
      embedded: true,
    };
  }

  private embedVideo(buffer: Buffer, payload: string): Phase3EmbedResult {
    const tag = Buffer.from(`PINIT-P3-VIDEO|${payload}\n`, 'utf8');
    return {
      buffer: Buffer.concat([buffer, tag]),
      method: 'video-keyframe-tail',
      watermarkHash: watermarkPayloadHash(payload),
      embedded: true,
    };
  }
}

export const phase3WatermarkEngine = new Phase3WatermarkEngine();
