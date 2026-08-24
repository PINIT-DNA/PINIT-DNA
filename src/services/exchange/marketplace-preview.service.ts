/**
 * Marketplace preview derivation.
 *
 * The marketplace preview route is public and unauthenticated. It previously
 * returned `vaultService.retrieve().originalBuffer` — the decrypted master
 * file, byte-for-byte — which meant the full licensed asset could be saved by
 * anyone with the URL, no purchase and no login required. That made every
 * licence tier unenforceable.
 *
 * Nothing here ever returns master bytes. A preview is always a derived
 * image: downscaled, re-encoded, stripped of metadata, and watermarked.
 *
 * Client-side right-click blocking is a deterrent, not a control — `curl`
 * ignores it. This module is the actual control.
 */
import sharp from 'sharp';
import { logger } from '../../lib/logger';

/** Longest edge of a derived preview, in pixels. */
const PREVIEW_MAX_EDGE = 1100;

/** JPEG quality for derived previews — good enough to browse, poor to reuse. */
const PREVIEW_QUALITY = 68;

/** Cache derived previews so a popular listing is not re-decrypted per view. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

interface CacheEntry {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Refresh recency for a cheap LRU.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, entry: CacheEntry): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, entry);
}

export function invalidatePreviewCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/**
 * Diagonal repeating watermark. Rendered as SVG so it scales with the image
 * and cannot be trivially cropped out of the middle.
 */
function watermarkSvg(width: number, height: number, label: string): Buffer {
  const safe = label.replace(/[<>&"']/g, '');
  const step = Math.max(180, Math.round(width / 3.2));
  const fontSize = Math.max(15, Math.round(width / 42));

  const marks: string[] = [];
  for (let y = -height; y < height * 2; y += step) {
    for (let x = -width; x < width * 2; x += step) {
      marks.push(
        `<text x="${x}" y="${y}" font-family="Helvetica,Arial,sans-serif" ` +
        `font-size="${fontSize}" fill="#ffffff" fill-opacity="0.30" ` +
        `transform="rotate(-30 ${x} ${y})">${safe}</text>`,
      );
    }
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g>${marks.join('')}</g>` +
    `</svg>`,
  );
}

/**
 * Placeholder for assets sharp cannot rasterise (video, audio, documents).
 * Returning the original for these would reintroduce exactly the leak this
 * module exists to close.
 */
async function nonImagePlaceholder(label: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const width = 1100;
  const height = 750;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="#12171b"/>` +
    `<text x="50%" y="48%" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" ` +
    `font-size="34" fill="#7f8c8d">Preview not available</text>` +
    `<text x="50%" y="56%" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" ` +
    `font-size="20" fill="#5a666a">${label.replace(/[<>&"']/g, '')}</text>` +
    `</svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return { buffer, mimeType: 'image/jpeg' };
}

export interface DerivePreviewInput {
  cacheKey: string;
  originalBuffer: Buffer;
  originalMimeType: string;
  /** Shown in the watermark — the creator's PINIT ID, never an internal UUID. */
  watermarkLabel: string;
}

/**
 * Derive a safe, watermarked preview. Never returns the input buffer.
 */
export async function deriveMarketplacePreview(
  input: DerivePreviewInput,
): Promise<{ buffer: Buffer; mimeType: string; derived: boolean }> {
  const cached = cacheGet(input.cacheKey);
  if (cached) {
    return { buffer: cached.buffer, mimeType: cached.mimeType, derived: true };
  }

  const isImage = String(input.originalMimeType || '').toLowerCase().startsWith('image/');

  try {
    if (!isImage) {
      const ph = await nonImagePlaceholder(input.watermarkLabel);
      cacheSet(input.cacheKey, { ...ph, expiresAt: Date.now() + CACHE_TTL_MS });
      return { ...ph, derived: true };
    }

    // `failOn: 'none'` keeps a slightly malformed but renderable upload from
    // throwing us into the error path, where we must not fall back to the
    // original bytes.
    const base = sharp(input.originalBuffer, { failOn: 'none' }).rotate();
    const meta = await base.metadata();

    const resized = base.resize({
      width: PREVIEW_MAX_EDGE,
      height: PREVIEW_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });

    const flat = await resized.jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true }).toBuffer();
    const flatMeta = await sharp(flat).metadata();
    const w = flatMeta.width || Math.min(PREVIEW_MAX_EDGE, meta.width || PREVIEW_MAX_EDGE);
    const h = flatMeta.height || Math.min(PREVIEW_MAX_EDGE, meta.height || PREVIEW_MAX_EDGE);

    const buffer = await sharp(flat)
      .composite([{ input: watermarkSvg(w, h, input.watermarkLabel), gravity: 'center' }])
      // Re-encode after compositing so no source metadata survives.
      .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true })
      .toBuffer();

    cacheSet(input.cacheKey, { buffer, mimeType: 'image/jpeg', expiresAt: Date.now() + CACHE_TTL_MS });
    return { buffer, mimeType: 'image/jpeg', derived: true };
  } catch (err) {
    // Critical: on any failure we serve a placeholder, never the master file.
    logger.error('[MarketplacePreview] derivation failed — serving placeholder', {
      cacheKey: input.cacheKey,
      error: String(err),
    });
    const ph = await nonImagePlaceholder('Preview unavailable');
    return { ...ph, derived: true };
  }
}

export { PREVIEW_MAX_EDGE, PREVIEW_QUALITY };
