/**
 * PINIT-DNA — Document Text Extractor
 *
 * Unified text extraction for all 10 file types.
 * Used by: OCR pipeline, AI indexing, semantic search.
 * Falls back gracefully on any error.
 */

import JSZip  from 'jszip';
import { logger } from '../../lib/logger';

export interface ExtractedText {
  text:        string;
  wordCount:   number;
  pageCount:   number;
  language:    string;
  method:      string;   // how text was extracted
  success:     boolean;
  error?:      string;
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (b: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse');
    const data = await pdfParse(buffer);
    const text = data.text?.trim() ?? '';
    return { text, wordCount: text.split(/\s+/).filter(Boolean).length,
      pageCount: data.numpages, language: 'en', method: 'pdf-parse', success: true };
  } catch (err) {
    return { text: '', wordCount: 0, pageCount: 0, language: 'en',
      method: 'pdf-parse', success: false, error: String(err) };
  }
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<ExtractedText> {
  try {
    const zip  = await JSZip.loadAsync(buffer);
    const file = zip.file('word/document.xml');
    if (!file) return { text: '', wordCount: 0, pageCount: 1, language: 'en',
      method: 'docx-xml', success: false, error: 'No document.xml found' };
    const xml  = await file.async('text');
    const text = xml.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1 ')
                    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return { text, wordCount: text.split(/\s+/).filter(Boolean).length,
      pageCount: 1, language: 'en', method: 'docx-xml', success: true };
  } catch (err) {
    return { text: '', wordCount: 0, pageCount: 1, language: 'en',
      method: 'docx-xml', success: false, error: String(err) };
  }
}

// ─── PPTX ─────────────────────────────────────────────────────────────────────

async function extractPptx(buffer: Buffer): Promise<ExtractedText> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    let text = '';
    for (const sf of slides) {
      const f   = zip.file(sf);
      if (!f) continue;
      const xml = await f.async('text');
      text += xml.replace(/<a:t>([^<]*)<\/a:t>/g, '$1 ').replace(/<[^>]+>/g, '') + '\n';
    }
    text = text.replace(/\s+/g, ' ').trim();
    return { text, wordCount: text.split(/\s+/).filter(Boolean).length,
      pageCount: slides.length, language: 'en', method: 'pptx-xml', success: true };
  } catch (err) {
    return { text: '', wordCount: 0, pageCount: 0, language: 'en',
      method: 'pptx-xml', success: false, error: String(err) };
  }
}

// ─── TXT / CSV / JSON ─────────────────────────────────────────────────────────

function extractPlainText(buffer: Buffer, mimeType: string): ExtractedText {
  try {
    const text = buffer.toString('utf-8').trim();
    let processedText = text;

    if (mimeType === 'application/json') {
      try {
        const obj = JSON.parse(text);
        processedText = JSON.stringify(obj, null, ' ')
          .replace(/[{}[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
      } catch { /* use raw text */ }
    }

    return { text: processedText, wordCount: processedText.split(/\s+/).filter(Boolean).length,
      pageCount: 1, language: 'en', method: 'plaintext', success: true };
  } catch (err) {
    return { text: '', wordCount: 0, pageCount: 1, language: 'en',
      method: 'plaintext', success: false, error: String(err) };
  }
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export async function extractDocumentText(
  buffer:   Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractedText> {
  logger.debug('Extracting text', { mimeType, filename, sizeBytes: buffer.length });

  // PDF
  if (mimeType === 'application/pdf') return extractPdf(buffer);

  // DOCX
  if (mimeType.includes('wordprocessingml')) return extractDocx(buffer);

  // PPTX
  if (mimeType.includes('presentationml')) return extractPptx(buffer);

  // TXT / MD / LOG
  if (mimeType === 'text/plain') return extractPlainText(buffer, mimeType);

  // CSV
  if (mimeType === 'text/csv' || mimeType === 'application/csv')
    return extractPlainText(buffer, mimeType);

  // JSON
  if (mimeType === 'application/json') return extractPlainText(buffer, mimeType);

  // ZIP — try by magic bytes fallback
  const magic = buffer.slice(0, 4).toString('hex');
  if (magic === '504b0304') {
    // Try DOCX/PPTX by filename extension
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'docx') return extractDocx(buffer);
    if (ext === 'pptx') return extractPptx(buffer);
  }

  // Images, video, audio — no text extraction (use OCR separately)
  return {
    text: '', wordCount: 0, pageCount: 0, language: 'en',
    method: 'unsupported',
    success: false,
    error: `Text extraction not supported for MIME: ${mimeType}`,
  };
}
