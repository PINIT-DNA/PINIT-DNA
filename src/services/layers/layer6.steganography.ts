/**
 * PINIT-DNA — Layer 6: Ownership watermark (redundant LSB) + EDS content seal
 *
 * - Tiles a compact ownership signature (DNA/vault id, user id, upload meta)
 *   across EVERY blue-channel LSB so ~20% crops can still recover identity.
 * - Full signature details are returned for DB persistence on the file record.
 * - contentSealHmac remains the EDS identity seal over L1–L5 digests.
 */

import path from 'path';
import sharp from 'sharp';
import { ImageInput, StegoLayerResult } from '../../types/dna.types';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import {
  CONTENT_SEAL_ALGORITHM_ID,
  computeContentSealHmac,
  isDnaDeterministicModeEnabled,
} from '../dna/deterministic-identity';
import {
  logIdentityLayerCompleted,
  logIdentityLayerStarted,
} from '../dna/identity-generation-logger';
import {
  embedOwnershipWatermark,
  extractOwnershipWatermark,
  ownershipPayloadHmac,
  OWNERSHIP_TILE_BITS,
  OWNERSHIP_WM_ALGORITHM,
  type OwnershipSignatureDetails,
  type OwnershipWatermarkMeta,
} from './ownership-watermark';

export type { OwnershipSignatureDetails, OwnershipWatermarkMeta };

export class SteganographyLayer {
  readonly layerNumber = 6 as const;
  readonly layerName = 'steganography' as const;
  private readonly channel = 'B' as const;

  /**
   * @param digestsL1toL5 — ordered L1–L5 fingerprints for EDS content seal
   * @param ownership — vault/user/upload metadata embedded redundantly in pixels
   */
  async generate(
    image: ImageInput,
    dnaRecordId: string,
    digestsL1toL5?: string[],
    ownership?: OwnershipWatermarkMeta,
  ): Promise<StegoLayerResult> {
    const start = Date.now();
    const deterministic = isDnaDeterministicModeEnabled();
    logIdentityLayerStarted(6, this.layerName, { dnaRecordId: dnaRecordId.slice(0, 8), deterministic });

    try {
      const { data: rawRgb, info } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      const totalPixels = width * height;

      if (totalPixels < OWNERSHIP_TILE_BITS || width < 32 || height < 16) {
        throw new Error(
          `Image too small to embed ownership watermark: needs at least 32×16 (${OWNERSHIP_TILE_BITS} px), has ${width}×${height}`,
        );
      }

      const ownershipMeta: OwnershipWatermarkMeta = {
        dnaRecordId,
        ownerUserId: ownership?.ownerUserId ?? null,
        vaultId: ownership?.vaultId ?? dnaRecordId,
        filename: ownership?.filename ?? image.originalName,
        mimeType: ownership?.mimeType ?? image.mimeType,
        uploadedAt: ownership?.uploadedAt ?? new Date(),
        ip: ownership?.ip ?? null,
        country: ownership?.country ?? null,
        city: ownership?.city ?? null,
        userAgent: ownership?.userAgent ?? null,
        sessionToken: ownership?.sessionToken ?? null,
      };

      const { rgb: carrier, signature } = embedOwnershipWatermark(
        rawRgb,
        width,
        height,
        ownershipMeta,
      );

      const digests = digestsL1toL5?.filter(Boolean) ?? [];
      const contentSealHmac =
        digests.length >= 1
          ? computeContentSealHmac('IMAGE', digests, config.stego.signatureSecret)
          : ownershipPayloadHmac(signature.tileHex);

      // Stable ownership fingerprint (same ownership tile → same HMAC)
      const payloadHmac = ownershipPayloadHmac(signature.tileHex);
      const stegoTraceHmac = payloadHmac;

      const carrierPath = path.resolve(
        config.upload.tempDir,
        `carrier_l6_${dnaRecordId}.png`,
      );

      await sharp(carrier, { raw: { width, height, channels: 3 } })
        .png()
        .toFile(carrierPath);

      const result: StegoLayerResult = {
        layer: 6,
        name: this.layerName,
        success: true,
        processingMs: Date.now() - start,
        data: {
          embedded: true,
          capacityBits: signature.capacityBits,
          usedBits: signature.usedBits,
          payloadHmac,
          channel: this.channel,
          carrierPath,
          contentSealHmac,
          stegoTraceHmac,
          contentSealAlgorithmId: CONTENT_SEAL_ALGORITHM_ID,
          deterministic,
          ownershipSignature: signature as unknown as Record<string, unknown>,
          ownershipAlgorithm: OWNERSHIP_WM_ALGORITHM,
          ownershipTileCount: signature.tileCount,
        },
      };

      logIdentityLayerCompleted({
        layer: 6,
        name: this.layerName,
        durationMs: result.processingMs,
        fingerprintLength: payloadHmac.length,
        success: true,
        deterministic,
      });

      logger.debug('Layer 6 — ownership watermark complete', {
        capacityBits: signature.capacityBits,
        usedBits: signature.usedBits,
        tileCount: signature.tileCount,
        dnaFingerprint: signature.dnaFingerprint,
        ownerUserId: signature.ownerUserId?.slice(0, 8),
        payloadHmac: payloadHmac.substring(0, 16) + '...',
        contentSealHmac: contentSealHmac.substring(0, 16) + '...',
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 6 — failed', { error: err });
      logIdentityLayerCompleted({
        layer: 6,
        name: this.layerName,
        durationMs: Date.now() - start,
        fingerprintLength: 0,
        success: false,
        deterministic,
      });
      return {
        layer: 6,
        name: this.layerName,
        success: false,
        processingMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
        data: {
          embedded: false,
          capacityBits: 0,
          usedBits: 0,
          payloadHmac: '',
          channel: this.channel,
          carrierPath: null,
        },
      };
    }
  }

  verify(
    _image: ImageInput,
    stored: { payloadHmac: string; channel: string; embedded: boolean }
  ): number {
    if (!stored.embedded || !stored.payloadHmac) return 0;
    return 0;
  }

  async verifyAsync(
    image: ImageInput,
    stored: { payloadHmac: string; channel: string; embedded: boolean; stegoTraceHmac?: string }
  ): Promise<number> {
    if (!stored.embedded || !stored.payloadHmac) return 0;

    try {
      const { data: rawRgb, info } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const extracted = extractOwnershipWatermark(rawRgb, info.width, info.height);
      if (!extracted.found) return 0;
      if (!extracted.sealValid || !extracted.tileHex) return 0.5;

      const recomputed = ownershipPayloadHmac(extracted.tileHex);
      const expected = stored.stegoTraceHmac || stored.payloadHmac;
      if (recomputed === expected) return 1.0;
      return 0.25;
    } catch (err) {
      logger.error('Layer 6 — verify error', { error: err });
      return 0;
    }
  }

  /** Recover ownership tile from a full image or cropped fragment. */
  async recoverOwnership(image: ImageInput) {
    const { data: rawRgb, info } = await sharp(image.buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return extractOwnershipWatermark(rawRgb, info.width, info.height);
  }
}
