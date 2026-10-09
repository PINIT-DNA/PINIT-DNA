/**
 * Read text out of an uploaded ID file.
 * Digital PDFs use the embedded text. Photos use the existing OCR worker.
 * Empty text is a failed document check, not a pass.
 */
import sharp from 'sharp';
import { logger } from '../../lib/logger';
import { OcrService, type OcrCropJob, type OcrWordBox } from '../ocr/ocr.service';
import { verhoeffValid } from '../identity-verification/checksums';
import { collectFileSignals, imageUnclear, UNCLEAR_DOCUMENT } from '../identity-verification/authenticity';
import zlib from 'zlib';

export { UNCLEAR_DOCUMENT };

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

/**
 * A copy of the image for OCR only: EXIF rotation, a readable size, and
 * contrast normalisation. The original bytes stay untouched for quality
 * and authenticity checks.
 */
async function preprocessForOcr(bytes: Buffer): Promise<Buffer> {
  const meta = await sharp(bytes, { failOn: 'none' }).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const long = Math.max(width, height);
  let img = sharp(bytes, { failOn: 'none' }).rotate();
  if (long > 0 && long < 1600) {
    img = img.resize({
      width: width >= height ? 1800 : undefined,
      height: height > width ? 1800 : undefined,
      fit: 'inside',
      withoutEnlargement: false,
    });
  } else if (long > 2200) {
    img = img.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
  }
  return img.greyscale().normalise().png().toBuffer();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** A second pass with stronger contrast, used only when the first read is thin. */
async function preprocessContrast(bytes: Buffer): Promise<Buffer> {
  const meta = await sharp(bytes, { failOn: 'none' }).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const long = Math.max(width, height);
  let img = sharp(bytes, { failOn: 'none' }).rotate();
  if (long > 0 && long < 1800) {
    img = img.resize({
      width: width >= height ? 1800 : undefined,
      height: height > width ? 1800 : undefined,
      fit: 'inside',
      withoutEnlargement: false,
    });
  }
  return img.greyscale().normalise().sharpen().png().toBuffer();
}


// ── Extra reading passes for identity photos ─────────────────────────────────
type ReadResult = { text: string; confidence: number; tokens: OcrWordBox[] };

const AADHAAR_HINT = /aadhaar|aadhar|uidai|unique identification|government of india/i;
const DOB_HINT = /\b(dob|d\.o\.b|date of birth|year of birth)\b/i;

function twelveDigitCandidates(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split('\n')) {
    const digits = line.replace(/\D/g, '');
    if (digits.length === 12 && /^[2-9]/.test(digits)) found.push(digits);
  }
  return found;
}

function hasValidAadhaarNumber(text: string): boolean {
  for (const m of text.matchAll(/\b([2-9]\d{3})\s?(\d{4})\s?(\d{4})\b/g)) {
    if (verhoeffValid(`${m[1]}${m[2]}${m[3]}`)) return true;
  }
  return false;
}

/**
 * A large number printed just above a card's border line is often skipped by a
 * whole-page read. Read horizontal bands again, digits only, and accept a
 * 12-digit result that passes the Aadhaar checksum. If none passes, the most
 * repeated 12-digit result is kept so the person can review it.
 */
