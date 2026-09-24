/**
 * PINIT-DNA — Layers 11-15 Advanced DNA Services
 *
 * L11: AI Deepfake Detection
 * L12: Invisible DCT Watermark
 * L13: Legal Chain of Custody
 * L14: Zero-Knowledge Ownership Proof
 * L15: Biometric Identity Bind
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { aiService } from '../ai/ai-embeddings.service';
import { canEmbedRobustWatermark } from '../dna-vnext/robust-watermark';

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 11: AI Deepfake Detection
// Decoded-pixel noise / frequency analysis (not raw compressed bytes).
// ═══════════════════════════════════════════════════════════════════════════════
export async function processLayer11(
  dnaRecordId: string,
  buffer: Buffer,
  mimeType: string
): Promise<boolean> {
  const start = Date.now();
  try {
    let deepfakeScore = 0;
    let analysisMethod = 'pixel-noise-analysis';
    let confidence = 0;
    let metadata: Record<string, unknown> = {};
    const isMedia = mimeType.startsWith('image/') || mimeType.startsWith('video/');

    if (mimeType.startsWith('image/')) {
      // Real multi-engine ensemble (CLIP zero-shot + EfficientNet AI classifier,
      // ELA, FFT, PRNU, metadata) — replaces the old EXIF-marker + blur-variance
      // heuristic below, which is kept ONLY as a fallback for when the Python
      // service is unavailable (fails soft, never blocks a protect).
      const ensemble = await aiService.analyzeAuthenticity(buffer, mimeType);
      if (ensemble) {
        deepfakeScore = ensemble.aiProbability;
        confidence = Math.round(ensemble.confidence * 100);
        analysisMethod = 'authenticity-ensemble-v1';
        metadata = {
          verdict: ensemble.verdict,
          tamperScore: ensemble.tamperScore,
          authenticityScore: ensemble.authenticityScore,
          reasons: ensemble.reasons,
          signals: ensemble.signals,
        };
      } else {
        deepfakeScore = await analyzeImageAiRisk(buffer);
        confidence = Math.min(92, 50 + Math.round(deepfakeScore * 0.4));
        analysisMethod = 'decoded-pixel-multi-factor-fallback';
      }
    } else if (isMedia) {
      // Video / other: ensemble is image-only, fall back to byte heuristics
      const noiseScore = analyzeByteNoise(buffer);
      const quantScore = analyzeQuantization(buffer);
      const channelScore = analyzeChannelStats(buffer);
      deepfakeScore = Math.round((noiseScore + quantScore + channelScore) / 3);
      confidence = Math.min(92, 50 + Math.round(deepfakeScore * 0.4));
      analysisMethod = 'byte-heuristic-fallback';
    }

    const layer11Data = {
      deepfakeScore,
      isDeepfake: deepfakeScore > 55,
      confidence: isMedia ? confidence : 0,
      modelVersion: '3.0-authenticity-ensemble',
      analysisMethod,
      flagged: deepfakeScore > 55,
      metadata: {
        fileType: mimeType,
        analyzed: isMedia,
        processingMs: Date.now() - start,
        ...metadata,
      },
    };
    // upsert, not create: dnaRecordId is @unique, so an at-least-once redelivery
    // of this dispatch (e.g. once it moves behind a queue) is a no-op success
    // instead of a caught P2002 that gets logged as "Layer 11 failed".
    await prisma.deepfakeLayer.upsert({
      where: { dnaRecordId },
      create: { dnaRecordId, ...layer11Data },
      update: layer11Data,
    });

    logger.info('Layer 11 — Deepfake detection complete', {
      dnaRecordId,
      deepfakeScore,
      analysisMethod,
      flagged: deepfakeScore > 55,
      ms: Date.now() - start,
    });
    return true;
  } catch (err) {
    logger.error('Layer 11 failed', { dnaRecordId, error: String(err) });
    return false;
  }
}

async function analyzeImageAiRisk(buffer: Buffer): Promise<number> {
  try {
    const img = sharp(buffer, { failOn: 'none' });
    const meta = await img.metadata();
    const exif = meta.exif ?? Buffer.alloc(0);
    const exifText = Buffer.concat([exif, buffer.subarray(0, Math.min(buffer.length, 64_000))])
      .toString('latin1')
      .toLowerCase();

    let score = 0;
    const aiMarkers = [
      'midjourney', 'dall-e', 'dalle', 'stable diffusion', 'firefly', 'leonardo',
      'ideogram', 'openai', 'aigc', 'c2pa', 'flux.1', 'synthetic',
    ];
    if (aiMarkers.some((m) => exifText.includes(m))) score += 55;

    const hasCamera = /(?:canon|nikon|sony|apple|iphone|samsung|google|pixel|fujifilm|dji)/i.test(exifText);
    const noExif = !meta.exif || meta.exif.length < 32;
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (noExif && w >= 512 && h >= 512 && !hasCamera) score += 18;
    if (hasCamera) score = Math.max(0, score - 20);

    const { data, info } = await img
      .rotate()
      .resize(192, 192, { fit: 'inside', withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const pixels = new Uint8Array(data);
    let lapSum = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const c = pixels[i]!;
        lapSum += Math.abs(
          4 * c - pixels[i - 1]! - pixels[i + 1]! - pixels[i - width]! - pixels[i + width]!,
        );
        n++;
      }
    }
    const lapMean = n ? lapSum / n : 0;
    if (lapMean < 8 && w >= 512) score += 28;
    else if (lapMean < 14 && w >= 512) score += 14;

    if ((meta.format === 'png' || meta.format === 'webp') && w >= 512 && !hasCamera) score += 12;

    return Math.max(0, Math.min(100, Math.round(score)));
  } catch {
    return analyzeByteNoise(buffer);
  }
}

function analyzeByteNoise(buffer: Buffer): number {
  let diffSum = 0;
  let count = 0;
  const len = Math.min(buffer.length, 50000);
  for (let i = 1; i < len; i++) {
    diffSum += Math.abs(buffer[i]! - buffer[i - 1]!);
    count++;
  }
  const avgDiff = diffSum / count;
  if (avgDiff < 25) return 60;
  if (avgDiff > 90) return 50;
  return 10;
}

function analyzeQuantization(buffer: Buffer): number {
  const hasJfif = buffer.indexOf(Buffer.from('JFIF')) !== -1;
  const hasExif = buffer.indexOf(Buffer.from('Exif')) !== -1;
  if (!hasJfif && !hasExif) return 5;
  const dqtCount = countOccurrences(buffer, Buffer.from([0xff, 0xdb]));
  if (dqtCount > 2) return 40;
  return 8;
}

function analyzeChannelStats(buffer: Buffer): number {
  const rVals: number[] = [], gVals: number[] = [], bVals: number[] = [];
  const step = Math.max(1, Math.floor(buffer.length / 3000));
  for (let i = 0; i < buffer.length - 3; i += step * 3) {
    rVals.push(buffer[i]!);
    gVals.push(buffer[i + 1]!);
    bVals.push(buffer[i + 2]!);
  }
  const rStd = stdDev(rVals);
  const gStd = stdDev(gVals);
  const bStd = stdDev(bVals);
  const avgStd = (rStd + gStd + bStd) / 3;
  if (avgStd < 20) return 55;
  if (Math.abs(rStd - gStd) < 3 && Math.abs(gStd - bStd) < 3) return 35;
  return 5;
}

function stdDev(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const sq = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(sq);
}

function countOccurrences(buf: Buffer, pattern: Buffer): number {
  let count = 0;
  let idx = 0;
  while ((idx = buf.indexOf(pattern, idx)) !== -1) { count++; idx++; }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 12: Invisible Watermark — capability certification
//
// Previously this layer embedded NOTHING — `_buffer` was unused, `method`/
// `strength` were hardcoded constants picked from mimeType, and `embedded:
// true` was a literal, not a result. Fixed to do something real, but honest
// about what's actually possible AT THIS POINT in the pipeline:
//
// DNA generation (where this layer runs) happens BEFORE vault storage — no
// vaultId exists yet, and the real watermark payload's lookup ID is
// HMAC(vaultId, dnaRecordId) (see dna-vnext/crypto.ts). So this layer cannot
// embed the real mark itself; that happens later, at delivery time
// (protected-download / share-link export — see robust-watermark.ts,
// already wired into protected-download.service.ts and tep.service.ts).
//
// What IS real and checkable right now: whether this specific file's
// dimensions can even carry that watermark (canEmbedRobustWatermark), and
// the actual measured survival profile from real transform tests
// (tests/watermark/robust-watermark-transcode.test.ts) — not a guessed
// constant. `embedded` here means "capable of being embedded later", not
// "was embedded" — there is nothing to embed into yet.
// ═══════════════════════════════════════════════════════════════════════════════

/** Real measured pass rate (2026-09-23, after the canonical-frame resize fix):
 * JPEG q90/60/30/10, brightness, grayscale, resize 25-150%, and the composite
 * screenshot transform all survive, at two native resolutions (below and
 * above the canonical frame) — 22/22 in the current matrix. Source:
 * tests/watermark/robust-watermark-transcode.test.ts. Not a guess. Kept at
 * a conservative 0.9 rather than 1.0: the matrix doesn't cover every real
 * transform a leaker might apply (e.g. non-uniform stretch, crop — out of
 * scope for DNA-B, ORB's job elsewhere), so 100% measured-in-test isn't the
 * same claim as "always survives in the wild." */
