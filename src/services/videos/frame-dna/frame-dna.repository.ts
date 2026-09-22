/**
 * Read side of compact video frame DNA, shaped for the existing investigation code.
 *
 * The matchers were written against LocalFeatureIndex rows with a `patches` array.
 * Compact frames hand back that same shape with the pack decoded, so
 * fragment-splice-detector, partial-video-recovery and video composition keep their
 * matching logic exactly as it is — they just have one more place to read frames from.
 *
 * Videos protected before this change still have legacy per-frame DnaRecords; every
 * caller reads legacy first and adds compact frames, so both generations work.
 */
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { decodePatchPack } from './patch-pack';
import type { PatchFingerprint } from '../../forensics/local-dna-patch-generator.service';

export interface FrameRef {
  /** video_frame_dna.id — used wherever a frame DnaRecord id was used before. */
  id: string;
  videoDnaRecordId: string;
  frameIndex: number;
  timestampMs: number;
}

export interface FramePatchIndex {
  vaultId: string;
  dnaRecordId: string;
  imageWidth: number;
  imageHeight: number;
  patches: PatchFingerprint[];
  dnaRecord: { imageFilename: string | null };
}

/**
 * Decoding a pack is ~2,465 objects, and one investigation asks for the same frames
 * across 16 probe keyframes. Keep the last few hundred decoded.
 */
const packCache = new Map<string, FramePatchIndex>();
const PACK_CACHE_LIMIT = 400;

function cachePut(id: string, value: FramePatchIndex): FramePatchIndex {
  if (packCache.size >= PACK_CACHE_LIMIT) packCache.clear();
  packCache.set(id, value);
  return value;
}

export function clearFramePackCache(): void {
  packCache.clear();
}

/** Every compact frame of one video, in play order. */
export async function listFramesForVideo(videoDnaRecordId: string): Promise<FrameRef[]> {
  try {
    return await prisma.videoFrameDna.findMany({
      where: { videoDnaRecordId },
      select: { id: true, videoDnaRecordId: true, frameIndex: true, timestampMs: true },
      orderBy: { frameIndex: 'asc' },
    });
  } catch (err) {
    logger.debug('[FrameDna] listFramesForVideo unavailable', { error: String(err) });
    return [];
  }
}

/**
 * Candidate frames for "which of this owner's videos is this probe from?".
 *
 * Deliberately NOT every frame: at 30 fps a 3-minute video is 5,400 frames, and a
 * discovery pass that loaded them all would decode hundreds of megabytes of packs per
 * probe frame. One frame per second of each video is enough to identify WHICH video a
 * probe came from; the precise frame is then resolved from the full set.
 */
export async function listOwnerDiscoveryFrames(
  ownerUserId: string,
  limit = 1500,
): Promise<Array<{ id: string; videoDnaRecordId: string }>> {
  try {
    return await prisma.$queryRaw<Array<{ id: string; videoDnaRecordId: string }>>`
      SELECT DISTINCT ON ("videoDnaRecordId", ("timestampMs" / 1000))
             "id", "videoDnaRecordId"
        FROM "video_frame_dna"
       WHERE "ownerUserId" = ${ownerUserId}
       ORDER BY "videoDnaRecordId", ("timestampMs" / 1000), "frameIndex"
       LIMIT ${limit}
    `;
  } catch (err) {
    logger.debug('[FrameDna] listOwnerDiscoveryFrames unavailable', { error: String(err) });
    return [];
  }
}

/** Frames by id, in the LocalFeatureIndex shape the patch matchers consume. */
export async function loadFramePatchIndexes(
  frameIds: readonly string[],
  ownerUserId: string,
): Promise<FramePatchIndex[]> {
  const wanted = [...new Set(frameIds.filter(Boolean))];
  if (!wanted.length) return [];

  const out: FramePatchIndex[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    const hit = packCache.get(id);
    if (hit) out.push(hit);
    else missing.push(id);
  }
  if (!missing.length) return out;

  try {
    const rows = await prisma.videoFrameDna.findMany({
      // Owner scoping here as well as in the caller: a frame id must never widen
      // access to another account's video.
      where: { id: { in: missing }, ownerUserId },
      select: {
        id: true,
        width: true,
        height: true,
        frameIndex: true,
        patchPack: true,
        videoDnaRecord: { select: { imageFilename: true } },
      },
    });

    for (const row of rows) {
      try {
        out.push(cachePut(row.id, {
          vaultId: row.id,
          dnaRecordId: row.id,
          imageWidth: row.width,
          imageHeight: row.height,
          patches: decodePatchPack(row.patchPack as unknown as Buffer),
          dnaRecord: {
            imageFilename: row.videoDnaRecord?.imageFilename
              ? `${row.videoDnaRecord.imageFilename} (frame ${row.frameIndex})`
              : null,
          },
        }));
      } catch (err) {
        logger.warn('[FrameDna] Unreadable patch pack skipped', { frameId: row.id, error: String(err) });
      }
    }
  } catch (err) {
    logger.debug('[FrameDna] loadFramePatchIndexes unavailable', { error: String(err) });
  }

  return out;
}

/** The compact frame nearest a timestamp — the counterpart of the legacy frame lookup. */
export async function nearestFrameByTimestamp(
  videoDnaRecordId: string,
  timestampMs: number,
): Promise<FrameRef | null> {
  const frames = await listFramesForVideo(videoDnaRecordId);
  if (!frames.length) return null;
  let nearest = frames[0]!;
  let best = Math.abs(nearest.timestampMs - timestampMs);
  for (const frame of frames) {
    const diff = Math.abs(frame.timestampMs - timestampMs);
    if (diff < best) {
      best = diff;
      nearest = frame;
    }
  }
  return nearest;
}

/** Which video (if any) a frame id belongs to, plus where in it. */
export async function findFramesByIds(frameIds: readonly string[]): Promise<FrameRef[]> {
  const ids = [...new Set(frameIds.filter(Boolean))];
  if (!ids.length) return [];
  try {
    return await prisma.videoFrameDna.findMany({
      where: { id: { in: ids } },
      select: { id: true, videoDnaRecordId: true, frameIndex: true, timestampMs: true },
    });
  } catch (err) {
    logger.debug('[FrameDna] findFramesByIds unavailable', { error: String(err) });
    return [];
  }
}