async function rescueAadhaarNumber(prepared: Buffer, result: ReadResult): Promise<ReadResult> {
  if (!AADHAAR_HINT.test(result.text) && !(DOB_HINT.test(result.text) && /\b(male|female)\b/i.test(result.text))) return result;
  if (hasValidAadhaarNumber(result.text)) return result;
  const meta = await sharp(prepared).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return result;

  const tops = [0.74, 0.68, 0.80, 0.62, 0.56, 0.86, 0.50, 0.44];
  const jobs: OcrCropJob[] = [];
  const bands: Array<[number, number]> = [];
  for (const t of tops) {
    const y0 = H * t;
    const y1 = Math.min(H, y0 + H * 0.16);
    for (const psm of [6, 7] as const) {
      jobs.push({ x0: 0, y0, x1: W, y1, psm, digitsOnly: true, scale: 2 });
      bands.push([y0, y1]);
    }
  }
  const reads = await ocr.readCrops(prepared, jobs, (r) => twelveDigitCandidates(r.text).some(verhoeffValid));

  let best: { digits: string; confidence: number; band: [number, number] } | null = null;
  const tally = new Map<string, { count: number; confidence: number; band: [number, number] }>();
  reads.forEach((r, i) => {
    for (const d of twelveDigitCandidates(r.text)) {
      if (verhoeffValid(d) && !best) best = { digits: d, confidence: r.confidence, band: bands[i]! };
      const t = tally.get(d) ?? { count: 0, confidence: r.confidence, band: bands[i]! };
      t.count += 1;
      tally.set(d, t);
    }
  });
  if (!best && tally.size) {
    const [digits, t] = [...tally.entries()].sort((a, b) => b[1].count - a[1].count)[0]!;
    best = { digits, confidence: Math.min(t.confidence, 50), band: t.band };
  }
  if (!best) return result;

  const { digits, confidence, band } = best as { digits: string; confidence: number; band: [number, number] };
  const groups = [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)];
  const x0 = W * 0.2;
  const step = (W * 0.5) / 3;
  const y0 = band[0] + (band[1] - band[0]) * 0.3;
  const y1 = band[0] + (band[1] - band[0]) * 0.7;
  const tokens = groups.map((g, i) => ({ text: g, confidence, x0: x0 + i * step, y0, x1: x0 + (i + 1) * step - 8, y1 }));
  logger.info('[GovernmentId] number read again', { valid: verhoeffValid(digits), confidence });
  return { text: `${result.text}\n${groups.join(' ')}`, confidence: result.confidence, tokens: [...result.tokens, ...tokens] };
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

function escapeRegExp(v: string): string {
  return v.split('').map((ch) => ('\\^$.*+?()[]{}|/-'.includes(ch) ? `\\${ch}` : ch)).join('');
}

const letters = (w: string) => w.replace(/[^A-Za-z]/g, '');

/**
 * Printed names are often read with one wrong letter when a shadow or the
 * photo sits next to them. Words in short, mostly alphabetic lines that were read with
 * low confidence are read again, enlarged, as a single line. The new reading
 * replaces the old one only when it is more confident and close to it.
 */
async function sharpenWeakLines(prepared: Buffer, result: ReadResult): Promise<ReadResult> {
  if (!result.tokens.length) return result;
  type Line = { y: number; tokens: OcrWordBox[] };
  const lines: Line[] = [];
  for (const t of [...result.tokens].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const mid = (t.y0 + t.y1) / 2;
    const height = Math.max(8, t.y1 - t.y0);
    const line = lines.find((l) => Math.abs(l.y - mid) <= height * 0.55);
    if (line) {
      line.tokens.push(t);
      line.y = (line.y + mid) / 2;
    } else lines.push({ y: mid, tokens: [t] });
  }
  lines.sort((a, b) => a.y - b.y);

  const picks: Array<{ line: Line; alpha: OcrWordBox[]; avg: number; priority: number }> = [];
  lines.forEach((line, idx) => {
    const alpha = line.tokens.filter((t) => letters(t.text).length >= 3 && letters(t.text).length / t.text.length >= 0.8);
    if (alpha.length < 2 || alpha.length > 4 || alpha.length < line.tokens.length * 0.6) return;
    const avg = alpha.reduce((s, t) => s + t.confidence, 0) / alpha.length;
    const min = Math.min(...alpha.map((t) => t.confidence));
    if (min >= 88 && avg >= 92) return;
    const next = lines[idx + 1];
    const aboveDob = next ? DOB_HINT.test(next.tokens.map((t) => t.text).join(' ')) : false;
    picks.push({ line, alpha, avg, priority: aboveDob ? -1 : avg });
  });
  const chosen = picks.sort((a, b) => a.priority - b.priority).slice(0, 4);
  if (!chosen.length) return result;

  const jobs: OcrCropJob[] = chosen.map(({ line }) => {
    const x0 = Math.min(...line.tokens.map((t) => t.x0));
    const x1 = Math.max(...line.tokens.map((t) => t.x1));
    const y0 = Math.min(...line.tokens.map((t) => t.y0));
    const y1 = Math.max(...line.tokens.map((t) => t.y1));
    const w = x1 - x0;
    const h = y1 - y0;
    return { x0: x0 - w * 0.08, y0: y0 - h * 0.4, x1: x1 + w * 0.08, y1: y1 + h * 0.4, psm: 7, scale: Math.min(4, Math.max(1.5, 90 / Math.max(h, 1))) };
  });
  const reads = await ocr.readCrops(prepared, jobs);

  let text = result.text;
  const tokens = result.tokens.map((t) => ({ ...t }));
  reads.forEach((r, i) => {
    const pick = chosen[i]!;
    const cleaned = r.text.replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleaned.split(' ').filter((w) => letters(w).length >= 2);
    if (words.length !== pick.alpha.length || r.confidence <= pick.avg) return;
    const similar = words.every((w, k) => {
      const old = letters(pick.alpha[k]!.text);
      return levenshtein(letters(w).toLowerCase(), old.toLowerCase()) <= Math.max(2, Math.ceil(old.length * 0.4));
    });
    if (!similar) return;
    pick.alpha.forEach((old, k) => {
      const target = tokens.find((t) => t.x0 === old.x0 && t.y0 === old.y0 && t.text === old.text);
      const fresh = words[k]!;
      if (target) {
        target.text = fresh;
        target.confidence = Math.max(target.confidence, r.confidence);
      }
      const re = new RegExp(`(^|[^A-Za-z])${escapeRegExp(old.text)}(?![A-Za-z])`);
      text = text.replace(re, `$1${fresh}`);
    });
  });
  return { text, confidence: result.confidence, tokens };
}

