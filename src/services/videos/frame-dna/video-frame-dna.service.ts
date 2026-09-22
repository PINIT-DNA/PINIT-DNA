/**
 * Compact per-frame video DNA.
 *
 * Every frame is still protected at pixel level and still gets its own cryptographic
 * identity. What changes is how that is stored:
 *
 *   legacy (per frame): 1 DnaRecord + 15 layer rows + 1 provenance row + 1
 *     LocalFeatureIndex + ~2,465 LocalDnaPatch rows + 1 HKCA package
 *     -> ~2,484 rows and ~1.3 MB, ~76 s
 *   compact (here):     1 video_frame_dna row
 *     -> frame SHA-256, whole-frame perceptual hashes, the HKCA 8x8 pixel-cell
 *        Merkle root + root MAC, and every multi-scale patch fingerprint packed at
 *        30 bytes each
 *
 * Nothing forensic is thrown away:
 *   - Patch fingerprints are byte-identical in meaning to the rows they replace, so
 *     crop and spliced-fragment matching works exactly as before (the readers decode
 *     the pack into the same shape).
 *   - HKCA cell TAGS are not stored, only committed to. Tags are keyed HMACs (~650 KB
 *     per 1080p frame, incompressible); they are re-derived from the vault original
 *     on demand and checked against the stored root, which is what proves the frame.
 *     Re-derivation is exact because decoding is pinned: same ffmpeg, rgb24, no
 *     autorotation — verified byte-identical across repeat decodes, thread counts and
 *     seeking.
 *   - Every frame leaf is chained into one Merkle root stored with the video's DNA,
 *     so one root commits to the identity of every frame.
 *
 * This is protection data only. It writes no lifecycle events: a video download is
 * one ASSET_DOWNLOADED event, never one per frame.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { videoPixelProtectionConfig } from '../../../config/video-pixel-protection';
import { localDnaPatchGenerator } from '../../forensics/local-dna-patch-generator.service';
import {
  buildPixelAuthPackageFromRgb,
  isSpatialPixelAuthEnabled,
} from '../../spatial/pixel-auth';
import { encodePatchPack, PATCH_PACK_VERSION } from './patch-pack';
import { buildRawPatchGrid } from './raw-patch-grid';
import { decodeRawFrames, decoderIdentity, probeRawVideo, type RawVideoInfo } from './raw-frame-decoder';

export interface CompactFrameDnaResult {
  framesSampled: number;
  framesProtected: number;
  framesFailed: number;
  sampleFps: number;
  everyFrame: boolean;
  truncated: boolean;
  frameMerkleRoot: string | null;
  rowsWritten: number;
  bytesWritten: number;
  elapsedMs: number;
}

const sha256 = (buf: Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');

/** Frame leaf: index, pixels, pixel-cell commitment and patch grid, in that order. */
export function frameLeafHash(params: {
  frameIndex: number;
  rgbSha256: string;
  hkcaRoot: string | null;
  patchPack: Buffer;
}): string {
  const index = Buffer.alloc(4);
  index.writeUInt32BE(params.frameIndex, 0);
  return crypto
    .createHash('sha256')
    .update(index)
    .update(Buffer.from(params.rgbSha256, 'hex'))
    .update(params.hkcaRoot ? Buffer.from(params.hkcaRoot, 'hex') : Buffer.alloc(32))
    .update(Buffer.from(sha256(params.patchPack), 'hex'))
    .digest('hex');
}

/** Binary Merkle over frame leaves; a lone node at a level is promoted, not doubled. */
export function frameMerkleRoot(leafHashes: string[]): string | null {
  if (!leafHashes.length) return null;
  let level: Buffer[] = leafHashes.map((h) => Buffer.from(h, 'hex') as Buffer);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right
        ? (crypto.createHash('sha256').update(left).update(right).digest() as Buffer)
        : left);
    }
    level = next;
  }
  return level[0]!.toString('hex');
}

