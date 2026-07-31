/**
 * Video Asset DNA — reuses existing forensic video pipeline (no duplicate engines).
 */
import { generateInvestigationVideoDna } from '../forensics/video-dna-enhancements.service';
import { isFfmpegAvailable } from '../forensics/media-tools.service';
import { logger } from '../../lib/logger';

export interface VideoAssetDnaResult {
  engine: 'investigation-video-dna';
  ffmpegAvailable: boolean;
  keyframeCount: number;
  keyframeHashes: string[];
  framePHashes: string[];
  sceneFingerprints: string[];
  audioFingerprint?: string;
  motionFingerprint?: string;
  gopFingerprint?: string;
  fps?: number;
  raw: Record<string, unknown>;
}

export async function buildVideoAssetDna(buffer: Buffer): Promise<VideoAssetDnaResult> {
  const ffmpegAvailable = await isFfmpegAvailable();
  const dna = await generateInvestigationVideoDna(buffer);
  const raw = dna as unknown as Record<string, unknown>;
  const keyframeHashes = (raw.keyframeHashes as string[]) || (raw.keyframe_hashes as string[]) || [];
  const framePHashes = (raw.framePHashes as string[]) || (raw.frame_phashes as string[]) || [];
  const sceneFingerprints = (raw.sceneFingerprints as string[]) || (raw.scene_fingerprints as string[]) || [];

  logger.info('[VideoAssetDna] generated', {
    ffmpegAvailable,
    keyframes: keyframeHashes.length,
  });

  return {
    engine: 'investigation-video-dna',
    ffmpegAvailable,
    keyframeCount: keyframeHashes.length,
    keyframeHashes,
    framePHashes,
    sceneFingerprints,
    audioFingerprint: (raw.audioFingerprint as string) || (raw.audio_fingerprint as string) || undefined,
    motionFingerprint: (raw.motionFingerprint as string) || (raw.motion_fingerprint as string) || undefined,
    gopFingerprint: (raw.gopFingerprint as string) || (raw.gop_fingerprint as string) || undefined,
    fps: typeof raw.fps === 'number' ? raw.fps : undefined,
    raw,
  };
}

/** Compare two video DNA fingerprints (frames + audio + motion). */
export function compareVideoAssetDna(
  a: Partial<VideoAssetDnaResult>,
  b: Partial<VideoAssetDnaResult>,
): { similarity: number; frameOverlap: number; audioMatch: boolean; reasons: string[] } {
  const aKeys = a.keyframeHashes || [];
  const bKeys = b.keyframeHashes || [];
  const bSet = new Set(bKeys);
  let overlap = 0;
  for (const h of aKeys) if (bSet.has(h)) overlap += 1;
  const denom = Math.max(1, Math.min(aKeys.length, bKeys.length) || 1);
  const frameScore = overlap / denom;

  const aPh = new Set(a.framePHashes || []);
  let phOverlap = 0;
  for (const h of b.framePHashes || []) if (aPh.has(h)) phOverlap += 1;
  const phScore = phOverlap / Math.max(1, Math.min((a.framePHashes || []).length, (b.framePHashes || []).length) || 1);

  const audioMatch = !!(a.audioFingerprint && b.audioFingerprint && a.audioFingerprint === b.audioFingerprint);
  const motionMatch = !!(a.motionFingerprint && b.motionFingerprint && a.motionFingerprint === b.motionFingerprint);

  let similarity = frameScore * 0.45 + phScore * 0.35;
  if (audioMatch) similarity += 0.12;
  if (motionMatch) similarity += 0.08;
  similarity = Math.min(1, similarity);

  const reasons: string[] = [];
  if (frameScore > 0) reasons.push(`Keyframe overlap ${(frameScore * 100).toFixed(0)}%`);
  if (phScore > 0) reasons.push(`Perceptual frame overlap ${(phScore * 100).toFixed(0)}%`);
  if (audioMatch) reasons.push('Audio fingerprint match');
  if (motionMatch) reasons.push('Motion fingerprint match');

  return { similarity, frameOverlap: overlap, audioMatch, reasons };
}