/** Drops stray marks a crop read puts in front of a line ("——- Maddur", "\ a SO 1] DIST:"). Keeps "D/O:" style openers. */
function tidyAddressLine(line: string, first: boolean): string {
  const words = line.split(' ');
  while (!first && words.length > 1 && words[0]!.replace(/[^A-Za-z0-9]/g, '').length < 3 && !/:$/.test(words[0]!)) words.shift();
  return words.join(' ').replace(/^[^A-Za-z0-9]+/, '').replace(/[,;.s]+$/, '').trim();
}

/**
 * On the back of an Aadhaar the printed address sits left of a QR code, and a
 * whole-page read mixes the code's noise into every address line. Read just the
 * address block again (a few ways, keeping the most confident one that reaches
 * the postcode), then replace everything in that band, including the QR noise on
 * the same rows, with the clean lines.
 */
async function sharpenAddressBlock(prepared: Buffer, result: ReadResult): Promise<ReadResult> {
  const label = result.tokens.find((t) => /^address:?$/i.test(t.text.trim()) && t.confidence >= 30);
  if (!label || !AADHAAR_HINT.test(result.text)) return result;
  const meta = await sharp(prepared).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return result;
  const lineH = Math.max(12, label.y1 - label.y0);
  const top = Math.max(0, label.y0 - lineH * 0.4);
  const bottom = Math.min(H, label.y0 + Math.max(H * 0.3, lineH * 8));
  const left = Math.max(0, label.x0 - 6);
  const right = W * 0.6;
  // The old postcode token (when it was read at all) tells where the block ends. A snug crop reads best.
  const oldPinFirst = result.tokens.find((t) => /\b\d{6}\b/.test(t.text) && t.x0 < right && t.y0 > top && t.y0 < bottom);
  const snug = oldPinFirst ? Math.min(bottom, oldPinFirst.y1 + lineH * 0.9) : bottom;
  // Block mode, enlarged. The left edge is tried at three nearby points: too far left lets the card's vertical
  // "Details as on" text bleed into the first words, too far right clips them.
  const reads = await ocr.readCrops(prepared, [6, 14, 22].map((dx) => ({ x0: label.x0 + dx, y0: top, x1: right, y1: snug, psm: 6 as const, scale: 2 })));
  const score = (r: { text: string; confidence: number }) => r.confidence + Math.min(r.text.split('\n').filter((l) => l.trim()).length, 6) * 3;
  const read = reads.filter((r) => /\b\d{6}\b/.test(r.text)).sort((a, b) => score(b) - score(a))[0];
  if (!read) return result;

  const lines = read.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => /[A-Za-z0-9]{2,}/.test(l));
  // The label is often read as noise ("AQOress"), so it is replaced by a clean one.
  const first = lines[0] ?? '';
  const hasLabel = first.length <= 14 || /ress|addr/i.test(first);
  const rest = (hasLabel ? lines.slice(1) : lines).map((l, i) => tidyAddressLine(l, i === 0)).filter(Boolean);
  const pinAt = rest.findIndex((l) => /\b\d{6}\b/.test(l));
  const body = ['Address:', ...(pinAt >= 0 ? rest.slice(0, pinAt + 1) : rest)].slice(0, 8);
  if (body.length < 3 || pinAt < 0) return result;

  // The band to replace ends just below the old postcode token when it can be found.
  const oldPin = result.tokens.find((t) => /\b\d{6}\b/.test(t.text) && t.x0 < right && t.y0 > top && t.y0 < bottom);
  const bandBottom = oldPin ? Math.min(bottom, oldPin.y1 + lineH * 0.6) : bottom;
  const step = (bandBottom - top) / (body.length + 1);
  const fresh: OcrWordBox[] = body.map((line, i) => ({
    text: line,
    confidence: Math.max(60, read.confidence),
    x0: left + 4,
    x1: right - 4,
    y0: top + i * step,
    y1: top + i * step + step * 0.7,
  }));
  const kept = result.tokens.filter((t) => {
    const mid = (t.y0 + t.y1) / 2;
    return !(mid >= top && mid <= bandBottom);
  });
  logger.info('[GovernmentId] address block read again', { lines: body.length, removed: result.tokens.length - kept.length });
  return { text: `${result.text}\n${body.join('\n')}`, confidence: result.confidence, tokens: [...kept, ...fresh] };
}

