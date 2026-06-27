/**
 * PINIT-DNA — Visible & metadata signature detector
 *
 * Catches share-viewer screenshots and re-captures that lose embedded TEP/LSB tails
 * but still show PINIT vault watermarks ("PINIT-DNA · token", Smart Links footer, etc.).
 */
import sharp from 'sharp';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { OcrService } from '../ocr/ocr.service';
import { extractWatermarkFromFile } from '../watermark/watermark.service';

const ocrService = new OcrService();

/** Share link tokens are 10 URL-safe chars (base64url slice). */
const SHARE_TOKEN_RE = /\b([A-Za-z0-9_-]{10})\b/g;
const WATERMARK_CODE_RE = /WM-[A-Z0-9]{4,}-[A-Z0-9]{4,}/gi;

const VISIBLE_MARKERS: RegExp[] = [
  /PINIT\s*[-·\s]*DNA/i,
  /Protected\s+by\s+PINIT/i,
  /PINIT-DNA\s+Smart\s+Links/i,
  /Smart\s+Links/i,
  /PINIT\s+Vault/i,
  /Secure\s+Viewer/i,
  /Access\s+is\s+tracked\s+and\s+logged/i,
  /PINIT-WM:/i,
  /TEP-MANIFEST:/i,
  /PINIT-DNA-SIG:/i,
  /PINIT-DNA:v1:/i,
];

const BINARY_MARKERS = [
  'PINIT-DNA',
  'PINIT-DNA-SIG:',
  'PINIT-DNA:v1:',
  'TEP-MANIFEST:',
  'Smart Links',
  'Protected by PINIT',
  'PINIT-WM:',
  'WM-',
] as const;

export interface PinitSignatureHit {
  detected: boolean;
  method: string;
  signals: string[];
  shareToken?: string;
  watermarkCode?: string;
  dnaRecordId?: string;
  ownerUserId?: string;
  ownerShortId?: string;
}

export class PinitSignatureDetectorService {
  /**
   * Detect PINIT vault / share-link signatures in uploaded bytes.
   * Used before DNA generation to block screenshots and watermarked captures.
   */
  async detect(buffer: Buffer, mimeType: string, _originalName: string): Promise<PinitSignatureHit> {
    const signals: string[] = [];
    let method = 'none';
    let shareToken: string | undefined;
    let watermarkCode: string | undefined;

    // ── 1. Forensic metadata (EXIF / PDF creator / raw scan) ─────────────────
    try {
      const wm = await extractWatermarkFromFile(buffer, mimeType);
      if (wm.watermarkCode) {
        watermarkCode = wm.watermarkCode;
        signals.push(`metadata:${wm.method}:${wm.watermarkCode}`);
        method = wm.method;
      }
    } catch (err) {
      logger.debug('[PinitSignature] Metadata extraction skipped', { error: String(err) });
    }

    // ── 2. Fast binary / latin1 scan ─────────────────────────────────────────
    const latin = buffer.toString('latin1');
    for (const marker of BINARY_MARKERS) {
      if (latin.includes(marker)) {
        signals.push(`binary:${marker}`);
        if (method === 'none') method = 'binary_scan';
      }
    }

    const wmFromBinary = latin.match(WATERMARK_CODE_RE);
    if (wmFromBinary?.[0] && !watermarkCode) {
      watermarkCode = wmFromBinary[0].toUpperCase();
      signals.push(`binary:watermark_code:${watermarkCode}`);
      if (method === 'none') method = 'binary_scan';
    }

    // ── 3. OCR on images (screenshots of share viewer) ───────────────────────
    let ocrFullText = '';
    if (mimeType.startsWith('image/')) {
      const ocrHits = await this._detectViaOcr(buffer, mimeType);
      ocrFullText = ocrHits.fullText;
      for (const hit of ocrHits.signals) signals.push(hit);
      if (ocrHits.shareToken && !shareToken) shareToken = ocrHits.shareToken;
      if (ocrHits.watermarkCode && !watermarkCode) watermarkCode = ocrHits.watermarkCode;
      if (ocrHits.signals.length && method === 'none') method = 'ocr_visible';
    }

    // ── 4. Parse tokens / codes from combined signal text ────────────────────
    const combinedText = [signals.join('\n'), ocrFullText, latin.slice(0, 500_000)].join('\n');
    if (!shareToken) shareToken = await this._resolveShareTokenFromText(combinedText);
    if (!watermarkCode) {
      const wmMatch = combinedText.match(WATERMARK_CODE_RE);
      if (wmMatch?.[0]) watermarkCode = wmMatch[0].toUpperCase();
    }

    const markerHit = VISIBLE_MARKERS.some((re) => re.test(combinedText));
    const detected = signals.length > 0 || markerHit || Boolean(shareToken) || Boolean(watermarkCode);

    if (!detected) {
      return { detected: false, method: 'none', signals: [] };
    }

    const resolved = await this._resolveToDnaRecord(shareToken, watermarkCode);

    logger.info('[PinitSignature] PINIT vault signature detected', {
      method,
      signals: signals.slice(0, 8),
      shareToken,
      watermarkCode,
      dnaRecordId: resolved.dnaRecordId,
    });

    return {
      detected: true,
      method,
      signals,
      shareToken,
      watermarkCode,
      dnaRecordId: resolved.dnaRecordId,
      ownerUserId: resolved.ownerUserId,
      ownerShortId: resolved.ownerShortId,
    };
  }