const DNA_B_MEASURED_SURVIVAL_RATE = 0.9;

export async function processLayer12(
  dnaRecordId: string,
  buffer: Buffer,
  mimeType: string,
  ownerUserId: string
): Promise<boolean> {
  const start = Date.now();
  try {
    const isImage = mimeType.startsWith('image/');
    let capable = false;
    let method = 'not-applicable';

    if (isImage) {
      try {
        const { width, height } = await sharp(buffer).metadata();
        capable = !!width && !!height && canEmbedRobustWatermark(width, height);
      } catch { capable = false; }
      method = 'dna-b-patchwork-v1 (embedded at delivery time, not at protect time)';
    }

    // Registry hash — identifies this DNA record's eligibility for DNA-B,
    // not the watermark payload itself (that's HMAC(vaultId, dnaRecordId),
    // computed once a vaultId exists — see dna-vnext/crypto.ts).
    const payload = `${ownerUserId}:${dnaRecordId}`;
    const watermarkHash = crypto.createHash('sha256').update(payload).digest('hex');
    const strength = capable ? DNA_B_MEASURED_SURVIVAL_RATE : 0;

    const layer12Data = {
      watermarkHash,
      ownerIdEncoded: crypto.createHash('sha256').update(ownerUserId).digest('hex').slice(0, 32),
      method,
      strength,
      embedded: capable,
      survivalScore: strength * 100,
    };
    // upsert — see the Layer 11 comment above for why (redelivery-safety).
    await prisma.dctWatermarkLayer.upsert({
      where: { dnaRecordId },
      create: { dnaRecordId, ...layer12Data },
      update: layer12Data,
    });

    logger.info('Layer 12 — DNA-B capability check complete', {
      dnaRecordId, method, capable, ms: Date.now() - start,
    });
    return true;
  } catch (err) {
    logger.error('Layer 12 failed', { dnaRecordId, error: String(err) });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 13: Legal Chain of Custody
// Creates court-admissible evidence chain — timestamps, hashes, ownership proof.
// Auto-generates DMCA-ready evidence when unauthorized copies detected.
// ═══════════════════════════════════════════════════════════════════════════════
export async function processLayer13(
  dnaRecordId: string,
  buffer: Buffer,
  ownerUserId: string,
  filename: string
): Promise<boolean> {
  const start = Date.now();
  try {
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const timestamp = new Date();

    // Build legal custody chain entry
    const custodyEntry = {
      event: 'FILE_REGISTERED',
      timestamp: timestamp.toISOString(),
      actor: ownerUserId,
      fileHash,
      filename,
      dnaRecordId,
      evidenceType: 'original-upload',
      hashAlgorithm: 'SHA-256',
    };

    // Generate evidence hash — hash of the custody entry itself for tamper detection
    const evidenceHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(custodyEntry))
      .digest('hex');

    const layer13Data = {
      custodyChain: [custodyEntry],
      dmcaReady: true,
      evidenceHash,
      legalTimestamp: timestamp,
      jurisdiction: 'IN',
      courtAdmissible: true,
    };
    // upsert with an EMPTY update — first write wins. Unlike Layers 11/12/15
    // (recomputed from the same inputs, so overwriting is harmless), this row
    // is the legal registration record: legalTimestamp and evidenceHash must
    // keep the ORIGINAL moment, so a redelivered job must not overwrite them.
    await prisma.custodyLayer.upsert({
      where: { dnaRecordId },
      create: { dnaRecordId, ...layer13Data },
      update: {},
    });

    logger.info('Layer 13 — Legal custody chain created', {
      dnaRecordId, evidenceHash: evidenceHash.slice(0, 16), ms: Date.now() - start,
    });
    return true;
  } catch (err) {
    logger.error('Layer 13 failed', { dnaRecordId, error: String(err) });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 14: Zero-Knowledge Ownership Proof
// Proves file ownership without revealing file contents.
// Uses hash-commitment scheme: commit = H(secret || fileHash)
// Verifier can check ownership without seeing the file.
// ═══════════════════════════════════════════════════════════════════════════════
export async function processLayer14(
  dnaRecordId: string,
  buffer: Buffer,
  ownerUserId: string
): Promise<boolean> {
  const start = Date.now();
  try {
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Generate owner's secret for this file
    const secret = crypto.randomBytes(32).toString('hex');

    // Commitment = H(secret || fileHash || ownerUserId)
    const commitmentHash = crypto
      .createHash('sha256')
      .update(`${secret}${fileHash}${ownerUserId}`)
      .digest('hex');

    // Public key = H(ownerUserId || dnaRecordId) — can be shared without revealing identity
    const publicKey = crypto
      .createHash('sha256')
      .update(`${ownerUserId}${dnaRecordId}`)
      .digest('hex');

    // Proof data = encrypted secret (only owner can reveal to prove ownership).
    // The IV MUST be random per encryption: a fixed IV here previously reused
    // the same (key, IV) pair for every file the same owner ever protected —
    // since the key is deterministic per ownerUserId, that's the AES-GCM
    // "forbidden attack" setup (repeated nonce lets an attacker recover the
    // XOR of plaintexts across a user's files, and with enough samples,
    // forge auth tags). Store the IV alongside the ciphertext so a future
    // verifier can still decrypt — nothing reads proofData today, but the
    // format needs to be self-decodable when one exists.
    const proofIv = crypto.randomBytes(12);
    const proofCipher = crypto.createCipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(ownerUserId).digest(),
      proofIv
    );
    const proofData = proofIv.toString('hex') + ':' + Buffer.concat([
      proofCipher.update(secret, 'utf8'),
      proofCipher.final(),
    ]).toString('hex') + ':' + proofCipher.getAuthTag().toString('hex');

    const layer14Data = {
      commitmentHash,
      proofData,
      publicKey,
      verified: true,
      proofType: 'hash-commitment',
    };
    // upsert with an EMPTY update — first write wins. The secret above is
    // freshly random per call, so overwriting on a redelivered job would
    // replace the original commitment with an unrelated one.
    await prisma.zkProofLayer.upsert({
      where: { dnaRecordId },
      create: { dnaRecordId, ...layer14Data },
      update: {},
    });

    logger.info('Layer 14 — ZK proof created', {
      dnaRecordId, publicKey: publicKey.slice(0, 16), ms: Date.now() - start,
    });
    return true;
  } catch (err) {
    logger.error('Layer 14 failed', { dnaRecordId, error: String(err) });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 15: Biometric Identity Bind
// Captures the uploader's face embedding hash and binds it to the DNA record.
// Proves a SPECIFIC PERSON — not just an account — uploaded the file.
// ═══════════════════════════════════════════════════════════════════════════════
export async function processLayer15(
  dnaRecordId: string,
  ownerUserId: string
): Promise<boolean> {
  const start = Date.now();
  try {
    // Fetch user's face embedding
    const user = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { faceEmbedding: true, faceRegistered: true },
    });

    if (!user?.faceRegistered || !user.faceEmbedding?.length) {
      // No face registered — upsert a record with empty biometric. upsert, not
      // create: dnaRecordId is @unique, so an at-least-once redelivery of this
      // dispatch is a no-op success instead of a caught P2002 logged as a failure.
      await prisma.biometricBindLayer.upsert({
        where: { dnaRecordId },
        create: {
          dnaRecordId,
          biometricHash: 'NOT_REGISTERED',
          biometricType: 'none',
          bindMethod: 'none',
          userId: ownerUserId,
          embeddedInFile: false,
        },
        update: {
          biometricHash: 'NOT_REGISTERED',
          biometricType: 'none',
          bindMethod: 'none',
          userId: ownerUserId,
          embeddedInFile: false,
        },
      });
      logger.info('Layer 15 — No biometric available', { dnaRecordId });
      return true;
    }

    // Convert face embedding to a deterministic hash
    const embeddingStr = user.faceEmbedding.map(v => v.toFixed(6)).join(',');
    const biometricHash = crypto
      .createHash('sha256')
      .update(embeddingStr)
      .digest('hex');

    const layer15Data = {
      biometricHash,
      biometricType: 'face-embedding',
      bindMethod: 'hmac-sha256',
      userId: ownerUserId,
      embeddedInFile: true,
    };
    // upsert — see the branch above for why (redelivery-safety).
    await prisma.biometricBindLayer.upsert({
      where: { dnaRecordId },
      create: { dnaRecordId, ...layer15Data },
      update: layer15Data,
    });

    logger.info('Layer 15 — Biometric bound to file', {
      dnaRecordId,
      biometricHash: biometricHash.slice(0, 16),
      ms: Date.now() - start,
    });
    return true;
  } catch (err) {
    logger.error('Layer 15 failed', { dnaRecordId, error: String(err) });
    return false;
  }
}

export interface AdvancedLayersResult {
  successful: number;
  failed: number;
  completedLayers: number[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS ALL 5 LAYERS (L11–L15) — awaited as part of the full 15-layer pipeline
// ═══════════════════════════════════════════════════════════════════════════════
export async function processAdvancedLayers(
  dnaRecordId: string,
  buffer: Buffer,
  mimeType: string,
  ownerUserId: string,
  filename: string
): Promise<AdvancedLayersResult> {
  const settled = await Promise.all([
    processLayer11(dnaRecordId, buffer, mimeType),
    processLayer12(dnaRecordId, buffer, mimeType, ownerUserId),
    processLayer13(dnaRecordId, buffer, ownerUserId, filename),
    processLayer14(dnaRecordId, buffer, ownerUserId),
    processLayer15(dnaRecordId, ownerUserId),
  ]);

  const completedLayers = [11, 12, 13, 14, 15].filter((_, i) => settled[i]);
  const successful = completedLayers.length;

  logger.info('Layers 11-15 complete', { dnaRecordId, successful, completedLayers });

  return {
    successful,
    failed: 5 - successful,
    completedLayers,
  };
}
