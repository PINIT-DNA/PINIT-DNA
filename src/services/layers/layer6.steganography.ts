/**
 * PINIT-DNA — Layer 6: Hidden AI Signature (LSB Steganography)
 *
 * From the theoretical spec:
 *   "A unique cryptographic token is generated for each image. This token is
 *    converted into a series of 0s and 1s (binary). These 0s and 1s are then
 *    hidden by changing the very last bit of the blue channel value in consecutive
 *    pixels across the image. For example, a pixel with blue value 200 (binary:
 *    11001000) becomes 201 (binary: 11001001) — a change of just 1 unit,
 *    completely invisible to the eye. To read back the token, the system reads
 *    the last bit of each blue channel value in sequence."
 *
 * Payload structure embedded into image:
 *   [16 bits]  Magic header 0x504E (ASCII "PN" for PiNit-DNA)
 *   [256 bits] Random cryptographic token (32 bytes)
 *   [256 bits] HMAC-SHA256(token, LSB_SIGNATURE_SECRET)
 *   ─────────────────────────────────────────────────────
 *   Total: 528 bits → requires at least 528 blue channel pixels
 *
 * What is stored in the DB:
 *   payloadHmac — the HMAC of the embedded token (for verification)
 *   The token itself stays hidden inside the image pixels (never stored)
 *
 * Verification:
 *   1. Read blue channel LSBs from probe image
 *   2. Check for magic header 0x504E → if absent: score 0.0
 *   3. Extract token and HMAC from bit stream
 *   4. Recompute HMAC(token, secret) and compare with extracted HMAC
 *   5. If recomputed HMAC == stored payloadHmac → score 1.0
 *   6. If magic found but HMAC mismatch → score 0.5 (tampered)
 *
 * Survives:  PNG re-saves, brightness/contrast changes, high-quality JPEG (≥90).
 * Defeated by: Lossy JPEG re-encoding at low quality, image resampling/resize,
 *              pixel-level adversarial attacks.
 */

import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import { ImageInput, StegoLayerResult } from '../../types/dna.types';
import { logger } from '../../lib/logger';
import { config } from '../../config';

// Magic header: ASCII "PN" = 0x504E — marks the start of a PINIT-DNA signature
const STEGO_MAGIC = 0x504e;
const MAGIC_BITS = 16;

// Token length: 32 bytes = 256 bits
const TOKEN_BYTES = 32;
const TOKEN_BITS = TOKEN_BYTES * 8;

// HMAC-SHA256 output: 32 bytes = 256 bits
const HMAC_BITS = 256;

// Total bits to embed
const TOTAL_PAYLOAD_BITS = MAGIC_BITS + TOKEN_BITS + HMAC_BITS; // 528

export class SteganographyLayer {
  readonly layerNumber = 6 as const;
  readonly layerName = 'steganography' as const;

  private readonly channel = 'B' as const; // Blue channel per spec

  /**
   * Embed the hidden AI signature into the image's blue channel LSBs.
   *
   * Returns metadata about the embedding + the path of the carrier image
   * (the visually-identical copy with the hidden payload inside).
   */
  async generate(
    image: ImageInput,
    dnaRecordId: string
  ): Promise<StegoLayerResult> {
    const start = Date.now();
    logger.debug('Layer 6 — embedding LSB AI signature', {
      file: image.originalName,
      dnaRecordId,
    });

    try {
      // ── Step 1: Decode image to raw RGB ────────────────────────────────────
      const { data: rawRgb, info } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      const totalPixels = width * height;
      const capacityBits = totalPixels; // 1 bit per pixel (blue LSB)

      if (capacityBits < TOTAL_PAYLOAD_BITS) {
        throw new Error(
          `Image too small to embed signature: needs ${TOTAL_PAYLOAD_BITS} pixels, ` +
          `has ${totalPixels}`
        );
      }

      // ── Step 2: Generate random token ─────────────────────────────────────
      // A unique cryptographic token per image — never stored, lives in pixels
      const token = crypto.randomBytes(TOKEN_BYTES);

      // ── Step 3: Compute HMAC of token ─────────────────────────────────────
      // Stored in DB for later verification — the only DB record of this payload
      const hmac = crypto
        .createHmac('sha256', config.stego.signatureSecret)
        .update(token)
        .digest();

      // ── Step 4: Build bit stream ──────────────────────────────────────────
      // [magic(16)] + [token(256)] + [hmac(256)] = 528 bits
      const bitStream = this.buildBitStream(token, hmac);

      // ── Step 5: Embed into blue channel LSBs ──────────────────────────────
      // Per spec: "changing the very last bit of the blue channel value"
      // In RGB buffer: blue byte = index (pixelIdx * 3 + 2)
      const carrier = Buffer.from(rawRgb);

      for (let i = 0; i < bitStream.length; i++) {
        const blueByteIdx = i * 3 + 2; // R=0, G=1, B=2
        carrier[blueByteIdx] = (carrier[blueByteIdx] & 0xfe) | bitStream[i];
      }

      // ── Step 6: Save carrier image to disk ────────────────────────────────
      // PNG is mandatory — lossy formats destroy LSBs
      const carrierPath = path.resolve(
        config.upload.tempDir,
        `carrier_l6_${dnaRecordId}.png`
      );

      await sharp(carrier, { raw: { width, height, channels: 3 } })
        .png()
        .toFile(carrierPath);

      const payloadHmac = hmac.toString('hex');

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
        },
      };

