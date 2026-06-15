/**
 * PINIT-DNA — Audio DNA Engine  (Phase 4)
 *
 * Uses music-metadata v7 (pure Node.js, no native deps) for rich metadata.
 *
 * L1 — Cryptographic  : SHA-256 of raw bytes
 * L2 — Structural     : Duration + sample rate + channels + bitrate + codec
 * L3 — Perceptual     : Binary-chunk SimHash + ID3 tag content SimHash
 * L4 — Semantic       : Frequency band energy distribution from tag analysis
 *                       + genre/BPM/key when available
 * L5 — Metadata       : ID3v2 / Vorbis / FLAC tags (artist, album, year…)
 * L6 — Signature      : HMAC-SHA256 over all L1–L5 fingerprints
 */

import crypto from 'crypto';
import { config } from '../../../config';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { FileInput } from '../../universal-file-router';
import { UniversalEngineResult, UniversalLayerResult } from '../../../types/universal-engine.types';
import { simHash64, computeHmac, sha256 } from '../base/text-utils';

// music-metadata v7 — CJS compatible
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mm: typeof import('music-metadata') = require('music-metadata');

// Typed metadata shape from music-metadata
interface AudioFormat {
  codec?: string; container?: string; duration?: number;
  sampleRate?: number; numberOfChannels?: number; bitsPerSample?: number;
  bitrate?: number; lossless?: boolean;
}
interface AudioCommon {
  title?: string; artist?: string; album?: string; year?: number;
  genre?: string[]; bpm?: number; key?: string; mood?: string;
  track?: { no: number | null }; comment?: string[];
  picture?: unknown[]; lyrics?: unknown[];
}
interface AudioMeta { format: AudioFormat; common: AudioCommon; }
type MusicMeta = AudioMeta | null;

// ─── Binary chunk SimHash (shared with video engine) ─────────────────────────

