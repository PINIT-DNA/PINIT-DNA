/**
 * Phase 2 — Audio DNA enhancements (spectrogram, Chromaprint, MFCC proxy).
 */
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { simHash64, sha256 } from '../engines/base/text-utils';
import { isFpcalcAvailable, extractAudioSample } from './media-tools.service';
import type { AudioDnaData } from '../../types/dna-enhancements.types';

function spectrogramFingerprint(buf: Buffer): string {
  const bands = 32;
  const bandSize = Math.max(1, Math.floor(buf.length / bands));
  const energies: number[] = [];
  for (let b = 0; b < bands; b++) {
    const start = b * bandSize;
    let sum = 0;
    for (let i = start; i < start + bandSize && i < buf.length; i++) {
      const v = buf[i] ?? 0;
      sum += v * v;
    }
    energies.push(Math.sqrt(sum / bandSize));
  }
  return sha256(energies.map((e) => e.toFixed(2)).join(',')).slice(0, 32);
}

function mfccProxy(buf: Buffer): string {
  const frames = 13;
  const frameSize = Math.max(1, Math.floor(buf.length / frames));
  const coeffs: number[] = [];
  for (let f = 0; f < frames; f++) {
    const slice = buf.slice(f * frameSize, (f + 1) * frameSize);
    const mean = slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
    coeffs.push(mean);
  }
  return simHash64(coeffs.map((c) => c.toFixed(0)).join(' '));
}

function noiseFingerprint(buf: Buffer): string {
  const sample = buf.slice(0, Math.min(buf.length, 8192));
  let variance = 0;
  const mean = sample.reduce((a, b) => a + b, 0) / (sample.length || 1);
  for (const b of sample) variance += (b - mean) ** 2;
  variance /= sample.length || 1;
  return sha256(`${mean.toFixed(2)}:${variance.toFixed(2)}`).slice(0, 16);
}

function voiceEmbeddingProxy(buf: Buffer): string {
  const low = buf.filter((_, i) => i % 3 === 0);
  const mid = buf.filter((_, i) => i % 3 === 1);
  const high = buf.filter((_, i) => i % 3 === 2);
  const profile = [low, mid, high].map((b) =>
    (b.reduce((a, x) => a + x, 0) / (b.length || 1)).toFixed(2),
  );
  return sha256(profile.join(':')).slice(0, 32);
}

function chromaprintFallback(buf: Buffer): string {
  return simHash64(
    Array.from({ length: 8 }, (_, i) => {
      const start = Math.floor((i / 8) * buf.length);
      return buf.slice(start, start + 4096).toString('base64').slice(0, 32);
    }).join(' '),
  );
}

export async function generateAudioDna(buffer: Buffer, tempPath?: string): Promise<AudioDnaData | undefined> {
  if (!isPhase2Active() || !dnaPhase2.audio) return undefined;

  const fpcalcOk = await isFpcalcAvailable();
  let chromaprint: string | undefined;

  if (fpcalcOk && tempPath) {
    try {
      const { runChromaprint } = await import('./media-tools.service');
      chromaprint = (await runChromaprint(tempPath)) ?? undefined;
    } catch {
      chromaprint = chromaprintFallback(buffer);
    }
  } else {
    chromaprint = chromaprintFallback(buffer);
  }

  const pcm = await extractAudioSample(buffer);
  const analysisBuf = pcm ?? buffer;

  return {
    spectrogramFingerprint: spectrogramFingerprint(analysisBuf),
    chromaprint,
    mfccFingerprint: mfccProxy(analysisBuf),
    voiceEmbedding: voiceEmbeddingProxy(analysisBuf),
    noiseFingerprint: noiseFingerprint(analysisBuf),
    chromaprintAvailable: fpcalcOk,
    algorithmVersion: fpcalcOk ? '2.2-chromaprint' : '2.2-spectral-fallback',
  };
}

export function verifyAudioDna(probe: AudioDnaData, stored: AudioDnaData): number {
  const scores: number[] = [];
  if (probe.chromaprint && stored.chromaprint) {
    scores.push(hammingSim(probe.chromaprint, stored.chromaprint));
  }
  if (probe.spectrogramFingerprint && stored.spectrogramFingerprint) {
    scores.push(probe.spectrogramFingerprint === stored.spectrogramFingerprint ? 1 : 0.5);
  }
  if (probe.mfccFingerprint && stored.mfccFingerprint) {
    scores.push(hammingSim(probe.mfccFingerprint, stored.mfccFingerprint));
  }
  if (probe.voiceEmbedding && stored.voiceEmbedding) {
    scores.push(probe.voiceEmbedding === stored.voiceEmbedding ? 1 : 0.4);
  }
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function hammingSim(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  if (!minLen) return 0;
  let dist = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return Math.max(0, 1 - dist / minLen);
}