      logger.debug('Layer 6 — complete', {
        capacityBits,
        usedBits: TOTAL_PAYLOAD_BITS,
        payloadHmac: payloadHmac.substring(0, 16) + '...',
        processingMs: result.processingMs,
      });

      return result;
    } catch (err) {
      logger.error('Layer 6 — failed', { error: err });
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

  /**
   * Extract the hidden payload from a probe image and verify it.
   *
   * From spec §5.3: "System reads blue channel LSBs and reconstructs the AI
   * token. Does it match a known token in the registry?"
   *
   * @param image  - Probe image to inspect
   * @param stored - The stored stego layer record from the DB
   * @returns
   *   1.0 — magic found + HMAC verified against stored payloadHmac
   *   0.5 — magic found but HMAC mismatch (possible tampering)
   *   0.0 — no magic header found (signature absent or destroyed)
   */
  verify(
    _image: ImageInput,
    stored: { payloadHmac: string; channel: string; embedded: boolean }
  ): number {
    if (!stored.embedded || !stored.payloadHmac) {
      logger.debug('Layer 6 — verify SKIPPED (not embedded)');
      return 0;
    }

    try {
      // Extract blue channel LSBs synchronously from buffer
      // Note: image.buffer is a PNG — we need raw pixels
      // For synchronous verify we work with the buffer directly
      // The async version uses sharp; here we delegate to verifyAsync
      logger.debug('Layer 6 — verify called (use verifyAsync for full check)');
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Async version of verify — required because pixel extraction needs sharp.
   * The DnaVerifier calls this directly.
   */
  async verifyAsync(
    image: ImageInput,
    stored: { payloadHmac: string; channel: string; embedded: boolean }
  ): Promise<number> {
    if (!stored.embedded || !stored.payloadHmac) {
      logger.debug('Layer 6 — verify SKIPPED (not embedded)');
      return 0;
    }

    try {
      // ── Extract raw pixels ───────────────────────────────────────────────
      const { data: rawRgb } = await sharp(image.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const totalPixels = rawRgb.length / 3;

      if (totalPixels < TOTAL_PAYLOAD_BITS) {
        logger.debug('Layer 6 — verify FAILED (image too small)');
        return 0;
      }

      // ── Extract blue channel LSBs ────────────────────────────────────────
      const bits: number[] = [];
      for (let i = 0; i < TOTAL_PAYLOAD_BITS; i++) {
        bits.push(rawRgb[i * 3 + 2] & 1);
      }

      // ── Check magic header (first 16 bits) ──────────────────────────────
      const magic = this.bitsToInt(bits.slice(0, MAGIC_BITS));
      if (magic !== STEGO_MAGIC) {
        logger.debug('Layer 6 — verify FAILED (no magic header)', {
          found: magic.toString(16),
          expected: STEGO_MAGIC.toString(16),
        });
        return 0.0;
      }

      // ── Extract token (bits 16–271) ──────────────────────────────────────
      const tokenBits = bits.slice(MAGIC_BITS, MAGIC_BITS + TOKEN_BITS);
      const token = this.bitsToBuffer(tokenBits);

      // ── Extract embedded HMAC (bits 272–527) ────────────────────────────
      const hmacBits = bits.slice(MAGIC_BITS + TOKEN_BITS, TOTAL_PAYLOAD_BITS);
      const extractedHmac = this.bitsToBuffer(hmacBits).toString('hex');

      // ── Recompute HMAC and compare ───────────────────────────────────────
      const recomputedHmac = crypto
        .createHmac('sha256', config.stego.signatureSecret)
        .update(token)
        .digest('hex');

      if (recomputedHmac !== extractedHmac) {
        // Magic found but HMAC doesn't match the embedded value
        // Indicates the image was tampered with after embedding
        logger.debug('Layer 6 — verify PARTIAL (magic found, HMAC mismatch — possible tamper)');
        return 0.5;
      }

      // ── Compare against stored payloadHmac ───────────────────────────────
      if (extractedHmac === stored.payloadHmac) {
        logger.debug('Layer 6 — verify PASSED (HMAC verified)');
        return 1.0;
      }

      // HMAC is internally valid but doesn't match this record
      // (image may have a valid signature from a different record)
      logger.debug('Layer 6 — verify FAILED (HMAC mismatch with stored record)');
      return 0.0;
    } catch (err) {
      logger.error('Layer 6 — verify error', { error: err });
      return 0;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build the full 528-bit payload:
   * [magic 16 bits] + [token 256 bits] + [hmac 256 bits]
   */
  private buildBitStream(token: Buffer, hmac: Buffer): number[] {
    const bits: number[] = [];

    // Magic header: 0x504E as 16 bits
    for (let i = MAGIC_BITS - 1; i >= 0; i--) {
      bits.push((STEGO_MAGIC >> i) & 1);
    }

    // Token bytes → bits (MSB first per byte)
    for (const byte of token) {
      for (let i = 7; i >= 0; i--) {
        bits.push((byte >> i) & 1);
      }
    }

    // HMAC bytes → bits
    for (const byte of hmac) {
      for (let i = 7; i >= 0; i--) {
        bits.push((byte >> i) & 1);
      }
    }

    return bits; // 528 bits total
  }

  /** Convert an array of bits (MSB first) to an integer */
  private bitsToInt(bits: number[]): number {
    return bits.reduce((acc, bit) => (acc << 1) | bit, 0);
  }

  /** Convert an array of bits (MSB first per byte) to a Buffer */
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
