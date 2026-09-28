/**
 * Compact camera-sensor fingerprint (PRNU-style residual).
 *
 * This is supporting evidence only:
 *   • Same PRNU + different content → allow (do not block Protect)
 *   • Same location/time alone → allow
 *   • Insufficient quality → inconclusive, never “different camera”
 *   • Strong exact / perceptual DNA + existing ownership remains the duplicate path
 *
 * Limitations (NIST / SWGDE): illumination, resolution, compression, and
 * processing reduce reliability. This estimator is not a lab-grade PRNU extractor.
 */
import crypto from 'crypto';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import {
  PRNU_CAMERA_DISCLAIMER,
  type CameraForensicsPublic,
  type CameraForensicsStored,
  type CameraSensorCandidate,
  type PrnuQualityStatus,
} from '../../types/camera-forensics.types';

const GRID = 256;
const COMPACT = 32;
const BLUR_R = 2;
const SAME_CAMERA_CORR = 0.32;
const WEAK_CAMERA_CORR = 0.18;
const QUALITY_OK = 4.0;
const QUALITY_MIN = 1.8;
const LOOKUP_LIMIT = 120;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function residualStd(residual: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < residual.length; i++) sum += residual[i];
  const mean = sum / residual.length;
  let varSum = 0;
  for (let i = 0; i < residual.length; i++) {
    const d = residual[i] - mean;
    varSum += d * d;
  }
  return Math.sqrt(varSum / residual.length);
}

export function qualityStatusFromStd(std: number): PrnuQualityStatus {
  if (std < QUALITY_MIN) return 'INSUFFICIENT';
  if (std < QUALITY_OK) return 'INCONCLUSIVE';
  return 'OK';
}

function boxBlur(gray: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += gray[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

export function compactFromGray(gray: Uint8Array, w: number, h: number): {
  compact: Int8Array;
  quality: number;
  qualityStatus: PrnuQualityStatus;
} {
  const f = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) f[i] = gray[i];
  const blur = boxBlur(f, w, h, BLUR_R);
  const residual = new Float32Array(w * h);
  for (let i = 0; i < residual.length; i++) {
    const r = f[i] - blur[i];
    const r2 = r * r;
    residual[i] = r * (r2 / (r2 + 9));
  }
  const std = residualStd(residual);
  const block = w / COMPACT;
  const compact = new Int8Array(COMPACT * COMPACT);
  for (let by = 0; by < COMPACT; by++) {
    for (let bx = 0; bx < COMPACT; bx++) {
      let s = 0;
      let n = 0;
      const y0 = Math.floor(by * block);
      const x0 = Math.floor(bx * block);
      const y1 = Math.min(h, Math.floor((by + 1) * block));
      const x1 = Math.min(w, Math.floor((bx + 1) * block));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          s += residual[y * w + x];
          n++;
        }
      }
      const mean = n ? s / n : 0;
      compact[by * COMPACT + bx] = Math.max(-127, Math.min(127, Math.round(mean * 8)));
    }
  }
  return { compact, quality: Math.round(std * 1000) / 1000, qualityStatus: qualityStatusFromStd(std) };
}

export function compactToUnit(compact: Int8Array): Float32Array {
  const out = new Float32Array(compact.length);
  for (let i = 0; i < compact.length; i++) out[i] = compact[i];
  return out;
}

export function fingerprintIdFromCompact(compact: Int8Array): string {
  const hash = crypto.createHash('sha256').update(Buffer.from(compact)).digest('hex');
  return `CAM-${hash.slice(0, 10).toUpperCase()}`;
}

