/**
 * Read text out of an uploaded ID file.
 * Digital PDFs use the embedded text. Photos use the existing OCR worker.
 * Empty text is a failed document check, not a pass.
 */
import { logger } from '../../lib/logger';
import { OcrService } from '../ocr/ocr.service';
import zlib from 'zlib';

const ocr = new OcrService();

function literalsFromPdfBytes(bytes: Buffer): string {
  const parts: string[] = [];
  const collect = (block: Buffer) => {
    const raw = block.toString('latin1');
    if (!raw.includes('Tj') && !raw.includes('TJ')) return;
    const found = raw.match(/\((?:\\[()\\]|[^)]){2,}\)/g) || [];
    for (const item of found) {
      parts.push(item.slice(1, -1).replace(/\\([()\\])/g, '$1'));
    }
    const hexes = raw.match(/<([0-9A-Fa-f\s]{4,})>/g) || [];
    for (const item of hexes) {
      const hex = item.slice(1, -1).replace(/\s/g, '');
      if (hex.length < 4 || hex.length % 2 !== 0) continue;
      parts.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
  };
  let cursor = 0;
  while (cursor < bytes.length) {
    const start = bytes.indexOf('stream', cursor);
    if (start < 0) break;
    if (start > 0 && bytes[start - 1] === 0x64) {
      cursor = start + 6;
      continue;
    }
    const dataStart = bytes[start + 6] === 0x0d && bytes[start + 7] === 0x0a
      ? start + 8
      : bytes[start + 6] === 0x0a
        ? start + 7
        : start + 6;
    const end = bytes.indexOf('endstream', dataStart);
    if (end < 0) break;
    let slice = bytes.subarray(dataStart, end);
    if (slice[slice.length - 1] === 0x0a) slice = slice.subarray(0, -1);
    if (slice[slice.length - 1] === 0x0d) slice = slice.subarray(0, -1);
    try {
      collect(zlib.inflateSync(slice));
    } catch {
      collect(slice);
    }
    cursor = end + 9;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function extractGovernmentDocumentText(mime: string, bytes: Buffer): Promise<string> {
  try {
    if (mime === 'application/pdf') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse: (buf: Buffer) => Promise<{ text?: string }> = require('pdf-parse');
        const data = await pdfParse(bytes);
        const parsed = (data.text || '').replace(/\s+/g, ' ').trim();
        if (parsed) return parsed;
      } catch (err) {
        logger.warn('[GovernmentId] pdf text parser failed', { error: err instanceof Error ? err.message : 'unknown' });
      }
      return literalsFromPdfBytes(bytes);
    }
    if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') {
      const result = await ocr.extractText(bytes, mime === 'image/jpg' ? 'image/jpeg' : mime);
      return (result.text || '').replace(/\s+/g, ' ').trim();
    }
  } catch (err) {
    logger.warn('[GovernmentId] text extraction failed', { mime, error: err instanceof Error ? err.message : 'unknown' });
  }
  return '';
}
