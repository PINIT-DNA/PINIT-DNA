/**
 * Durable "Examined File" preview for a unified investigation.
 *
 * The probe upload itself is never kept — only a small resized frame, generated
 * once when the investigation runs and persisted server-side. This replaces the
 * previous client-only path (the browser's in-memory File, or a per-browser
 * IndexedDB cache of it), which meant reopening a report later, from Evidence,
 * or on another device showed "Preview not available" whenever that cache had
 * nothing to give.
 *
 * Every call here is best-effort: a failure must never affect the investigation
 * itself, so nothing here throws outward.
 */
import sharp from 'sharp';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { extractVideoFrameSamples } from './media-tools.service';

const MAX_EDGE = 480;
const JPEG_QUALITY = 78;

function videoExtFor(mimeType: string, originalName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(originalName);
  if (m) return m[1].toLowerCase();
  if (mimeType.includes('quicktime')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  return 'mp4';
}

async function toThumbnailJpeg(source: Buffer): Promise<{ data: Buffer; width?: number; height?: number }> {
  const data = await sharp(source, { failOn: 'none' })
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  const meta = await sharp(data).metadata();
  return { data, width: meta.width, height: meta.height };
}

/**
 * Generate and persist the examined-file thumbnail for one investigation. Call this
 * without awaiting on the investigation's critical path — it is pure best-effort.
 */
export async function saveProbeThumbnail(
  investigationId: string,
  ownerUserId: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<void> {
  try {
    let thumb: { data: Buffer; width?: number; height?: number } | null = null;

    if (mimeType.startsWith('video/')) {
      const [frame] = await extractVideoFrameSamples(buffer, 1, videoExtFor(mimeType, originalName));
      if (frame) thumb = await toThumbnailJpeg(frame);
    } else if (mimeType.startsWith('image/')) {
      thumb = await toThumbnailJpeg(buffer);
    }
    // PDFs, documents, audio: no visual thumbnail attempted here — the PDF report
    // already shows their identity by filename/type, not a preview image.
    if (!thumb) return;

    await prisma.investigationProbeThumbnail.upsert({
      where: { investigationId },
      create: {
        investigationId,
        ownerUserId,
        mimeType: 'image/jpeg',
        filename: originalName,
        width: thumb.width,
        height: thumb.height,
        data: thumb.data,
      },
      update: {
        ownerUserId,
        mimeType: 'image/jpeg',
        filename: originalName,
        width: thumb.width,
        height: thumb.height,
        data: thumb.data,
      },
    });
  } catch (err) {
    logger.warn('[InvestigationProbeThumbnail] save failed (non-fatal)', {
      investigationId: investigationId.slice(0, 8),
      error: String(err),
    });
  }
}

/** Owner-scoped read — a thumbnail is only ever returned to the investigation's own owner. */
export async function getProbeThumbnail(
  investigationId: string,
  ownerUserId: string,
): Promise<{ data: Buffer; mimeType: string; filename: string | null } | null> {
  try {
    const row = await prisma.investigationProbeThumbnail.findFirst({
      where: { investigationId, ownerUserId },
      select: { data: true, mimeType: true, filename: true },
    });
    return row ?? null;
  } catch (err) {
    logger.warn('[InvestigationProbeThumbnail] read failed', { investigationId: investigationId.slice(0, 8), error: String(err) });
    return null;
  }
}
