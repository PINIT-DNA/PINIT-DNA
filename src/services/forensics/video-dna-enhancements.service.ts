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
    keyframeHashes = binaryKeyframeHashes(buffer, count);
    framePHashes = keyframeHashes;
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
