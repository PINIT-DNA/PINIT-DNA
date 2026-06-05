/**
 * PINIT-DNA — Text Diff Service
 *
 * Extracts text from any supported file type and performs
 * forensic-grade line/word/structured diff analysis.
 *
 * Supported: TXT, PDF, DOCX, PPTX, CSV, JSON
 * Does NOT modify any existing DNA/vault/comparison logic.
 */

import * as Diff    from 'diff';
import JSZip        from 'jszip';
import { logger }   from '../../lib/logger';
import type {
  TextDiffResult, TextDiffChunk, SectionDiff,
} from '../../types/forensic-diff.types';

// ─── Text extraction per file type ────────────────────────────────────────────

async function extractText(buffer: Buffer, mimeType: string): Promise<{
  text: string; sections: string[]; pages: string[];
}> {
  const empty = { text: '', sections: [], pages: [] };

  try {
    // Plain text
    if (mimeType === 'text/plain' || mimeType === 'text/csv' ||
        mimeType === 'application/json') {
      const text = buffer.toString('utf-8');
      return { text, sections: [], pages: [text] };
    }

    // PDF
    if (mimeType === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse: (b: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse');
      const data = await pdfParse(buffer);
      const pages = data.text.split(/\f/).filter(Boolean);
      return { text: data.text, sections: [], pages };
    }

    // DOCX / PPTX (OPC ZIP containers)
    if (mimeType.includes('wordprocessingml') || mimeType.includes('presentationml') ||
        buffer.slice(0, 2).toString('hex') === '504b') {
      const zip = await JSZip.loadAsync(buffer);

      // DOCX
      const docFile = zip.file('word/document.xml');
      if (docFile) {
        const xml  = await docFile.async('text');
        const text = xml.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1 ')
                        .replace(/<[^>]+>/g, '')
                        .replace(/\s+/g, ' ').trim();

        // Extract headings as sections
        const headings = [...xml.matchAll(/<w:pStyle w:val="Heading\d"/g)];
        const sections = headings.map((_, i) => `Section ${i + 1}`);

        return { text, sections, pages: [text] };
      }

      // PPTX
      const slideFiles = Object.keys(zip.files)
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort();

      const pages: string[] = [];
      let fullText = '';
      for (const sf of slideFiles) {
        const f    = zip.file(sf);
        if (!f) continue;
        const xml  = await f.async('text');
        const text = xml.replace(/<a:t>([^<]*)<\/a:t>/g, '$1 ')
                        .replace(/<[^>]+>/g, '')
                        .replace(/\s+/g, ' ').trim();
        pages.push(text);
        fullText += text + '\n';
      }
      return { text: fullText, sections: pages.map((_, i) => `Slide ${i + 1}`), pages };
    }
  } catch (err) {
    logger.warn('Text extraction failed', { mimeType, error: String(err) });
  }

  return empty;
}

// ─── JSON structured diff ─────────────────────────────────────────────────────

function jsonDiff(textA: string, textB: string): {
  added: string[]; removed: string[]; modified: string[];
  changeCount: number;
} {
  try {
    const objA = JSON.parse(textA);
    const objB = JSON.parse(textB);

    const added: string[]    = [];
    const removed: string[]  = [];
    const modified: string[] = [];

    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of allKeys) {
      if (!(key in objA)) { added.push(key); continue; }
      if (!(key in objB)) { removed.push(key); continue; }
      if (JSON.stringify(objA[key]) !== JSON.stringify(objB[key])) {
        modified.push(`${key}: "${JSON.stringify(objA[key])}" → "${JSON.stringify(objB[key])}"`);
      }
    }
    return { added, removed, modified, changeCount: added.length + removed.length + modified.length };
  } catch {
    return { added: [], removed: [], modified: [], changeCount: 0 };
  }
}

// ─── CSV structured diff ──────────────────────────────────────────────────────

function csvDiff(textA: string, textB: string): {
  addedRows: number; removedRows: number; modifiedRows: number;
} {
  const rowsA = textA.split('\n').filter(Boolean);
  const rowsB = textB.split('\n').filter(Boolean);
  const setA  = new Set(rowsA);
  const setB  = new Set(rowsB);

  const added   = rowsB.filter(r => !setA.has(r)).length;
  const removed = rowsA.filter(r => !setB.has(r)).length;

  return { addedRows: added, removedRows: removed, modifiedRows: 0 };
}

// ─── Main diff engine ─────────────────────────────────────────────────────────

