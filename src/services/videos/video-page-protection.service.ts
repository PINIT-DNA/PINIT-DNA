/**
 * Video Frame Protection — Phase 1
 *
 * Extracts frames from a video and runs each one through the exact same
 * pixel-level protection pipeline a standalone image upload gets:
 *   1. DnaOrchestrator.generate()      — full image DNA (15 layers)
 *   2. tryEnrollSpatialAuthAfterDna()  — pixel HKCA tamper localization
 *   3. localDnaIndexService.buildIndex() — patch-level local DNA (crop/fragment recovery)
 *
 * Default is EVERY frame, at the video's own native frame rate (probed via
 * ffprobe) — no frame is left uncovered. If native fps can't be probed, or
 * protectEveryFrame is turned off, falls back to a fixed sample rate
 * (videoPixelProtectionConfig.sampleFps). maxFrames is always a hard cap
 * regardless of mode — a safety valve against unbounded background jobs on
 * very long uploads, not a quality knob.
 *
 * Each frame becomes its own child DnaRecord, linked back to the parent
 * video DnaRecord via videoDnaRecordId/frameIndex/frameTimestampMs — the
 * same self-relation pattern document-page-protection.service.ts uses for
 * PDF pages (documentDnaRecordId/pageNumber). This is additive and
 * best-effort — failures never affect the parent video's DNA record.
 *
 * Unlike PDF pages, the original video file is never modified/reassembled —
 * there is no vault-time embed+swap step here, since embedding an invisible
 * signature into video frame pixels without re-encoding the whole container
 * is a materially bigger problem than PDF page reassembly and is out of
 * scope for this phase. Protection here is enrollment-only: it lets a later
 * investigation cryptographically verify individual frames against what was
 * originally uploaded.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { DnaOrchestrator } from '../dna.orchestrator';
import { localDnaIndexService } from '../forensics/local-dna-index.service';
import { extractFramesForProtection, probeVideoFps } from '../forensics/media-tools.service';
import {
  videoPixelProtectionConfig,
  isVideoPixelProtectionEnabled,
} from '../../config/video-pixel-protection';
import { DNA_GENERATOR_VERSION } from '../../config/dna-versions';
import type { ImageInput } from '../../types/dna.types';

export interface VideoFrameProtectionResult {
  framesSampled: number;
  framesProtected: number;
  framesFailed: number;
  sampleFps: number;
  everyFrame: boolean;
  truncated: boolean;
}

const FRAME_PROTECTION_CONCURRENCY = 3;

function extensionFromFilename(name: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(name);
  return match?.[1]?.toLowerCase() ?? 'mp4';
}

export class VideoPageProtectionService {
  private readonly imageEngine = new DnaOrchestrator();

  async protectVideoFrames(params: {
    videoDnaRecordId: string;
    buffer: Buffer;
    originalName: string;
    ownerUserId?: string;
  }): Promise<VideoFrameProtectionResult | null> {
    if (!isVideoPixelProtectionEnabled()) return null;
    if (!params.ownerUserId) {
      logger.debug('[VideoPageProtection] Skipped — no ownerUserId', {
        videoDnaRecordId: params.videoDnaRecordId,
      });
      return null;
    }
    const ownerUserId = params.ownerUserId;

    // Compact storage (default): same coverage, same pixel-level protection, one row
    // per frame instead of ~2,484. The legacy path below is kept intact and still
    // runs under VIDEO_FRAME_DNA_MODE=legacy; frames already protected either way
    // stay readable, because the investigation readers read both.
    if (videoPixelProtectionConfig.frameDnaMode === 'compact') {
      const { videoFrameDnaService } = await import('./frame-dna/video-frame-dna.service');
      const compact = await videoFrameDnaService.protectFrames({
        videoDnaRecordId: params.videoDnaRecordId,
        buffer: params.buffer,
        originalName: params.originalName,
        ownerUserId,
      });
      if (!compact) return null;
      return {
        framesSampled: compact.framesSampled,
        framesProtected: compact.framesProtected,
        framesFailed: compact.framesFailed,
        sampleFps: compact.sampleFps,
        everyFrame: compact.everyFrame,
        truncated: compact.truncated,
      };
    }

    const ext = extensionFromFilename(params.originalName);
    let sampleFps = videoPixelProtectionConfig.sampleFps;
    let everyFrame = false;

    if (videoPixelProtectionConfig.protectEveryFrame) {
      const nativeFps = await probeVideoFps(params.buffer, ext);
      if (nativeFps && nativeFps > 0) {
        sampleFps = nativeFps;
        everyFrame = true;
      } else {
        logger.warn('[VideoPageProtection] Could not probe native fps — falling back to sampled rate', {
          videoDnaRecordId: params.videoDnaRecordId,
          fallbackSampleFps: sampleFps,
        });
      }
    }

    const samples = await extractFramesForProtection(
      params.buffer,
      { sampleFps, maxFrames: videoPixelProtectionConfig.maxFrames },
      ext,
    );

    if (!samples.length) {
      logger.warn('[VideoPageProtection] Frame extraction unavailable — pixel protection skipped', {
        videoDnaRecordId: params.videoDnaRecordId,
      });
      return null;
    }

    let framesProtected = 0;
    let framesFailed = 0;

    // Protecting every frame of a real video means hundreds-to-thousands of
    // full per-image pipeline runs — sequential processing at that scale can
    // take hours of wall-clock time even as a background job. Bounded
    // concurrency (matching the VAULT_COMPARE_CONCURRENCY=2 pattern used
    // elsewhere for this same per-image pipeline) cuts that materially
    // without spiking resource usage the way unbounded parallelism would.
    let cursor = 0;
    const workers = Array.from({ length: FRAME_PROTECTION_CONCURRENCY }, async () => {
      while (cursor < samples.length) {
        const sample = samples[cursor++]!;
        try {
          await this.protectOneFrame({
            videoDnaRecordId: params.videoDnaRecordId,
            ownerUserId,
            frameIndex: sample.frameIndex,
            frameTimestampMs: sample.timestampMs,
            jpegBuffer: sample.buffer,
          });
          framesProtected++;
        } catch (err) {
          framesFailed++;
          logger.warn('[VideoPageProtection] Frame protection failed (non-fatal)', {
            videoDnaRecordId: params.videoDnaRecordId,
            frameIndex: sample.frameIndex,
            error: String(err),
          });
        }
      }
    });
    await Promise.all(workers);

    const truncated = samples.length >= videoPixelProtectionConfig.maxFrames;
    if (truncated) {
      logger.warn('[VideoPageProtection] Hit maxFrames cap — video truncated, not fully covered', {
        videoDnaRecordId: params.videoDnaRecordId,
        maxFrames: videoPixelProtectionConfig.maxFrames,
        everyFrame,
        sampleFps,
      });
    }

    logger.info('[VideoPageProtection] Complete', {
      videoDnaRecordId: params.videoDnaRecordId,
      framesSampled: samples.length,
      framesProtected,
      framesFailed,
      sampleFps,
      everyFrame,
      truncated,
    });

    return {
      framesSampled: samples.length,
      framesProtected,
      framesFailed,
      sampleFps,
      everyFrame,
      truncated,
    };
  }

  private async protectOneFrame(params: {
    videoDnaRecordId: string;
    ownerUserId: string;
    frameIndex: number;
    frameTimestampMs: number;
    jpegBuffer: Buffer;
  }): Promise<void> {
    // Idempotent: protectVideoFrames can be re-triggered for the same video
    // (a retry, or a concurrent vault-store call) — reuse the existing frame
    // record instead of creating a duplicate DnaRecord every time.
    const existing = await prisma.dnaRecord.findFirst({
      where: { videoDnaRecordId: params.videoDnaRecordId, frameIndex: params.frameIndex },
      select: { id: true },
    });
    if (existing) {
      logger.debug('[VideoPageProtection] Frame already protected — reusing', {
        videoDnaRecordId: params.videoDnaRecordId,
        frameIndex: params.frameIndex,
        frameDnaRecordId: existing.id,
      });
      return;
    }

    const frameImage: ImageInput = {
      filePath: `<video-frame>/${params.videoDnaRecordId}/frame-${params.frameIndex}.jpg`,
      originalName: `frame-${params.frameIndex}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: params.jpegBuffer.length,
      buffer: params.jpegBuffer,
    };

    // Note: DnaOrchestrator.generate() already runs pixel HKCA enrollment
    // internally on these raw bytes — skipSpatialPixel1 trims that to just the
    // cheap HKCA (3A) pass, skipping the expensive dense per-pixel (4E) pass,
    // which would multiply ~40s/17MB across every sampled frame in the video
    // (same rationale document-page-protection.service.ts uses per PDF page).
    const result = await this.imageEngine.generate(frameImage, {
      fileType: 'IMAGE',
      engineVersion: DNA_GENERATOR_VERSION,
      ownerUserId: params.ownerUserId,
      skipSpatialPixel1: true,
    });

    const frameDnaRecordId = result.dnaRecordId;

    await prisma.dnaRecord.update({
      where: { id: frameDnaRecordId },
      data: {
        videoDnaRecordId: params.videoDnaRecordId,
        frameIndex: params.frameIndex,
        frameTimestampMs: params.frameTimestampMs,
      },
    });

    await localDnaIndexService.buildIndex({
      buffer: params.jpegBuffer,
      mimeType: 'image/jpeg',
      dnaRecordId: frameDnaRecordId,
      vaultId: frameDnaRecordId,
      ownerUserId: params.ownerUserId,
    }).catch((err) => {
      logger.warn('[VideoPageProtection] Local DNA patch index failed (non-fatal)', {
        frameDnaRecordId,
        error: String(err),
      });
    });
  }
}

export const videoPageProtectionService = new VideoPageProtectionService();
