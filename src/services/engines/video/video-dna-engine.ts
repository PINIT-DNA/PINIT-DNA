/**
 * PINIT-DNA — Video DNA Engine  (Phase 4)
 *
 * Zero-dependency approach — pure binary header analysis.
 * No ffprobe required. Works on any platform.
 *
 * L1 — Cryptographic  : SHA-256 of raw bytes
 * L2 — Structural     : Container format + file size + key MP4 box sizes
 * L3 — Perceptual     : Binary-chunk SimHash (8 evenly-spaced 4KB samples)
 * L4 — Semantic       : Container type + codec hints from header bytes
 * L5 — Metadata       : MP4 mvhd box (duration, timescale, creation date)
 *                       or RIFF header for AVI, EBML header for WebM
 * L6 — Signature      : HMAC-SHA256 over all L1–L5 fingerprints
 *
 * Note: When ffprobe is available on the system, Phase 4+ can be enhanced
 * with keyframe pHash and exact frame count.  This engine is the baseline.
 */

import crypto from 'crypto';
import { config } from '../../../config';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { FileInput } from '../../universal-file-router';
import { UniversalEngineResult, UniversalLayerResult } from '../../../types/universal-engine.types';
import { simHash64, computeHmac, sha256 } from '../base/text-utils';

// ─── Container detection ──────────────────────────────────────────────────────

type VideoContainer = 'MP4' | 'MOV' | 'AVI' | 'WEBM' | 'MKV' | 'MPEG' | 'FLV' | 'UNKNOWN';

interface ContainerInfo {
  container: VideoContainer;
  brand?: string;          // MP4 ftyp brand e.g. "mp42", "isom"
  codecHint?: string;
}

function detectContainer(buf: Buffer): ContainerInfo {
  if (buf.length < 12) return { container: 'UNKNOWN' };

  // MP4 / MOV — box at offset 4 is "ftyp"
  const box4 = buf.slice(4, 8).toString('ascii');
  if (box4 === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii').trim();
    const isQuickTime = brand.startsWith('qt') || brand === 'MSNV';
    return { container: isQuickTime ? 'MOV' : 'MP4', brand, codecHint: 'H.264/AAC' };
  }

  // AVI — RIFF....AVI
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'AVI ') {
    return { container: 'AVI', codecHint: 'various' };
  }

  // WebM / MKV — EBML magic
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    // Check for webm DocType (usually in first 64 bytes)
    const header = buf.slice(0, 64).toString('binary');
    const isWebM = header.includes('webm');
    return { container: isWebM ? 'WEBM' : 'MKV', codecHint: 'VP8/VP9/AV1/Opus' };
  }

  // MPEG
  if ((buf[0] === 0xff && buf[1] === 0xfb) ||
      (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0xba)) {
    return { container: 'MPEG', codecHint: 'MPEG' };
  }

  // FLV
  if (buf.slice(0, 3).toString('ascii') === 'FLV') {
    return { container: 'FLV', codecHint: 'H.264/AAC' };
  }

  return { container: 'UNKNOWN' };
}

// ─── MP4 box parser ───────────────────────────────────────────────────────────

interface MvhdData {
  creationTime: Date | null;
  modificationTime: Date | null;
  timescale: number | null;
  durationSeconds: number | null;
}

/**
 * Walk MP4 boxes to find mvhd (Movie Header Box) which contains duration.
 * Handles both 32-bit and 64-bit box sizes.
 */
