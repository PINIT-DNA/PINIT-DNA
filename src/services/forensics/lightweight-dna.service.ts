/**
 * Phase 2 — Lightweight DNA for Internet Intelligence integration.
 * Fast fingerprint extraction without full 15-layer pipeline.
 */
import crypto from 'crypto';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { detectMediaProfile } from './adaptive-scoring.service';
import { generateOcrDna } from './ocr-dna.service';
import { generateVideoDna } from './video-dna-enhancements.service';
import { generateAudioDna } from './audio-dna-enhancements.service';
import { computeBmHash64 } from './perceptual-enhancements';
import { simHash64 } from '../engines/base/text-utils';
import type { LightweightDnaFingerprint } from '../../types/dna-enhancements.types';

export async function generateLightweightDna(
  buffer: Buffer,
  mimeType: string,
  fileType?: string,
): Promise<LightweightDnaFingerprint> {
  const mediaProfile = detectMediaProfile(mimeType, fileType);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const lite: LightweightDnaFingerprint = {
    version: '2.2-lite',
    mediaProfile,
    sha256,
    generatedAt: new Date().toISOString(),
  };

  if (!isPhase2Active() || !dnaPhase2.lightweightApi) {
    lite.simHash = simHash64(sha256);
    return lite;
  }

  if (mediaProfile === 'image') {
    lite.pHash = await computeBmHash64(buffer);
    const ocr = await generateOcrDna(buffer, mimeType);
    lite.ocrSimHash = ocr?.ocrSimHash;
  } else if (mediaProfile === 'video') {
    const video = await generateVideoDna(buffer);
    lite.keyframeHash = video?.keyframeHashes?.[0];
    lite.pHash = video?.framePHashes?.[0];
  } else if (mediaProfile === 'audio') {
    const audio = await generateAudioDna(buffer);
    lite.audioFingerprint = audio?.chromaprint ?? audio?.spectrogramFingerprint;
  } else if (mediaProfile === 'document') {
    const ocr = await generateOcrDna(buffer, mimeType);
    lite.ocrSimHash = ocr?.ocrSimHash;
    lite.simHash = ocr?.ocrSimHash ?? simHash64(sha256);
  } else {
    lite.simHash = simHash64(sha256);
  }

  return lite;
}

export function compareLightweightDna(
  a: LightweightDnaFingerprint,
  b: LightweightDnaFingerprint,
): { score: number; matchedFields: string[] } {
  const scores: { field: string; score: number }[] = [];

  if (a.sha256 === b.sha256) scores.push({ field: 'sha256', score: 1 });
  if (a.pHash && b.pHash) scores.push({ field: 'pHash', score: a.pHash === b.pHash ? 1 : hamming(a.pHash, b.pHash) });
  if (a.ocrSimHash && b.ocrSimHash) scores.push({ field: 'ocr', score: a.ocrSimHash === b.ocrSimHash ? 1 : hamming(a.ocrSimHash, b.ocrSimHash) });
  if (a.keyframeHash && b.keyframeHash) scores.push({ field: 'keyframe', score: a.keyframeHash === b.keyframeHash ? 1 : 0.5 });
  if (a.audioFingerprint && b.audioFingerprint) scores.push({ field: 'audio', score: a.audioFingerprint === b.audioFingerprint ? 1 : 0.5 });
  if (a.simHash && b.simHash) scores.push({ field: 'simHash', score: hamming(a.simHash, b.simHash) });

  if (!scores.length) return { score: 0, matchedFields: [] };
  const avg = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  return {
    score: Math.round(avg * 1000) / 1000,
    matchedFields: scores.filter((s) => s.score >= 0.7).map((s) => s.field),
  };
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return Math.max(0, 1 - dist / (a.length * 4));
}

export async function extractImageFingerprint(buffer: Buffer, mimeType: string) {
  const lite = await generateLightweightDna(buffer, mimeType, 'IMAGE');
  return { pHash: lite.pHash, ocrSimHash: lite.ocrSimHash, sha256: lite.sha256 };
}

export async function extractVideoFingerprint(buffer: Buffer) {
  const video = await generateVideoDna(buffer);
  return {
    keyframeHashes: video?.keyframeHashes,
    framePHashes: video?.framePHashes,
    motionFingerprint: video?.motionFingerprint,
    ffmpegAvailable: video?.ffmpegAvailable,
  };
}

export async function extractAudioFingerprint(buffer: Buffer, tempPath?: string) {
  const audio = await generateAudioDna(buffer, tempPath);
  return {
    chromaprint: audio?.chromaprint,
    spectrogramFingerprint: audio?.spectrogramFingerprint,
    mfccFingerprint: audio?.mfccFingerprint,
  };
}
