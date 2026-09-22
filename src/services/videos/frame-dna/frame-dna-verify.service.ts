/**
 * Verify a protected video frame against what was committed at protect time.
 *
 * Compact frame DNA stores the HKCA pixel-cell Merkle ROOT, not the cell tags. This
 * is what makes that honest: the frame is decoded again from the vault original under
 * the pinned policy, its cell tags are recomputed with the server key, and their root
 * must equal the stored root. If it does, the committed per-cell tags are proven and
 * tamper localisation runs against them exactly as it does for images.
 *
 * Nothing here writes. It reads the owner's own vault file through the existing
 * VaultService, so ownership and decryption rules are unchanged.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { VaultService } from '../../vault/vault.service';
import {
  authenticateAllPixelCells,
  deriveSpatialPixelKey,
  pixelMerkleRootHex,
  isSpatialPixelAuthEnabled,
  spatialPixelAuthConfig,
} from '../../spatial/pixel-auth';
import { decodeSingleRawFrame, probeRawVideo } from './raw-frame-decoder';
import { frameHkcaIdentity } from './video-frame-dna.service';

export interface FrameVerification {
  frameIndex: number;
  timestampMs: number;
  /** The frame decoded from the vault original is byte-identical to the protected one. */
  pixelsMatch: boolean;
  /** Recomputed pixel-cell tags reproduce the committed root. */
  hkcaRootMatch: boolean | null;
  storedSha256: string;
  actualSha256: string | null;
  /** 8x8 cells whose tags differ from the vault original (only when a probe is given). */
  tamperedCellIds?: number[];
  detail: string;
}