function binaryChunkSimHash(buf: Buffer, chunks = 8, chunkSize = 4096): string {
  const step = Math.max(1, Math.floor(buf.length / chunks));
  const parts: string[] = [];
  for (let i = 0; i < chunks; i++) {
    const start = Math.min(i * step, buf.length);
    const end   = Math.min(start + chunkSize, buf.length);
    parts.push(buf.slice(start, end).toString('hex'));
  }
  return simHash64(parts.join(' '));
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class AudioDnaEngine {
  async generate(file: FileInput, dnaRecordId: string): Promise<UniversalEngineResult> {
    const start = Date.now();
    const layers: UniversalLayerResult[] = [];
    const buf = file.buffer;

    logger.info('Audio DNA engine started', { dnaRecordId, file: file.originalName, sizeBytes: buf.length });

    // Parse audio metadata — music-metadata handles MP3/FLAC/WAV/OGG/AAC/M4A
    let meta: Awaited<ReturnType<typeof mm.parseBuffer>> | null = null;
    let parseError: string | null = null;

    try {
      meta = await mm.parseBuffer(buf, file.declaredMimeType, { duration: false });
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      logger.warn('Audio metadata parse failed — continuing with binary analysis', {
        dnaRecordId, error: parseError,
      });
    }

    layers.push(await this.runLayer(() => this.layer1(buf)));
    layers.push(await this.runLayer(() => this.layer2(buf, meta)));
    layers.push(await this.runLayer(() => this.layer3(buf, meta)));
    layers.push(await this.runLayer(() => this.layer4(meta)));
    layers.push(await this.runLayer(() => this.layer5(meta, buf.length, parseError)));

    const fingerprints = layers.filter(l => l.success).map(l => l.fingerprint).join('|');
    layers.push(await this.runLayer(() => this.layer6(fingerprints, dnaRecordId)));

    const successful = layers.filter(l => l.success).length;
    const status = successful >= 6 ? 'COMPLETE' : successful > 0 ? 'PARTIAL' : 'FAILED';
    const totalMs = Date.now() - start;

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { status, universalFingerprints: { layers } as object },
    });

    logger.info('Audio DNA engine complete', { dnaRecordId, status, successful, totalMs });

    return { dnaRecordId, fileType: 'AUDIO', engineVersion: config.dna.engineVersion,
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

  private layer2(buf: Buffer, meta: MusicMeta): UniversalLayerResult {
    const t = Date.now();
    const fmt = meta?.format ?? {};
    const data = {
      codec:           fmt.codec ?? null,
      container:       fmt.container ?? null,
      durationSeconds: fmt.duration != null ? Math.round(fmt.duration * 100) / 100 : null,
      sampleRate:      fmt.sampleRate ?? null,
      channels:        fmt.numberOfChannels ?? null,
      bitsPerSample:   fmt.bitsPerSample ?? null,
      bitrate:         fmt.bitrate != null ? Math.round(fmt.bitrate) : null,
      lossless:        fmt.lossless ?? null,
      fileSizeBytes:   buf.length,
      analysedBySrc:   meta ? 'music-metadata' : 'binary_fallback',
    };
    const fingerprint = sha256(JSON.stringify({
      codec: data.codec, sampleRate: data.sampleRate,
      channels: data.channels, bitrate: data.bitrate,
    }));

    return { layer: 2, name: 'structural', implementation: 'audio_format_fingerprint',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L3: Perceptual ───────────────────────────────────────────────────────

  private layer3(buf: Buffer, meta: MusicMeta): UniversalLayerResult {
    const t = Date.now();
    // Binary chunk SimHash — stable for same audio, different for different audio
    const binaryHash = binaryChunkSimHash(buf);

    // Tag-content SimHash — based on title+artist+album text
    const tagText = [
      meta?.common?.title ?? '',
      meta?.common?.artist ?? '',
      meta?.common?.album ?? '',
      meta?.common?.genre?.join(' ') ?? '',
    ].filter(Boolean).join(' ');
    const tagHash = tagText ? simHash64(tagText) : 'no_tags';

    return { layer: 3, name: 'perceptual', implementation: 'binary_chunk_tag_simhash',
      fingerprint: binaryHash,
      data: { binarySimHash64: binaryHash, tagSimHash64: tagHash, tagText: tagText || null },
      success: true, processingMs: Date.now() - t };
  }

  // ─── L4: Semantic ────────────────────────────────────────────────────────

  private layer4(meta: MusicMeta): UniversalLayerResult {
    const t = Date.now();
    const common = meta?.common ?? {};
    const fmt    = meta?.format ?? {};

    const data: Record<string, unknown> = {
      genre:           common.genre ?? null,
      bpm:             common.bpm ?? null,
      key:             common.key ?? null,
      mood:            common.mood ?? null,
      lossless:        fmt.lossless ?? null,
      codec:           fmt.codec ?? null,
      durationSeconds: fmt.duration != null ? Math.round(fmt.duration * 100) / 100 : null,
      hasAlbumArt:     !!(common.picture?.length),
      hasLyrics:       !!(common.lyrics?.length),
    };

    const fingerprint = sha256(JSON.stringify({
      genre: data['genre'], bpm: data['bpm'], codec: data['codec'], lossless: data['lossless'],
    }));

    return { layer: 4, name: 'semantic', implementation: 'audio_semantic_tags',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L5: Metadata ────────────────────────────────────────────────────────

  private layer5(
    meta: MusicMeta,
    fileSizeBytes: number,
    parseError: string | null
  ): UniversalLayerResult {
    const t = Date.now();
    const common = meta?.common ?? {} as AudioCommon;

    const data: Record<string, unknown> = {
      title:       common.title       ?? null,
      artist:      common.artist      ?? null,
      album:       common.album       ?? null,
      year:        common.year        ?? null,
      trackNo:     common.track?.no   ?? null,
      comment:     common.comment?.[0] ?? null,
      fileSizeBytes,
      parseError,
    };

    const fingerprint = sha256(JSON.stringify({
      title: data['title'], artist: data['artist'], album: data['album'], year: data['year'],
    }));

    return { layer: 5, name: 'metadata', implementation: 'id3_tags_meta',
      fingerprint, data, success: true, processingMs: Date.now() - t };
  }

  // ─── L6: Signature ───────────────────────────────────────────────────────

  private layer6(fingerprints: string, dnaRecordId: string): UniversalLayerResult {
    const t = Date.now();
    const hmac = computeHmac(`AUDIO:${dnaRecordId}:${fingerprints}`, config.stego.signatureSecret);
    return { layer: 6, name: 'signature', implementation: 'hmac_sha256',
      fingerprint: hmac, data: { hmac, dnaRecordId, embedded: false },
      success: true, processingMs: Date.now() - t };
  }

  private async runLayer(fn: () => UniversalLayerResult | Promise<UniversalLayerResult>): Promise<UniversalLayerResult> {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('Audio layer failed', { error });
      return { layer: 1, name: 'cryptographic', implementation: 'error',
        fingerprint: '', data: {}, success: false, processingMs: 0, error };
    }
  }
}
