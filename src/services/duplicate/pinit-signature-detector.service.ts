/**
 * PINIT-DNA — Visible & metadata signature detector
 *
 * Catches share-viewer screenshots and re-captures that lose embedded TEP/LSB tails
 * but still show PINIT vault watermarks ("PINIT-DNA · token", Smart Links footer, etc.).
 */
import sharp from 'sharp';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { extractWatermarkFromFile } from '../watermark/watermark.service';
import { resolveShareTokenFromText } from '../share/share-token-resolver';

const WATERMARK_CODE_RE = /WM-[A-Z0-9]{4,}-[A-Z0-9]{4,}/gi;

/** OCR-only markers — never match raw PNG/JPEG bytes (too many false positives). */
const VISIBLE_MARKERS: RegExp[] = [
  /PINIT\s*[-·\s]*DNA/i,
  /Protected\s+by\s+PINIT/i,
  /PINIT-DNA\s+Smart\s+Links/i,
  /PINIT\s+Vault/i,
  /Secure\s+Viewer/i,
  /Access\s+is\s+tracked\s+and\s+logged/i,
  /File\s+Tracking\s+Map/i,
  /Unique\s+Viewers/i,
  /Token:\s*[A-Za-z0-9_-]{8,}/i,
  /PINIT-WM:/i,
  /TEP-MANIFEST:/i,
  /PINIT-DNA-SIG:/i,
  /PINIT-DNA:v1:/i,
];

export interface PinitSignatureHit {
  detected: boolean;
  method: string;
  signals: string[];
  shareToken?: string;
  watermarkCode?: string;
  dnaRecordId?: string;
  ownerUserId?: string;
  ownerShortId?: string;
  ocrFullText?: string;
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

    // ── 2. OCR on images (screenshots of share viewer) ───────────────────────
    let ocrFullText = '';
    if (mimeType.startsWith('image/')) {
      const ocrHits = await this._detectViaOcr(buffer, mimeType);
      ocrFullText = ocrHits.fullText;
      for (const hit of ocrHits.signals) signals.push(hit);
      if (ocrHits.watermarkCode && !watermarkCode) watermarkCode = ocrHits.watermarkCode;
      if (ocrHits.signals.length && method === 'none') method = 'ocr_visible';
    }

    // ── 3. Parse tokens / codes from OCR + metadata text only ────────────────
    const combinedText = [signals.join('\n'), ocrFullText].join('\n');
    shareToken = await resolveShareTokenFromText(combinedText);
    if (!watermarkCode) {
      const wmMatch = combinedText.match(WATERMARK_CODE_RE);
      if (wmMatch?.[0]) watermarkCode = wmMatch[0].toUpperCase();
    }

    const resolved = await this._resolveToDnaRecord(shareToken, watermarkCode);

    // Block only when tied to a known vault record OR OCR clearly shows PINIT share-viewer UI.
    const ocrConfident = this._isHighConfidenceOcr(ocrFullText);
    const detected = Boolean(resolved.dnaRecordId) || ocrConfident;