export class FrameDnaVerifyService {
  /**
   * Check one stored frame against the vault original, and optionally localise which
   * 8x8 cells of a probe frame differ from it.
   */
  async verifyFrame(params: {
    videoDnaRecordId: string;
    frameIndex: number;
    ownerUserId: string;
    /** Raw RGB24 of a suspect copy of this frame, same geometry. */
    probeRgb?: Buffer;
  }): Promise<FrameVerification | null> {
    const stored = await prisma.videoFrameDna.findFirst({
      where: {
        videoDnaRecordId: params.videoDnaRecordId,
        frameIndex: params.frameIndex,
        ownerUserId: params.ownerUserId,
      },
    });
    if (!stored) return null;

    const vault = await prisma.vaultRecord.findFirst({
      where: { dnaRecordId: params.videoDnaRecordId },
      select: { id: true },
    });
    if (!vault) {
      return {
        frameIndex: stored.frameIndex,
        timestampMs: stored.timestampMs,
        pixelsMatch: false,
        hkcaRootMatch: null,
        storedSha256: stored.rgbSha256,
        actualSha256: null,
        detail: 'The original video is no longer in the vault, so this frame cannot be re-derived.',
      };
    }

    const tmpPath = path.join(os.tmpdir(), `pinit-frame-verify-${Date.now()}-${crypto.randomUUID()}.mp4`);
    try {
      const file = await new VaultService().retrieve(vault.id, params.ownerUserId);
      await fs.promises.writeFile(tmpPath, file.originalBuffer);

      const info = await probeRawVideo(tmpPath);
      if (!info) return null;

      const rgb = await decodeSingleRawFrame(tmpPath, {
        width: info.width,
        height: info.height,
        frameIndex: stored.frameIndex,
      });
      if (!rgb) {
        return {
          frameIndex: stored.frameIndex,
          timestampMs: stored.timestampMs,
          pixelsMatch: false,
          hkcaRootMatch: null,
          storedSha256: stored.rgbSha256,
          actualSha256: null,
          detail: 'The frame could not be decoded from the original video.',
        };
      }

      const actualSha256 = crypto.createHash('sha256').update(rgb).digest('hex');
      const pixelsMatch = actualSha256 === stored.rgbSha256;

      let hkcaRootMatch: boolean | null = null;
      let tamperedCellIds: number[] | undefined;

      if (stored.hkcaRoot && isSpatialPixelAuthEnabled()) {
        const leaves = this.cellLeaves({
          rgb,
          width: info.width,
          height: info.height,
          videoDnaRecordId: params.videoDnaRecordId,
          frameIndex: stored.frameIndex,
          ownerUserId: params.ownerUserId,
          rgbSha256: stored.rgbSha256,
          tagBytes: (stored.hkcaTagBytes as 8 | 16 | null) ?? spatialPixelAuthConfig.tagBytes,
          cellSize: stored.hkcaCellSize ?? spatialPixelAuthConfig.cellSize,
          algorithmVersion: stored.hkcaAlgoVersion ?? undefined,
        });
        hkcaRootMatch = pixelMerkleRootHex(leaves) === stored.hkcaRoot;

        if (params.probeRgb && params.probeRgb.length === rgb.length && hkcaRootMatch) {
          const probeLeaves = this.cellLeaves({
            rgb: params.probeRgb,
            width: info.width,
            height: info.height,
            videoDnaRecordId: params.videoDnaRecordId,
            frameIndex: stored.frameIndex,
            ownerUserId: params.ownerUserId,
            rgbSha256: stored.rgbSha256,
            tagBytes: (stored.hkcaTagBytes as 8 | 16 | null) ?? spatialPixelAuthConfig.tagBytes,
            cellSize: stored.hkcaCellSize ?? spatialPixelAuthConfig.cellSize,
            algorithmVersion: stored.hkcaAlgoVersion ?? undefined,
          });
          tamperedCellIds = [];
          for (let i = 0; i < leaves.length && i < probeLeaves.length; i++) {
            if (!leaves[i]!.tag.equals(probeLeaves[i]!.tag)) tamperedCellIds.push(i);
          }
        }
      }

      return {
        frameIndex: stored.frameIndex,
        timestampMs: stored.timestampMs,
        pixelsMatch,
        hkcaRootMatch,
        storedSha256: stored.rgbSha256,
        actualSha256,
        tamperedCellIds,
        detail: this.describe(pixelsMatch, hkcaRootMatch, tamperedCellIds),
      };
    } catch (err) {
      logger.warn('[FrameDna] Frame verification failed', {
        videoDnaRecordId: params.videoDnaRecordId,
        frameIndex: params.frameIndex,
        error: String(err),
      });
      return null;
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  /** Keyed per-cell tags for one frame, under that frame's own key material. */
  private cellLeaves(params: {
    rgb: Buffer;
    width: number;
    height: number;
    videoDnaRecordId: string;
    frameIndex: number;
    ownerUserId: string;
    rgbSha256: string;
    tagBytes: 8 | 16;
    cellSize: number;
    algorithmVersion?: string;
  }) {
    const identity = frameHkcaIdentity(params.videoDnaRecordId, params.frameIndex, params.rgbSha256);
    const pixelKey = deriveSpatialPixelKey({
      dnaRecordId: identity.dnaRecordId,
      ownerUserId: params.ownerUserId,
      globalDnaRef: identity.globalDnaRef,
      algorithmVersion: params.algorithmVersion,
    });
    return authenticateAllPixelCells({
      rgb: params.rgb,
      width: params.width,
      height: params.height,
      cellSize: params.cellSize,
      pixelKey,
      algorithmVersion: params.algorithmVersion ?? spatialPixelAuthConfig.algorithmVersion,
      dnaRecordId: identity.dnaRecordId,
      globalDnaRef: identity.globalDnaRef,
      tagBytes: params.tagBytes,
    });
  }

  private describe(pixelsMatch: boolean, hkcaRootMatch: boolean | null, tampered?: number[]): string {
    if (!pixelsMatch) {
      return 'The frame decoded from the vault original does not match the protected frame.';
    }
    if (hkcaRootMatch === false) {
      return 'Frame pixels match, but the pixel-cell commitment does not — the stored root cannot be reproduced.';
    }
    if (tampered && tampered.length) {
      return `Frame verified against the original; ${tampered.length} pixel cells differ in the copy.`;
    }
    if (tampered) {
      return 'Frame verified against the original; no pixel cells differ in the copy.';
    }
    return 'Frame verified: pixels and pixel-cell commitment both match the original.';
  }
}

export const frameDnaVerifyService = new FrameDnaVerifyService();