  private _extractShareToken(text: string): string | undefined {
    const afterPinit = text.match(/PINIT\s*[-·\s]*DNA[\s·\-]*([A-Za-z0-9_-]{8,12})/i);
    if (afterPinit?.[1] && afterPinit[1].length === 10) return afterPinit[1];

    const tokens = [...text.matchAll(SHARE_TOKEN_RE)].map((m) => m[1]!);
    return tokens.find((t) => t.length === 10 && !t.startsWith('WM-'));
  }

  /** Resolve any 10-char URL-safe token found in OCR/binary text against share_links. */
  private async _resolveShareTokenFromText(text: string): Promise<string | undefined> {
    const direct = this._extractShareToken(text);
    if (direct) {
      const link = await prisma.shareLink.findUnique({ where: { token: direct }, select: { token: true } });
      if (link) return direct;
    }

    const candidates = [...new Set([...text.matchAll(SHARE_TOKEN_RE)].map((m) => m[1]!))]
      .filter((t) => t.length === 10 && !t.startsWith('WM-'));

    for (const token of candidates) {
      const link = await prisma.shareLink.findUnique({ where: { token }, select: { token: true } });
      if (link) return token;
    }
    return undefined;
  }

  private async _detectViaOcr(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ signals: string[]; shareToken?: string; watermarkCode?: string; fullText: string }> {
    const signals: string[] = [];
    let shareToken: string | undefined;
    let watermarkCode: string | undefined;
    let fullText = '';

    const variants = await this._ocrVariants(buffer);
    for (const variant of variants) {
      const ocr = await ocrService.extractText(variant.buffer, mimeType);
      if (!ocr.success || !ocr.text) continue;

      const text = ocr.text;
      fullText += `\n${text}`;

      for (const re of VISIBLE_MARKERS) {
        if (re.test(text)) signals.push(`ocr:${re.source.slice(0, 40)}`);
      }

      const wm = text.match(WATERMARK_CODE_RE);
      if (wm?.[0] && !watermarkCode) watermarkCode = wm[0].toUpperCase();

      const token = this._extractShareToken(text);
      if (token && !shareToken) shareToken = token;

      if (signals.length) break;
    }

    if (!shareToken && fullText) {
      shareToken = await this._resolveShareTokenFromText(fullText);
    }

    return { signals, shareToken, watermarkCode, fullText };
  }

  /** Preprocess image regions to surface faint diagonal share-viewer watermarks. */
  private async _ocrVariants(buffer: Buffer): Promise<Array<{ label: string; buffer: Buffer }>> {
    const out: Array<{ label: string; buffer: Buffer }> = [];
    try {
      const base = sharp(buffer);
      const meta = await base.metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;

      out.push({ label: 'full', buffer: await base.clone().png().toBuffer() });

      out.push({
        label: 'contrast',
        buffer: await sharp(buffer)
          .resize(w && w < 1600 ? 1600 : undefined, null, { withoutEnlargement: false })
          .normalize()
          .sharpen()
          .greyscale()
          .linear(1.8, -40)
          .png()
          .toBuffer(),
      });

      if (h > 80) {
        const footerH = Math.max(40, Math.floor(h * 0.12));
        out.push({
          label: 'footer',
          buffer: await sharp(buffer)
            .extract({ left: 0, top: h - footerH, width: w, height: footerH })
            .resize(null, 200, { withoutEnlargement: false })
            .normalize()
            .sharpen()
            .greyscale()
            .png()
            .toBuffer(),
        });
      }
    } catch (err) {
      logger.warn('[PinitSignature] OCR preprocess failed — using raw buffer', { error: String(err) });
      out.push({ label: 'raw', buffer });
    }
    return out;
  }

  private async _resolveToDnaRecord(
    shareToken?: string,
    watermarkCode?: string,
  ): Promise<{ dnaRecordId?: string; ownerUserId?: string; ownerShortId?: string }> {
    if (shareToken) {
      const link = await prisma.shareLink.findUnique({
        where: { token: shareToken },
        select: {
          dnaRecordId: true,
          ownerUserId: true,
          ownerUser: { select: { shortId: true } },
        },
      });
      if (link?.dnaRecordId) {
        return {
          dnaRecordId: link.dnaRecordId,
          ownerUserId: link.ownerUserId ?? undefined,
          ownerShortId: link.ownerUser?.shortId,
        };
      }
    }

    if (watermarkCode) {
      const profile = await prisma.watermarkProfile.findUnique({
        where: { watermarkCode },
        select: { dnaRecordId: true },
      });
      if (profile?.dnaRecordId) {
        const rec = await prisma.dnaRecord.findUnique({
          where: { id: profile.dnaRecordId },
          select: {
            id: true,
            ownerUserId: true,
            ownerUser: { select: { shortId: true } },
          },
        });
        if (rec) {
          return {
            dnaRecordId: rec.id,
            ownerUserId: rec.ownerUserId ?? undefined,
            ownerShortId: rec.ownerUser?.shortId,
          };
        }
      }
    }

    return {};
  }
}

export const pinitSignatureDetector = new PinitSignatureDetectorService();