interface PendingRow {
  videoDnaRecordId: string;
  ownerUserId: string;
  frameIndex: number;
  timestampMs: number;
  width: number;
  height: number;
  rgbSha256: string;
  pHash16: string;
  dHash8: string;
  hkcaAlgoVersion: string | null;
  hkcaKeyId: string | null;
  hkcaCellSize: number | null;
  hkcaTagBytes: number | null;
  hkcaRoot: string | null;
  hkcaRootMac: string | null;
  patchPackVersion: string;
  patchCount: number;
  patchPack: Buffer;
  leafHash: string;
}

export class VideoFrameDnaService {
  /**
   * Protect every frame of a video (or a sampled rate when every-frame is off).
   * Returns null when the video cannot be read — the vaulted video itself is never
   * affected by anything in here.
   */
  async protectFrames(params: {
    videoDnaRecordId: string;
    buffer: Buffer;
    originalName: string;
    ownerUserId: string;
  }): Promise<CompactFrameDnaResult | null> {
    const started = Date.now();
    const tmpPath = path.join(
      os.tmpdir(),
      `pinit-frame-dna-${Date.now()}-${crypto.randomUUID()}${path.extname(params.originalName) || '.mp4'}`,
    );

    try {
      await fs.promises.writeFile(tmpPath, params.buffer);
      const info = await probeRawVideo(tmpPath);
      if (!info || !info.width || !info.height) {
        logger.warn('[FrameDna] Could not read video geometry — frame DNA skipped', {
          videoDnaRecordId: params.videoDnaRecordId,
        });
        return null;
      }

      const everyFrame = videoPixelProtectionConfig.protectEveryFrame && info.fps > 0;
      const sampleFps = everyFrame ? info.fps : videoPixelProtectionConfig.sampleFps;
      const maxFrames = videoPixelProtectionConfig.maxFrames;

      // Idempotent: a retry or a concurrent vault-store must not redo finished frames.
      const existing = await prisma.videoFrameDna.findMany({
        where: { videoDnaRecordId: params.videoDnaRecordId },
        select: { frameIndex: true, leafHash: true },
        orderBy: { frameIndex: 'asc' },
      });
      const doneLeaves = new Map(existing.map((row) => [row.frameIndex, row.leafHash]));

      const decoder = await decoderIdentity();
      const result = await this.runFrames({
        info,
        tmpPath,
        everyFrame,
        sampleFps,
        maxFrames,
        doneLeaves,
        videoDnaRecordId: params.videoDnaRecordId,
        ownerUserId: params.ownerUserId,
      });

      const root = frameMerkleRoot(result.leaves);
      await this.recordSummaryOnVideo(params.videoDnaRecordId, {
        mode: 'compact',
        version: PATCH_PACK_VERSION,
        everyFrame,
        fps: sampleFps,
        frames: result.leaves.length,
        framesFailed: result.framesFailed,
        truncated: result.truncated,
        width: info.width,
        height: info.height,
        decoder,
        frameMerkleRoot: root,
        patchesPerFrame: result.patchesPerFrame,
        completedAt: new Date().toISOString(),
      });

      const elapsedMs = Date.now() - started;
      logger.info('[FrameDna] Complete', {
        videoDnaRecordId: params.videoDnaRecordId,
        frames: result.leaves.length,
        framesProtected: result.framesProtected,
        framesFailed: result.framesFailed,
        everyFrame,
        fps: sampleFps,
        rows: result.framesProtected,
        mbWritten: Math.round((result.bytesWritten / 1024 / 1024) * 10) / 10,
        msPerFrame: result.framesProtected ? Math.round(elapsedMs / result.framesProtected) : null,
        elapsedMs,
      });

      return {
        framesSampled: result.framesSampled,
        framesProtected: result.framesProtected,
        framesFailed: result.framesFailed,
        sampleFps,
        everyFrame,
        truncated: result.truncated,
        frameMerkleRoot: root,
        rowsWritten: result.framesProtected,
        bytesWritten: result.bytesWritten,
        elapsedMs,
      };
    } catch (err) {
      logger.error('[FrameDna] Frame protection failed', {
        videoDnaRecordId: params.videoDnaRecordId,
        error: String(err),
      });
      return null;
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  private async runFrames(params: {
    info: RawVideoInfo;
    tmpPath: string;
    everyFrame: boolean;
    sampleFps: number;
    maxFrames: number;
    doneLeaves: Map<number, string>;
    videoDnaRecordId: string;
    ownerUserId: string;
  }): Promise<{
    leaves: string[];
    framesSampled: number;
    framesProtected: number;
    framesFailed: number;
    truncated: boolean;
    bytesWritten: number;
    patchesPerFrame: number | null;
  }> {
    const { info } = params;
    const leaves: string[] = [];
    let pending: PendingRow[] = [];
    let framesSampled = 0;
    let framesProtected = 0;
    let framesFailed = 0;
    let bytesWritten = 0;
    let patchesPerFrame: number | null = null;
    let lastLog = Date.now();

    const flush = async (): Promise<void> => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      await prisma.videoFrameDna.createMany({ data: batch, skipDuplicates: true });
      framesProtected += batch.length;
      bytesWritten += batch.reduce((sum, row) => sum + row.patchPack.length, 0);
    };

    for await (const frame of decodeRawFrames(params.tmpPath, {
      width: info.width,
      height: info.height,
      fps: info.fps,
      sampleFps: params.everyFrame ? null : params.sampleFps,
      maxFrames: params.maxFrames,
    })) {
      framesSampled += 1;

      const alreadyDone = params.doneLeaves.get(frame.frameIndex);
      if (alreadyDone) {
        leaves.push(alreadyDone);
        continue;
      }

      try {
        const row = await this.buildFrameRow({
          rgb: frame.rgb,
          frameIndex: frame.frameIndex,
          timestampMs: frame.timestampMs,
          width: info.width,
          height: info.height,
          videoDnaRecordId: params.videoDnaRecordId,
          ownerUserId: params.ownerUserId,
        });
        leaves.push(row.leafHash);
        if (patchesPerFrame === null) patchesPerFrame = row.patchCount;
        pending.push(row);
        if (pending.length >= videoPixelProtectionConfig.framePersistBatch) await flush();
      } catch (err) {
        framesFailed += 1;
        logger.warn('[FrameDna] Frame failed (non-fatal)', {
          videoDnaRecordId: params.videoDnaRecordId,
          frameIndex: frame.frameIndex,
          error: String(err),
        });
      }

      if (Date.now() - lastLog > 30_000) {
        lastLog = Date.now();
        logger.info('[FrameDna] Progress', {
          videoDnaRecordId: params.videoDnaRecordId,
          framesSampled,
          framesProtected: framesProtected + pending.length,
          rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        });
      }
    }

    await flush();

    const truncated = framesSampled >= params.maxFrames;
    if (truncated) {
      logger.warn('[FrameDna] Hit maxFrames cap — video not fully covered', {
        videoDnaRecordId: params.videoDnaRecordId,
        maxFrames: params.maxFrames,
      });
    }

    return { leaves, framesSampled, framesProtected, framesFailed, truncated, bytesWritten, patchesPerFrame };
  }

  /** All the forensic data for one frame, ready to store. */
  private async buildFrameRow(params: {
    rgb: Buffer;
    frameIndex: number;
    timestampMs: number;
    width: number;
    height: number;
    videoDnaRecordId: string;
    ownerUserId: string;
  }): Promise<PendingRow> {
    const raw = { width: params.width, height: params.height, channels: 3 } as const;
    const rgbHash = sha256(params.rgb);

    const [pHash16, dHash8] = await Promise.all([
      localDnaPatchGenerator.computePHash16(params.rgb, raw),
      localDnaPatchGenerator.computeDHash8(params.rgb, raw),
    ]);
    const grid = buildRawPatchGrid(params.rgb, params.width, params.height);

    const hkca = this.buildFrameHkca(params, rgbHash);
    const patchPack = encodePatchPack(grid.patches);

    return {
      videoDnaRecordId: params.videoDnaRecordId,
      ownerUserId: params.ownerUserId,
      frameIndex: params.frameIndex,
      timestampMs: params.timestampMs,
      width: params.width,
      height: params.height,
      rgbSha256: rgbHash,
      pHash16,
      dHash8,
      hkcaAlgoVersion: hkca?.algorithmVersion ?? null,
      hkcaKeyId: hkca?.keyId ?? null,
      hkcaCellSize: hkca?.cellSize ?? null,
      hkcaTagBytes: hkca?.tagBytes ?? null,
      hkcaRoot: hkca?.pixelAuthRoot ?? null,
      hkcaRootMac: hkca?.pixelRootMac ?? null,
      patchPackVersion: PATCH_PACK_VERSION,
      patchCount: grid.patches.length,
      patchPack,
      leafHash: frameLeafHash({
        frameIndex: params.frameIndex,
        rgbSha256: rgbHash,
        hkcaRoot: hkca?.pixelAuthRoot ?? null,
        patchPack,
      }),
    };
  }

  /**
   * Pixel-cell authentication for one frame, keyed to that exact frame position and
   * pixel content. The tag blob is computed and dropped — only the root and its MAC
   * are kept. See frameHkcaIdentity for why the key inputs are shaped this way.
   */
  private buildFrameHkca(
    params: { rgb: Buffer; width: number; height: number; frameIndex: number; videoDnaRecordId: string; ownerUserId: string },
    rgbHash: string,
  ) {
    if (!isSpatialPixelAuthEnabled()) return null;
    const identity = frameHkcaIdentity(params.videoDnaRecordId, params.frameIndex, rgbHash);
    const { pixel } = buildPixelAuthPackageFromRgb({
      rgb: params.rgb,
      width: params.width,
      height: params.height,
      dnaRecordId: identity.dnaRecordId,
      ownerUserId: params.ownerUserId,
      globalDnaRef: identity.globalDnaRef,
    });
    return pixel;
  }

  /**
   * Record the frame summary on the video's own DNA record.
   *
   * Merged in SQL rather than read-modify-written: the enterprise DNA package writes
   * other keys of universalFingerprints from a background job, and a JSON round-trip
   * here could drop whatever landed in between.
   */
  private async recordSummaryOnVideo(videoDnaRecordId: string, summary: Record<string, unknown>): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "dna_records"
            SET "universalFingerprints" =
                COALESCE("universalFingerprints", '{}'::jsonb) || jsonb_build_object('videoFrameDna', $1::jsonb)
          WHERE "id" = $2`,
        JSON.stringify(summary),
        videoDnaRecordId,
      );
    } catch (err) {
      logger.warn('[FrameDna] Could not record frame summary on the video DNA record', {
        videoDnaRecordId,
        error: String(err),
      });
    }
  }
}

/**
 * Key material inputs for a frame's pixel authentication.
 *
 * The HKDF is bound to this video AND this frame index, so a tag from frame 10 can
 * never verify frame 11 (a reordered or spliced video fails), and the content seal
 * binds the committed tags to the exact pixels that were protected.
 */
export function frameHkcaIdentity(videoDnaRecordId: string, frameIndex: number, rgbSha256: string) {
  return {
    dnaRecordId: `${videoDnaRecordId}#frame:${frameIndex}`,
    globalDnaRef: `video:${videoDnaRecordId}:frame:${frameIndex}:sha256:${rgbSha256}`,
  };
}

export const videoFrameDnaService = new VideoFrameDnaService();