async function improveImageRead(prepared: Buffer, result: ReadResult): Promise<ReadResult> {
  try {
    const sharpened = await sharpenWeakLines(prepared, result);
    const withNumber = await rescueAadhaarNumber(prepared, sharpened);
    return await sharpenAddressBlock(prepared, withNumber);
  } catch (err) {
    logger.warn('[GovernmentId] extra reading passes failed', { error: err instanceof Error ? err.message : 'unknown' });
    return result;
  }
}

/**
 * OCR the image. A weak sharpness score does not skip this. If the first pass
 * is thin, a contrast pass is tried and the longer read is kept.
 */
async function readImageText(bytes: Buffer): Promise<{ text: string; confidence: number; tokens: OcrWordBox[] }> {
  const prepared = await preprocessForOcr(bytes);
  const first = await ocr.extractLayout(prepared, 'image/png');
  const firstText = (first.text || '').replace(/[^\S\n]+/g, ' ').trim();
  logger.info('[GovernmentId] ocr pass', { pass: 1, wordCount: wordCount(firstText), confidence: first.confidence });
  if (wordCount(firstText) >= 8 && first.confidence >= 45) {
    return improveImageRead(prepared, { text: firstText, confidence: first.confidence, tokens: first.tokens });
  }
  const secondPrep = await preprocessContrast(bytes);
  const second = await ocr.extractLayout(secondPrep, 'image/png');
  const secondText = (second.text || '').replace(/[^\S\n]+/g, ' ').trim();
  logger.info('[GovernmentId] ocr pass', { pass: 2, wordCount: wordCount(secondText), confidence: second.confidence });
  if (wordCount(secondText) > wordCount(firstText)) {
    return improveImageRead(secondPrep, { text: secondText, confidence: second.confidence, tokens: second.tokens });
  }
  return improveImageRead(firstText ? prepared : secondPrep, {
    text: firstText || secondText,
    confidence: firstText ? first.confidence : second.confidence,
    tokens: firstText ? first.tokens : second.tokens,
  });
}

export async function extractGovernmentDocumentText(mime: string, bytes: Buffer): Promise<{ text: string; confidence: number; unclear?: boolean; tokens: OcrWordBox[] }> {
  try {
    if (mime === 'application/pdf') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse: (buf: Buffer) => Promise<{ text?: string }> = require('pdf-parse');
        const data = await pdfParse(bytes);
        const parsed = (data.text || '').replace(/[^\S\n]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        if (parsed) return { text: parsed, confidence: 95, tokens: [] };
      } catch (err) {
        logger.warn('[GovernmentId] pdf text parser failed', { error: err instanceof Error ? err.message : 'unknown' });
      }
      return { text: literalsFromPdfBytes(bytes), confidence: 70, tokens: [] };
    }
    if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png' || mime === 'image/webp') {
      const imageMime = mime === 'image/jpg' ? 'image/jpeg' : mime;
      const signals = await collectFileSignals(imageMime, bytes);
      logger.info('[GovernmentId] image received', {
        mime: imageMime,
        width: signals.widthPx ?? 0,
        height: signals.heightPx ?? 0,
        qualityWarning: imageUnclear(signals),
      });
      return readImageText(bytes);
    }
  } catch (err) {
    logger.warn('[GovernmentId] text extraction failed', { mime, error: err instanceof Error ? err.message : 'unknown' });
  }
  return { text: '', confidence: 0, tokens: [] };
}
