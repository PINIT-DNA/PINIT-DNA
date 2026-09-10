/**
 * Phase 2 — Video DNA enhancements (keyframes, scenes, motion, GOP).
 */
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { simHash64, sha256 } from '../engines/base/text-utils';
import { computeBmHash64 } from './perceptual-enhancements';
import {
  extractVideoFrameSamples,
  isFfmpegAvailable,
  probeVideoFps,
  extractAudioSample,
} from './media-tools.service';
import type { VideoDnaData } from '../../types/dna-enhancements.types';

function binaryKeyframeHashes(buf: Buffer, count: number): string[] {
  const step = Math.max(1, Math.floor(buf.length / count));
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.min(i * step, buf.length - 4096);
    const chunk = buf.slice(Math.max(0, start), start + 4096);
    hashes.push(sha256(chunk).slice(0, 16));
  }
  return hashes;
}

function motionFingerprint(buf: Buffer): string {
  const samples = 16;
  const step = Math.max(1, Math.floor(buf.length / samples));
  const deltas: number[] = [];
  for (let i = 1; i < samples; i++) {
    const a = buf[i * step] ?? 0;
    const b = buf[(i - 1) * step] ?? 0;
    deltas.push(Math.abs(a - b));
  }
  return sha256(deltas.join(',')).slice(0, 32);
}

function gopFingerprint(buf: Buffer): string {
  const pattern: string[] = [];
  const search = Math.min(buf.length, 512 * 1024);
  for (let i = 0; i < search - 4; i += 4096) {
    const slice = buf.slice(i, i + 4);
    pattern.push(slice.toString('hex'));
  }
  return simHash64(pattern.join(' '));
}

export async function generateVideoDna(buffer: Buffer): Promise<VideoDnaData | undefined> {
  if (!isPhase2Active() || !dnaPhase2.video) return undefined;
  return generateInvestigationVideoDna(buffer);
}

/** Investigation pipeline — always attempts ffmpeg keyframes (not gated on DNA_PHASE2). */
export async function generateInvestigationVideoDna(buffer: Buffer, _ext = 'mp4'): Promise<VideoDnaData> {
  const ffmpegOk = await isFfmpegAvailable();
  const count = dnaPhase2.maxVideoKeyframes;
  let keyframeHashes: string[] = [];
  let framePHashes: string[] = [];

  if (ffmpegOk) {
    const frames = await extractVideoFrameSamples(buffer, count);
    keyframeHashes = await Promise.all(
      frames.map(async (f) => sha256(f).slice(0, 16)),
    );
    framePHashes = await Promise.all(
      frames.map(async (f) => computeBmHash64(f)),
    );
  } else {
    // Without ffmpeg we cannot decode frames, so there are no perceptual hashes.
    // These container-byte SHA slices are still useful as a coarse identity signal,
    // but they must NOT be presented as framePHashes: they are 16-hex like a real
    // Block-Mean-Hash-64, so every downstream hamming comparator would accept them
    // and compare meaningless bits. Leaving the array empty makes "not available"
    // distinguishable from "computed"; `algorithmVersion` records which path ran.
    keyframeHashes = binaryKeyframeHashes(buffer, count);
    framePHashes = [];
  }

  const sceneFingerprints = keyframeHashes.length >= 2
    ? keyframeHashes.slice(0, -1).map((h, i) =>
        sha256(`${h}:${keyframeHashes[i + 1]}`).slice(0, 16),
      )
    : keyframeHashes;

  let audioFingerprint: string | undefined;
  const audioSample = await extractAudioSample(buffer);
  if (audioSample) {
    audioFingerprint = sha256(audioSample.slice(0, 65536)).slice(0, 32);
  }

  return {
    keyframeHashes,
    sceneFingerprints,
    motionFingerprint: motionFingerprint(buffer),
    framePHashes,
    gopFingerprint: gopFingerprint(buffer),
    audioFingerprint,
    ffmpegAvailable: ffmpegOk,
    algorithmVersion: ffmpegOk ? '2.2-ffmpeg' : '2.2-binary-fallback',
  };
}

/** One probe frame matched this closely against the best stored frame. */
const STRONG_FRAME_SIMILARITY = 0.68;

export interface VideoFrameComparison {
  /** Fraction of probe frames that found a strong match [0,1]. */
  similarity: number;
  strongMatches: number;
  comparedFrames: number;
}

/**
 * Compare two sets of keyframe perceptual hashes.
 *
 * Asymmetric nearest-neighbour, matching how `comparePartialVideoFrames` scores an
 * investigation: each probe frame takes its best match among the stored frames, and
 * the score is the share of probe frames that clear the strong threshold. Asymmetric
 * because a trimmed or partial re-upload has fewer frames than the original, and
 * should still score highly on the frames it does contain.
 *
 * Returns 0 when either side is empty — a record produced without ffmpeg carries no
 * frame hashes, and must never be able to match anything.
 */
export function compareVideoFrameHashes(
  probeHashes: string[] | undefined | null,
  storedHashes: string[] | undefined | null,
): VideoFrameComparison {
  const probe = (probeHashes ?? []).filter(Boolean);
  const stored = (storedHashes ?? []).filter(Boolean);
  if (!probe.length || !stored.length) {
    return { similarity: 0, strongMatches: 0, comparedFrames: 0 };
  }

  let strongMatches = 0;
  for (const p of probe) {
    let best = 0;
    for (const s of stored) {
      if (p.length !== s.length) continue;
      const sim = hammingSim(p, s);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    if (best >= STRONG_FRAME_SIMILARITY) strongMatches++;
  }

  return {
    similarity: strongMatches / probe.length,
    strongMatches,
    comparedFrames: probe.length,
  };
}

export function verifyVideoDna(probe: VideoDnaData, stored: VideoDnaData): number {
  const scores: number[] = [];

  if (probe.keyframeHashes?.length && stored.keyframeHashes?.length) {
    scores.push(setOverlap(probe.keyframeHashes, stored.keyframeHashes));
  }
  if (probe.framePHashes?.length && stored.framePHashes?.length) {
    scores.push(setOverlap(probe.framePHashes, stored.framePHashes));
  }
  if (probe.motionFingerprint && stored.motionFingerprint) {
    scores.push(probe.motionFingerprint === stored.motionFingerprint ? 1 : 0.5);
  }
  if (probe.gopFingerprint && stored.gopFingerprint) {
    scores.push(hammingSim(probe.gopFingerprint, stored.gopFingerprint));
  }
  if (probe.audioFingerprint && stored.audioFingerprint) {
    scores.push(probe.audioFingerprint === stored.audioFingerprint ? 1 : 0.4);
  }

  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function setOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  const matches = a.filter((h) => setB.has(h)).length;
  return matches / Math.max(a.length, b.length);
}

function hammingSim(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return Math.max(0, 1 - dist / (a.length * 4));
}

/** Screen recording detection from video buffer */
export async function detectScreenRecordingFromVideo(buffer: Buffer): Promise<number> {
  const fps = await probeVideoFps(buffer);
  const motion = motionFingerprint(buffer);
  let score = 0.3;
  if (fps && fps <= 30) score += 0.2;
  if (motion.length > 0) score += 0.2;
  return Math.min(1, score);
}