export class TextDiffService {
  async diff(
    bufferA: Buffer,
    bufferB: Buffer,
    mimeType: string
  ): Promise<TextDiffResult> {
    const unsupported: TextDiffResult = {
      supported: false, engine: 'none',
      addedLines: 0, removedLines: 0, unchangedLines: 0, totalLines: 0,
      changePercent: 0, addedWords: 0, removedWords: 0,
      chunks: [], addedContent: [], removedContent: [], sectionDiffs: [],
      error: `Text extraction not supported for MIME: ${mimeType}`,
    };

    const TEXT_TYPES = [
      'text/plain', 'text/csv', 'application/json', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    // Also try by magic bytes (DOCX/PPTX start with PK)
    const isPkZip = (buf: Buffer) => buf.slice(0, 2).toString('hex') === '504b';
    const isTextCompatible = TEXT_TYPES.some(t => mimeType.includes(t.split('/')[1])) || isPkZip(bufferA);

    if (!isTextCompatible) return unsupported;

    try {
      const [extA, extB] = await Promise.all([
        extractText(bufferA, mimeType),
        extractText(bufferB, mimeType),
      ]);

      if (!extA.text && !extB.text) {
        return { ...unsupported, supported: false, error: 'Could not extract text from either file' };
      }

      const textA = extA.text;
      const textB = extB.text;

      // ── JSON structured diff ──────────────────────────────────────────────
      if (mimeType === 'application/json') {
        const jd = jsonDiff(textA, textB);
        const changePercent = textA.length > 0
          ? Math.round((jd.changeCount / Math.max(Object.keys(JSON.parse(textA.trim() || '{}')).length, 1)) * 100)
          : 100;

        return {
          supported: true, engine: 'json_structured',
          addedLines: jd.added.length, removedLines: jd.removed.length,
          unchangedLines: 0,
          totalLines: jd.added.length + jd.removed.length + jd.modified.length,
          changePercent,
          addedWords: 0, removedWords: 0,
          chunks: [],
          addedContent:   jd.added.slice(0, 10),
          removedContent: jd.removed.slice(0, 10),
          sectionDiffs: jd.modified.slice(0, 5).map(m => ({
            sectionName: m.split(':')[0] ?? 'field',
            type: 'modified' as const,
            changePercent: 100,
            description: m,
          })),
          structuredDiff: { added: jd.added, removed: jd.removed, modified: jd.modified },
        };
      }

      // ── CSV structured diff ───────────────────────────────────────────────
      if (mimeType === 'text/csv') {
        const cd = csvDiff(textA, textB);
        const total = textA.split('\n').length;
        return {
          supported: true, engine: 'csv_rows',
          addedLines: cd.addedRows, removedLines: cd.removedRows,
          unchangedLines: total - cd.addedRows - cd.removedRows,
          totalLines: total,
          changePercent: Math.round(((cd.addedRows + cd.removedRows) / Math.max(total, 1)) * 100),
          addedWords: 0, removedWords: 0,
          chunks: [], addedContent: [], removedContent: [],
          sectionDiffs: [],
          structuredDiff: cd,
        };
      }

      // ── Line-level diff (TXT, PDF, DOCX, PPTX) ───────────────────────────
      const lineDiffs = Diff.diffLines(textA, textB);

      const chunks: TextDiffChunk[] = [];
      let lineNum = 1;
      let addedLines = 0, removedLines = 0, unchangedLines = 0;
      let addedWords = 0, removedWords = 0;
      const addedContent: string[] = [];
      const removedContent: string[] = [];

      for (const part of lineDiffs) {
        const lines = part.value.split('\n').filter(Boolean);
        const words = part.value.split(/\s+/).filter(Boolean).length;

        if (part.added) {
          addedLines  += lines.length;
          addedWords  += words;
          if (addedContent.length < 8 && part.value.trim().length > 5) {
            addedContent.push(part.value.trim().slice(0, 120));
          }
          chunks.push({
            type: 'added', content: part.value.trim().slice(0, 500),
            lineStart: lineNum, lineEnd: lineNum + lines.length,
            location: `Line ${lineNum}`,
            wordCount: words,
            severity: words > 50 ? 'high' : words > 10 ? 'medium' : 'low',
          });
        } else if (part.removed) {
          removedLines += lines.length;
          removedWords += words;
          if (removedContent.length < 8 && part.value.trim().length > 5) {
            removedContent.push(part.value.trim().slice(0, 120));
          }
          chunks.push({
            type: 'removed', content: part.value.trim().slice(0, 500),
            lineStart: lineNum, lineEnd: lineNum + lines.length,
            location: `Line ${lineNum}`,
            wordCount: words,
            severity: words > 50 ? 'high' : words > 10 ? 'medium' : 'low',
          });
        } else {
          unchangedLines += lines.length;
        }
        lineNum += lines.length;
      }

      // Keep top 20 chunks (most significant changes)
      chunks.sort((a, b) => b.wordCount - a.wordCount);
      const topChunks = chunks.slice(0, 20);

      const totalLines = addedLines + removedLines + unchangedLines;
      const changePercent = totalLines > 0
        ? Math.round(((addedLines + removedLines) / totalLines) * 100)
        : 0;

      // Section diffs from page-level extraction
      const sectionDiffs: SectionDiff[] = [];
      const maxPages = Math.max(extA.pages.length, extB.pages.length);
      for (let i = 0; i < maxPages; i++) {
        const pageA = extA.pages[i] ?? '';
        const pageB = extB.pages[i] ?? '';
        if (!pageA && pageB) {
          sectionDiffs.push({ sectionName: `Page ${i + 1}`, type: 'added', changePercent: 100, description: 'New page added' });
        } else if (pageA && !pageB) {
          sectionDiffs.push({ sectionName: `Page ${i + 1}`, type: 'removed', changePercent: 100, description: 'Page removed' });
        } else if (pageA !== pageB) {
          const diff = Diff.diffWords(pageA, pageB);
          const changed = diff.filter(d => d.added || d.removed).reduce((s, d) => s + d.value.split(/\s+/).length, 0);
          const total   = diff.reduce((s, d) => s + d.value.split(/\s+/).length, 0);
          const pct     = total > 0 ? Math.round((changed / total) * 100) : 0;
          if (pct > 0) {
            sectionDiffs.push({ sectionName: `Page ${i + 1}`, type: 'modified', changePercent: pct, description: `${pct}% of content changed` });
          }
        }
      }

      return {
        supported: true,
        engine: 'line_diff',
        addedLines,
        removedLines,
        unchangedLines,
        totalLines,
        changePercent,
        addedWords,
        removedWords,
        chunks: topChunks,
        addedContent:   addedContent.slice(0, 5),
        removedContent: removedContent.slice(0, 5),
        sectionDiffs:   sectionDiffs.slice(0, 10),
      };
    } catch (err) {
      logger.error('Text diff failed', { error: String(err) });
      return { ...unsupported, supported: false, error: String(err) };
    }
  }
}
