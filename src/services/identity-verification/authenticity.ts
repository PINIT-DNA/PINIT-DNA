/**
 * File-level tamper and quality indicators. These are signals, not verdicts:
 * a file with no indicator is "no sign of editing found", never "authentic".
 */
import sharp from 'sharp';
import type { FileSignals, Finding } from './types';

/** Tools whose traces in metadata mean the file was opened in an image/PDF editor. */
const EDITORS = [
  'photoshop', 'gimp', 'canva', 'picsart', 'snapseed', 'pixlr', 'lightroom', 'affinity', 'paint.net',
  'photopea', 'fotor', 'ilovepdf', 'sejda', 'pdfescape', 'smallpdf', 'pdf-xchange editor', 'foxit phantompdf',
  'inkscape', 'coreldraw',
];

const MIN_SHORT_SIDE_PX = 500;
/**
 * Mean |Laplacian| on edge pixels. Normalised by edges, so it does not depend on
 * how much text the card has. Measured on rendered ID text (900px wide):
 * sharp ≈ 125, Gaussian blur σ1 ≈ 57, σ2 ≈ 17, σ3 ≈ 7 (text no longer readable), σ6 ≈ 2.
 */
export const BLUR_THRESHOLD = 12;

/** Sharpness of a greyscale raster: mean |Laplacian| over pixels with a clear gradient. */
export function edgeSharpness(data: Buffer, width: number, height: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gradient = Math.abs(data[i + 1]! - data[i - 1]!) + Math.abs(data[i + width]! - data[i - width]!);
      if (gradient <= 20) continue;
      sum += Math.abs(data[i - 1]! + data[i + 1]! + data[i - width]! + data[i + width]! - 4 * data[i]!);
      count++;
    }
  }
  return count ? sum / count : 0;
}

function editorIn(haystack: string): string | null {
  const lower = haystack.toLowerCase();
  return EDITORS.find((e) => lower.includes(e)) ?? null;
}

/** Collects file signals. Never throws; unknowns stay undefined. */
export async function collectFileSignals(mime: string | null, bytes: Buffer): Promise<FileSignals> {
  const signals: FileSignals = {};
  if (!mime) return signals;
  try {
    if (mime === 'application/pdf') {
      const raw = bytes.toString('latin1');
      signals.locked = /\/Encrypt\s/.test(raw);
      // Each incremental save appends a new %%EOF; the original file has one.
      signals.pdfIncrementalUpdates = Math.max(0, (raw.match(/%%EOF/g) || []).length - 1);
      const producer = (raw.match(/\/(?:Producer|Creator)\s*\(([^)]{0,200})\)/g) || []).join(' ');
      signals.editingSoftware = editorIn(producer);
      return signals;
    }
    if (mime.startsWith('image/')) {
      const img = sharp(bytes, { failOn: 'error' }).rotate();
      const meta = await img.metadata();
      signals.widthPx = meta.width;
      signals.heightPx = meta.height;
      const exifText = [meta.exif, meta.xmp, meta.iptc].filter(Boolean).map((b) => (b as Buffer).toString('latin1')).join(' ');
      signals.editingSoftware = editorIn(exifText);
      signals.looksLikeScreenshot = /screenshot|screen ?shot|screencapture/i.test(exifText);
      const { data, info } = await sharp(bytes)
        .rotate()
        .greyscale()
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
      signals.sharpness = edgeSharpness(data, info.width, info.height);
      signals.intact = true;
    }
  } catch {
    signals.intact = false;
  }
  return signals;
}

export function authenticityFindings(s: FileSignals | undefined, documentIndex: number, label: string): Finding[] {
  const out: Finding[] = [];
  if (!s) return out;
  if (s.intact === false) {
    out.push({ code: 'FILE_UNREADABLE', severity: 'HIGH', message: `${label}: the image file is damaged or could not be decoded.`, documentIndex });
  }
  if (s.locked) {
    out.push({ code: 'FILE_LOCKED', severity: 'MEDIUM', message: `${label}: the PDF is password-locked, so its contents cannot be checked.`, documentIndex });
  }
  if (s.editingSoftware) {
    out.push({
      code: 'EDITING_SOFTWARE_METADATA', severity: 'MEDIUM',
      message: `${label}: the file was saved by an editing tool (${s.editingSoftware}). This is common for crops, but can also mean edits.`,
      documentIndex, evidence: [`metadata: ${s.editingSoftware}`],
    });
  }
  if ((s.pdfIncrementalUpdates ?? 0) > 0) {
    out.push({
      code: 'PDF_EDITED_AFTER_CREATION', severity: 'MEDIUM',
      message: `${label}: the PDF was changed ${s.pdfIncrementalUpdates} time(s) after it was first saved.`,
      documentIndex, evidence: [`incremental updates: ${s.pdfIncrementalUpdates}`],
    });
  }
  if (s.widthPx && s.heightPx && Math.min(s.widthPx, s.heightPx) < MIN_SHORT_SIDE_PX) {
    out.push({
      code: 'LOW_RESOLUTION', severity: 'LOW',
      message: `${label}: the image is small (${s.widthPx}×${s.heightPx}); details may be unreadable.`,
      documentIndex, evidence: [`${s.widthPx}x${s.heightPx}px`],
    });
  }
  if (s.sharpness !== undefined && s.sharpness < BLUR_THRESHOLD) {
    out.push({ code: 'IMAGE_BLURRY', severity: 'LOW', message: `${label}: the image looks out of focus.`, documentIndex, evidence: [`sharpness ${s.sharpness.toFixed(1)}`] });
  }
  if (s.looksLikeScreenshot) {
    out.push({ code: 'SCREENSHOT_OR_SCREEN_CAPTURE', severity: 'LOW', message: `${label}: this is a screenshot, not a photo or scan of the card.`, documentIndex });
  }
  return out;
}

/** 0..1 — starts at 1 and drops for each indicator. Not a probability of authenticity. */
export function authenticityConfidence(findings: Finding[]): number {
  const penalty: Partial<Record<Finding['code'], number>> = {
    FILE_UNREADABLE: 0.6, FILE_LOCKED: 0.3, EDITING_SOFTWARE_METADATA: 0.25, PDF_EDITED_AFTER_CREATION: 0.25,
    LOW_RESOLUTION: 0.1, IMAGE_BLURRY: 0.1, SCREENSHOT_OR_SCREEN_CAPTURE: 0.05, CHECKSUM_INVALID: 0.4,
    NUMBER_STRUCTURE_INVALID: 0.25, DATE_INVALID: 0.25, DATE_ORDER_INVALID: 0.25, STRUCTURE_INCONSISTENT: 0.3,
    ELEMENT_MISSING: 0.1,
    UNDERAGE_FOR_DOCUMENT: 0.25,
  };
  let c = 1;
  for (const f of findings) c -= penalty[f.code] ?? 0;
  return Math.max(0, +c.toFixed(2));
}