function parseMvhd(buf: Buffer): MvhdData {
  const empty: MvhdData = { creationTime: null, modificationTime: null, timescale: null, durationSeconds: null };
  if (buf.length < 8) return empty;

  try {
    // Search for 'mvhd' string in first 256KB
    const searchLimit = Math.min(buf.length, 256 * 1024);
    for (let i = 0; i < searchLimit - 8; i++) {
      if (buf[i] === 0x6d && buf[i+1] === 0x76 && buf[i+2] === 0x68 && buf[i+3] === 0x64) {
        // Found 'mvhd', box starts 4 bytes before (size field)
        const boxStart = i - 4;
        if (boxStart < 0 || boxStart + 32 > buf.length) break;

        const version = buf[i + 4]; // version byte after box name
        if (version === 0) {
          // 32-bit timestamps
          const mp4Epoch = new Date('1904-01-01T00:00:00Z').getTime();
          const creation  = buf.readUInt32BE(i + 8);
          const modified  = buf.readUInt32BE(i + 12);
          const timescale = buf.readUInt32BE(i + 16);
          const duration  = buf.readUInt32BE(i + 20);
          return {
            creationTime: new Date(mp4Epoch + creation * 1000),
            modificationTime: new Date(mp4Epoch + modified * 1000),
            timescale: timescale > 0 ? timescale : null,
            durationSeconds: timescale > 0 ? Math.round(duration / timescale * 100) / 100 : null,
          };
        } else if (version === 1) {
          // 64-bit timestamps (skip BigInt for now, just read timescale)
          const timescale = buf.readUInt32BE(i + 28);
          return { creationTime: null, modificationTime: null,
            timescale: timescale > 0 ? timescale : null,
            durationSeconds: null };
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return empty;
}

// ─── Binary chunk SimHash ─────────────────────────────────────────────────────

/**
 * Take 8 evenly-spaced 4KB samples from the file, hex-encode them,
 * and SimHash the concatenation. Gives a perceptual hash that is
 * stable for identical files and different for different content.
 */
function binaryChunkSimHash(buf: Buffer): string {
  const CHUNKS  = 8;
  const CHUNK_SIZE = 4096;
  const step = Math.max(1, Math.floor(buf.length / CHUNKS));
  const parts: string[] = [];

  for (let i = 0; i < CHUNKS; i++) {
    const start = Math.min(i * step, buf.length);
    const end   = Math.min(start + CHUNK_SIZE, buf.length);
    parts.push(buf.slice(start, end).toString('hex'));
  }

  return simHash64(parts.join(' '));
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class VideoDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];
    const buf = file.buffer;

    logger.info('Video DNA engine started', { dnaRecordId, file: file.originalName, sizeBytes: buf.length });

    const containerInfo = detectContainer(buf);
    const mvhd = containerInfo.container === 'MP4' || containerInfo.container === 'MOV'
      ? parseMvhd(buf) : { creationTime: null, modificationTime: null, timescale: null, durationSeconds: null };

    layers.push(await this.runLayer(() => this.layer1(buf)));
    layers.push(await this.runLayer(() => this.layer2(buf, containerInfo)));
    layers.push(await this.runLayer(() => this.layer3(buf)));
    layers.push(await this.runLayer(() => this.layer4(containerInfo)));
    layers.push(await this.runLayer(() => this.layer5(buf, containerInfo, mvhd)));

    const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
    layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));

    const successful = layers.filter(l => l.success).length;
    const status = successful >= 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('Video DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return { dnaRecordId, fileType: 'VIDEO', engineVersion: config.dna.engineVersion,
      schemaVersion: config.dna.schemaVersion, layers, status,
      totalProcessingMs: totalMs, generatedAt: new Date() };
  }

  // ─── L1: Cryptographic ────────────────────────────────────────────────────

  private layer1(buf: Buffer): UniversalLayerResult {
    const t = Date.now();
    const sha256Hash = crypto.createHash('sha256').update(buf).digest('hex');
    return { layer: 1, name: 'cryptographic', implementation: 'sha256',
      fingerprint: sha256Hash, data: { sha256Hash, fileSizeBytes: buf.length },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L2: Structural ───────────────────────────────────────────────────────

  private layer2(buf: Buffer, info: ContainerInfo): UniversalLayerResult {
    const t = Date.now();
    const sizeMb = Math.round(buf.length / (1024 * 1024) * 100) / 100;

    // For MP4: walk top-level boxes for their sizes (structural layout)
    const boxMap: Record<string, number> = {};
    if (info.container === 'MP4' || info.container === 'MOV') {
      let pos = 0;
      while (pos + 8 <= Math.min(buf.length, 64 * 1024)) {
        const boxSize = buf.readUInt32BE(pos);
        if (boxSize < 8) break;
        const boxType = buf.slice(pos + 4, pos + 8).toString('ascii');
        boxMap[boxType] = boxSize;
        pos += boxSize;
        if (pos >= buf.length) break;
      }
    }

    const data = { container: info.container, brand: info.brand ?? null,
      fileSizeBytes: buf.length, fileSizeMb: sizeMb, topLevelBoxes: boxMap };
    const fingerprint = sha256(`${info.container}:${buf.length}:${Object.keys(boxMap).sort().join(',')}`);

    return { layer: 2, name: 'structural', implementation: 'container_layout_hash',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(buf: Buffer): UniversalLayerResult {
    const t = Date.now();
    const hash64   = binaryChunkSimHash(buf);
    // Also hash first and last 64KB for quick pre-filter
    const headHash = sha256(buf.slice(0, Math.min(65536, buf.length)));
    const tailHash = sha256(buf.slice(Math.max(0, buf.length - 65536)));

    return { layer: 3, name: 'perceptual', implementation: 'binary_chunk_simhash',
      fingerprint: hash64,
      data: { simHash64: hash64, headHash, tailHash, sampledChunks: 8 },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L4: Semantic ─────────────────────────────────────────────────────────

  private layer4(info: ContainerInfo): UniversalLayerResult {
    const t = Date.now();
    const data = { container: info.container, brand: info.brand ?? null,
      codecHint: info.codecHint ?? 'unknown',
      analysisMethod: 'binary_header_inspection',
      ffprobeAvailable: false,
      note: 'Enhanced frame-level analysis requires ffprobe (Phase 4+)' };
    const fingerprint = sha256(`${info.container}:${info.brand ?? ''}:${info.codecHint ?? ''}`);

    return { layer: 4, name: 'semantic', implementation: 'container_codec_fingerprint',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(buf: Buffer, info: ContainerInfo, mvhd: MvhdData): UniversalLayerResult {
    const t = Date.now();
    const data: Record<string, unknown> = {
      container: info.container,
      brand: info.brand ?? null,
      fileSizeBytes: buf.length,
      durationSeconds: mvhd.durationSeconds,
      timescale: mvhd.timescale,
      creationTime: mvhd.creationTime?.toISOString() ?? null,
      modificationTime: mvhd.modificationTime?.toISOString() ?? null,
    };

    // AVI: read RIFF chunk size
    if (info.container === 'AVI' && buf.length >= 8) {
      data['riffChunkSize'] = buf.readUInt32LE(4);
    }
    // WebM: read first EBML element size (approximate)
    if ((info.container === 'WEBM' || info.container === 'MKV') && buf.length >= 4) {
      data['ebmlVersion'] = buf[0];
    }

    const fingerprint = sha256(JSON.stringify({
      container: data['container'], durationSeconds: data['durationSeconds'],
      creationTime: data['creationTime'],
    }));

    return { layer: 5, name: 'metadata', implementation: 'video_container_metadata',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`VIDEO:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return { layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t };
  }

  private async runLayer(fn: () => UniversalLayerResult | Promise<UniversalLayerResult>): Promise<UniversalLayerResult> {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('Video layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
