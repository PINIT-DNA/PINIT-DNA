/**
 * PINIT-DNA — Layer 6: Hidden AI Signature (LSB) + EDS Content Integrity Seal
 *
 * Milestone B Step 1:
 * - Random LSB token embed remains an OWNERSHIP TRACE (may vary per upload).
 * - Identity fingerprint is content_seal_hmac (HMAC over L1–L5 digests) when
 *   DNA_DETERMINISTIC_MODE is ON — stored as payloadHmac for compare SSoT.
 * - stegoTraceHmac (random) dual-written into identity package for LSB verify.
 */

import crypto from 'crypto';
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

const STEGO_MAGIC = 0x504e;
const MAGIC_BITS = 16;
const TOKEN_BYTES = 32;
const TOKEN_BITS = TOKEN_BYTES * 8;
const HMAC_BITS = 256;
const TOTAL_PAYLOAD_BITS = MAGIC_BITS + TOKEN_BITS + HMAC_BITS;

export class SteganographyLayer {
  readonly layerNumber = 6 as const;
  readonly layerName = 'steganography' as const;
  private readonly channel = 'B' as const;

  /**
   * @param digestsL1toL5 — ordered L1–L5 fingerprints for EDS content seal
   */
  async generate(
    image: ImageInput,
    dnaRecordId: string,
    digestsL1toL5?: string[],
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
      const capacityBits = totalPixels;

      if (capacityBits < TOTAL_PAYLOAD_BITS) {
        throw new Error(
          `Image too small to embed signature: needs ${TOTAL_PAYLOAD_BITS} pixels, has ${totalPixels}`,
        );
      }

      // Ownership trace token — intentionally random; NOT used as identity when deterministic
      const token = crypto.randomBytes(TOKEN_BYTES);
      const stegoTraceHmacBuf = crypto
        .createHmac('sha256', config.stego.signatureSecret)
        .update(token)
        .digest();
      const stegoTraceHmac = stegoTraceHmacBuf.toString('hex');

      const digests = digestsL1toL5?.filter(Boolean) ?? [];
      const contentSealHmac =
        digests.length >= 1
          ? computeContentSealHmac('IMAGE', digests, config.stego.signatureSecret)
          : stegoTraceHmac;

      // Identity fingerprint for EDS is contentSealHmac (dual-written to identity package).
      // payloadHmac stays stegoTraceHmac so existing LSB verify against DB continues to work
      // until Milestone D reads identityDeterministic.contentSealHmac for compare.
      const payloadHmac = stegoTraceHmac;

      const bitStream = this.buildBitStream(token, stegoTraceHmacBuf);

      const carrier = Buffer.from(rawRgb);
      for (let i = 0; i < bitStream.length; i++) {
        const blueByteIdx = i * 3 + 2;
        carrier[blueByteIdx] = (carrier[blueByteIdx] & 0xfe) | bitStream[i];
      }

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
          capacityBits,
          usedBits: TOTAL_PAYLOAD_BITS,
          payloadHmac,
          channel: this.channel,
          carrierPath,
          contentSealHmac,
          stegoTraceHmac,
          contentSealAlgorithmId: CONTENT_SEAL_ALGORITHM_ID,
          deterministic,
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

      logger.debug('Layer 6 — complete', {
        capacityBits,
        usedBits: TOTAL_PAYLOAD_BITS,
        payloadHmac: payloadHmac.substring(0, 16) + '...',
        contentSealHmac: contentSealHmac.substring(0, 16) + '...',
        deterministic,
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
      const { data: rawRgb } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const totalPixels = rawRgb.length / 3;
      if (totalPixels < TOTAL_PAYLOAD_BITS) return 0;

      const bits: number[] = [];
      for (let i = 0; i < TOTAL_PAYLOAD_BITS; i++) {
        bits.push(rawRgb[i * 3 + 2] & 1);
      }

      const magic = this.bitsToInt(bits.slice(0, MAGIC_BITS));
      if (magic !== STEGO_MAGIC) return 0.0;

      const tokenBits = bits.slice(MAGIC_BITS, MAGIC_BITS + TOKEN_BITS);
      const token = this.bitsToBuffer(tokenBits);
      const hmacBits = bits.slice(MAGIC_BITS + TOKEN_BITS, TOTAL_PAYLOAD_BITS);
      const extractedHmac = this.bitsToBuffer(hmacBits).toString('hex');

      const recomputedHmac = crypto
        .createHmac('sha256', config.stego.signatureSecret)
        .update(token)
        .digest('hex');

      if (recomputedHmac !== extractedHmac) return 0.5;

      // Prefer stegoTraceHmac when dual-written; else legacy payloadHmac
      const expectedTrace = stored.stegoTraceHmac || stored.payloadHmac;
      if (extractedHmac === expectedTrace) return 1.0;
      return 0.0;
    } catch (err) {
      logger.error('Layer 6 — verify error', { error: err });
      return 0;
    }
  }

  private buildBitStream(token: Buffer, hmac: Buffer): number[] {
    const bits: number[] = [];
    for (let i = MAGIC_BITS - 1; i >= 0; i--) {
      bits.push((STEGO_MAGIC >> i) & 1);
    }
    for (const byte of token) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    }
    for (const byte of hmac) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    }
    return bits;
  }

  private bitsToInt(bits: number[]): number {
    return bits.reduce((acc, bit) => (acc << 1) | bit, 0);
  }

  private bitsToBuffer(bits: number[]): Buffer {
    const bytes = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bytes.length; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | (bits[i * 8 + j] ?? 0);
      }
      bytes[i] = byte;
    }
    return Buffer.from(bytes);
  }
}