    if (!detected) {
      return {
        detected: false,
        method: 'none',
        signals: [],
        ocrFullText: ocrFullText || undefined,
        shareToken: shareToken ?? undefined,
        watermarkCode,
        dnaRecordId: resolved.dnaRecordId,
        ownerUserId: resolved.ownerUserId,
        ownerShortId: resolved.ownerShortId,
      };
    }

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
      shareToken: shareToken ?? undefined,
      watermarkCode,
      dnaRecordId: resolved.dnaRecordId,
      ownerUserId: resolved.ownerUserId,
      ownerShortId: resolved.ownerShortId,
      ocrFullText: ocrFullText || undefined,
    };
  }

  /**
   * Require unmistakable PINIT vault UI text — not generic words like "Smart Links" alone.
   * A single "PINIT-DNA" line, or Protected-by-PINIT + Secure Viewer together.
   */
  private _isHighConfidenceOcr(text: string): boolean {
    if (!text.trim()) return false;

    const hasPinitDna = /PINIT\s*[-·\s]*DNA/i.test(text);
    const hasProtected = /Protected\s+by\s+PINIT/i.test(text);
    const hasSecureViewer = /Secure\s+Viewer/i.test(text);
    const hasTracked = /Access\s+is\s+tracked\s+and\s+logged/i.test(text);
    const hasPinitVault = /PINIT\s+Vault/i.test(text);
    const hasSmartLinksFooter = /PINIT-DNA\s+Smart\s+Links/i.test(text);

    if (hasPinitDna && (hasProtected || hasSecureViewer || hasTracked || hasSmartLinksFooter)) {
      return true;
    }
    if (hasProtected && hasSecureViewer) return true;
    if (hasPinitVault && hasTracked) return true;
    // Share-viewer page title / header: "PINIT-DNA Secure Viewer"
    if (hasPinitDna && hasSecureViewer) return true;
    if (/PINIT/i.test(text) && hasProtected && hasTracked) return true;
    // Link Intelligence dashboard (/link/{token}) — filename bar + tracking map
    const hasTrackingMap = /File\s+Tracking\s+Map|Tracing\s+Map/i.test(text);
    const hasTokenLine = /Token:\s*[A-Za-z0-9_-]{8,}/i.test(text);
    if (hasTrackingMap && (hasTokenLine || hasPinitDna)) return true;
    if (hasPinitDna && /Unique\s+Viewers|Total\s+Views/i.test(text)) return true;
    return false;
  }

  /** Run OCR passes and return combined text — for leaked-file forensics. */
  async extractOcrText(buffer: Buffer, mimeType: string): Promise<string> {
    if (!mimeType.startsWith('image/')) return '';
    const ocrHits = await this._detectViaOcr(buffer, mimeType);
    return ocrHits.fullText;
  }

  private async _detectViaOcr(
    buffer: Buffer,
    _mimeType: string,
  ): Promise<{ signals: string[]; watermarkCode?: string; fullText: string }> {
    const signals: string[] = [];
    let watermarkCode: string | undefined;
    let fullText = '';

    const variants = await this._ocrVariants(buffer);
    let worker: import('tesseract.js').Worker | undefined;

    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('eng', 1, { logger: () => {} });

      for (const variant of variants) {
        const { data } = await worker.recognize(variant.buffer);
        const text = data.text?.trim();
        if (!text) continue;

        fullText += `\n${text}`;

        for (const re of VISIBLE_MARKERS) {
          if (re.test(text)) signals.push(`ocr:${re.source.slice(0, 40)}`);
        }

        const wm = text.match(WATERMARK_CODE_RE);
        if (wm?.[0] && !watermarkCode) watermarkCode = wm[0].toUpperCase();
      }
    } catch (err) {
      logger.warn('[PinitSignature] OCR failed', { error: String(err) });
    } finally {
      if (worker) await worker.terminate();
    }

    return { signals, watermarkCode, fullText };
  }

  /** Preprocess image regions to surface faint diagonal share-viewer watermarks. */
  private async _ocrVariants(buffer: Buffer): Promise<Array<{ label: string; buffer: Buffer }>> {
    const out: Array<{ label: string; buffer: Buffer }> = [];
    try {
      const base = sharp(buffer);
      const meta = await base.metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;

      out.push({ label: 'full', buffer: await base.clone().withMetadata({ density: 72 }).png().toBuffer() });

      out.push({
        label: 'contrast',
        buffer: await sharp(buffer)
          .resize(w && w < 1600 ? 1600 : undefined, null, { withoutEnlargement: false })
          .normalize()
          .sharpen()
          .greyscale()
          .linear(1.8, -40)
          .withMetadata({ density: 72 })
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
            .withMetadata({ density: 72 })
            .png()
            .toBuffer(),
        });

        // Browser URL bar — localhost/link/{token}
        const urlBarH = Math.max(40, Math.floor(h * 0.15));
        out.push({
          label: 'urlbar',
          buffer: await sharp(buffer)
            .extract({ left: 0, top: 0, width: w, height: urlBarH })
            .resize(w && w < 2000 ? 2000 : undefined, null, { withoutEnlargement: false })
            .normalize()
            .sharpen()
            .greyscale()
            .linear(2.0, -60)
            .withMetadata({ density: 72 })
            .png()
            .toBuffer(),
        });

        // Link Intelligence title band — filename + Token: wKb7... (below browser chrome)
        const titleTop = Math.max(0, Math.floor(h * 0.08));
        const titleH = Math.max(60, Math.floor(h * 0.28));
        out.push({
          label: 'title-band',
          buffer: await sharp(buffer)
            .extract({ left: 0, top: titleTop, width: w, height: Math.min(titleH, h - titleTop) })
            .resize(w && w < 2400 ? 2400 : undefined, null, { withoutEnlargement: false })
            .normalize()
            .sharpen()
            .greyscale()
            .withMetadata({ density: 72 })
            .png()
            .toBuffer(),
        });
      }

      // Diagonal watermark tiles — rotate to horizontal for OCR
      out.push({
        label: 'watermark-rotated',
        buffer: await sharp(buffer)
          .resize(w && w < 1800 ? 1800 : undefined, null, { withoutEnlargement: false })
          .rotate(-30, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .normalize()
          .sharpen()
          .greyscale()
          .linear(2.0, -50)
          .withMetadata({ density: 72 })
          .png()
          .toBuffer(),
      });
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