export function decodeResidualB64(b64: string): Int8Array | null {
  try {
    return new Int8Array(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

export function toPublicCameraForensics(stored: CameraForensicsStored | null | undefined): CameraForensicsPublic | null {
  if (!stored || stored.version !== 1) return null;
  const { residualB64, ...rest } = stored;
  return {
    ...rest,
    residualStored: Boolean(residualB64),
    disclaimer: PRNU_CAMERA_DISCLAIMER,
  };
}

function parseStored(raw: unknown): CameraForensicsStored | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<CameraForensicsStored>;
  if (o.version !== 1) return null;
  return o as CameraForensicsStored;
}

async function extractCompact(buffer: Buffer): Promise<{
  compact: Int8Array;
  quality: number;
  qualityStatus: PrnuQualityStatus;
} | null> {
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .greyscale()
      .resize(GRID, GRID, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== GRID || info.height !== GRID) return null;
    return compactFromGray(data, GRID, GRID);
  } catch (err) {
    logger.warn('PRNU extract skipped', { error: String(err) });
    return null;
  }
}

/**
 * Background enroll / correlate. Never throws to the Protect caller.
 * Never sets duplicate/block — Protect duplicate policy stays content + ownership.
 */
export async function observeCameraSensor(params: {
  dnaRecordId: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<CameraForensicsStored | null> {
  const mime = (params.mimeType || '').toLowerCase();
  if (!mime.startsWith('image/') || mime.includes('svg')) return null;

  const extracted = await extractCompact(params.buffer);
  if (!extracted) return null;

  const { compact, quality, qualityStatus } = extracted;
  const residualB64 = Buffer.from(compact).toString('base64');

  let fingerprintId: string | null = null;
  let correlation: number | null = null;
  let enrolledNewProfile = false;
  const sameCameraCandidates: CameraSensorCandidate[] = [];

  if (qualityStatus === 'INSUFFICIENT') {
    const stored: CameraForensicsStored = {
      version: 1,
      fingerprintId: null,
      correlation: null,
      quality,
      qualityStatus,
      residualB64: null,
      dim: compact.length,
      sameCameraCandidates: [],
      enrolledNewProfile: false,
      disclaimer: PRNU_CAMERA_DISCLAIMER,
      processedAt: new Date().toISOString(),
    };
    await persist(params.dnaRecordId, stored);
    return stored;
  }

  const prior = await prisma.dnaRecord.findMany({
    where: {
      id: { not: params.dnaRecordId },
      cameraForensics: { not: Prisma.JsonNull },
    },
    select: { id: true, cameraForensics: true },
    orderBy: { createdAt: 'desc' },
    take: LOOKUP_LIMIT,
  });

  const self = compactToUnit(compact);
  let best: { dnaRecordId: string; fingerprintId: string; corr: number; compact: Int8Array } | null = null;

  for (const row of prior) {
    const stored = parseStored(row.cameraForensics);
    if (!stored?.residualB64 || !stored.fingerprintId) continue;
    if (stored.qualityStatus === 'INSUFFICIENT') continue;
    const other = decodeResidualB64(stored.residualB64);
    if (!other || other.length !== compact.length) continue;
    const corr = cosineSimilarity(self, compactToUnit(other));
    if (corr >= WEAK_CAMERA_CORR) {
      sameCameraCandidates.push({
        dnaRecordId: row.id,
        fingerprintId: stored.fingerprintId,
        correlation: Math.round(corr * 1000) / 1000,
      });
    }
    if (!best || corr > best.corr) {
      best = { dnaRecordId: row.id, fingerprintId: stored.fingerprintId, corr, compact: other };
    }
  }

  sameCameraCandidates.sort((a, b) => b.correlation - a.correlation);
  const top = sameCameraCandidates.slice(0, 5);

  if (best && best.corr >= SAME_CAMERA_CORR && qualityStatus === 'OK') {
    fingerprintId = best.fingerprintId;
    correlation = Math.round(best.corr * 1000) / 1000;
  } else if (qualityStatus === 'OK') {
    fingerprintId = fingerprintIdFromCompact(compact);
    correlation = 1;
    enrolledNewProfile = true;
  } else {
    fingerprintId = best && best.corr >= WEAK_CAMERA_CORR ? best.fingerprintId : fingerprintIdFromCompact(compact);
    correlation = best ? Math.round(best.corr * 1000) / 1000 : null;
  }

  const stored: CameraForensicsStored = {
    version: 1,
    fingerprintId,
    correlation,
    quality,
    qualityStatus,
    residualB64,
    dim: compact.length,
    sameCameraCandidates: top,
    enrolledNewProfile,
    disclaimer: PRNU_CAMERA_DISCLAIMER,
    processedAt: new Date().toISOString(),
  };
  await persist(params.dnaRecordId, stored);
  return stored;
}

async function persist(dnaRecordId: string, stored: CameraForensicsStored): Promise<void> {
  try {
    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { cameraForensics: stored as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    logger.warn('PRNU persist skipped (non-fatal)', { dnaRecordId, error: String(err) });
  }
}

/**
 * Compare a probe image against a vault asset's stored compact residual.
 * Supporting evidence only — does not decide ownership.
 */
export async function correlateProbeToStored(
  probeBuffer: Buffer,
  stored: CameraForensicsStored | null | undefined,
): Promise<CameraForensicsPublic | null> {
  const extracted = await extractCompact(probeBuffer);
  if (!extracted) return toPublicCameraForensics(stored ?? null);

  const base: CameraForensicsStored = {
    version: 1,
    fingerprintId: stored?.fingerprintId ?? null,
    correlation: null,
    quality: extracted.quality,
    qualityStatus: extracted.qualityStatus,
    residualB64: null,
    dim: extracted.compact.length,
    sameCameraCandidates: stored?.sameCameraCandidates ?? [],
    enrolledNewProfile: false,
    disclaimer: PRNU_CAMERA_DISCLAIMER,
    processedAt: new Date().toISOString(),
  };

  if (extracted.qualityStatus === 'INSUFFICIENT' || !stored?.residualB64) {
    return toPublicCameraForensics(base);
  }

  const vault = decodeResidualB64(stored.residualB64);
  if (!vault || vault.length !== extracted.compact.length) {
    return toPublicCameraForensics(base);
  }

  const corr = cosineSimilarity(compactToUnit(extracted.compact), compactToUnit(vault));
  return toPublicCameraForensics({
    ...base,
    correlation: Math.round(corr * 1000) / 1000,
    fingerprintId: stored.fingerprintId,
  });
}

export const prnuCameraService = {
  observe: observeCameraSensor,
  correlateProbe: correlateProbeToStored,
  toPublic: toPublicCameraForensics,
  disclaimer: PRNU_CAMERA_DISCLAIMER,
};
