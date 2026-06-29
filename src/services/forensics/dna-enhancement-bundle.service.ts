/**
 * Build & parse DnaRecord.universalFingerprints.enhancements bundle.
 */
import { dnaEnhancements } from '../../config/dna-enhancements';
import { isPhase2Active } from '../../config/dna-phase2';
import type { DnaEnhancementBundle } from '../../types/dna-enhancements.types';
import { computeBlake3Hex } from './blake3.service';
import { generateCryptoEnhancements } from './crypto-enhancements';
import { generatePerceptualEnhancements } from './perceptual-enhancements';
import { generateMetadataEnhancements } from './metadata-enhancements';
import { generateSemanticEnhancements } from './semantic-enhancements';
import { generateStructuralEnhancements } from './structural-enhancements';
import { generateOcrDna } from './ocr-dna.service';
import { generateVideoDna } from './video-dna-enhancements.service';
import { generateAudioDna } from './audio-dna-enhancements.service';
import { generateScreenshotDna } from './screenshot-dna.service';
import { generateScreenRecordingDna } from './screen-recording-dna.service';
import { detectMediaProfile } from './adaptive-scoring.service';

export interface EnhancementBuildContext {
  mimeType: string;
  fileType?: string;
  tempPath?: string;
}

export async function buildEnhancementBundle(
  buffer: Buffer,
  ctx?: EnhancementBuildContext,
): Promise<DnaEnhancementBundle | undefined> {
  if (!dnaEnhancements.enabled) return undefined;

  const mimeType = ctx?.mimeType ?? 'application/octet-stream';
  const fileType = ctx?.fileType;
  const mediaProfile = detectMediaProfile(mimeType, fileType);
  const isImage = mediaProfile === 'image';
  const phase2 = isPhase2Active();

  const crypto = generateCryptoEnhancements(buffer);

  const [perceptual, structural, semantic, metadata] = isImage
    ? await Promise.all([
        generatePerceptualEnhancements(buffer),
        generateStructuralEnhancements(buffer),
        generateSemanticEnhancements(buffer),
        generateMetadataEnhancements(buffer),
      ])
    : [undefined, undefined, undefined, undefined];

  let ocr: DnaEnhancementBundle['ocr'];
  let screenshot: DnaEnhancementBundle['screenshot'];
  let video: DnaEnhancementBundle['video'];
  let screenRecording: DnaEnhancementBundle['screenRecording'];
  let audio: DnaEnhancementBundle['audio'];

  if (phase2) {
    if (isImage || mediaProfile === 'document') {
      ocr = await generateOcrDna(buffer, mimeType);
      if (isImage) screenshot = await generateScreenshotDna(buffer, mimeType);
    }
    if (mediaProfile === 'video') {
      [video, screenRecording] = await Promise.all([
        generateVideoDna(buffer),
        generateScreenRecordingDna(buffer, ctx?.tempPath),
      ]);
    }
    if (mediaProfile === 'audio') {
      audio = await generateAudioDna(buffer, ctx?.tempPath);
    }
  }

  const bundle: DnaEnhancementBundle = {
    version: phase2 ? '2.2' : '2.1',
    generatedAt: new Date().toISOString(),
    crypto,
    perceptual,
    structural,
    semantic,
    metadata,
    ocr,
    screenshot,
    video,
    screenRecording,
    audio,
  };

  const hasData = [crypto, perceptual, structural, semantic, metadata, ocr, screenshot, video, screenRecording, audio]
    .some((v) => v !== undefined);
  return hasData ? bundle : undefined;
}

export function parseEnhancementBundle(universalFingerprints: unknown): DnaEnhancementBundle | undefined {
  if (!universalFingerprints || typeof universalFingerprints !== 'object') return undefined;
  const fp = universalFingerprints as Record<string, unknown>;
  const enh = fp['enhancements'];
  if (!enh || typeof enh !== 'object') return undefined;
  return enh as DnaEnhancementBundle;
}

export function mergeUniversalFingerprints(
  existing: unknown,
  bundle: DnaEnhancementBundle | undefined,
): Record<string, unknown> {
  const base = (existing && typeof existing === 'object' ? { ...(existing as object) } : {}) as Record<string, unknown>;
  if (bundle) base.enhancements = bundle;
  return base;
}

export function computeLayer1Blake3(buffer: Buffer): string | null {
  if (!dnaEnhancements.enabled || !dnaEnhancements.layer1.blake3) return null;
  const h = computeBlake3Hex(buffer);
  return h ? h.slice(0, 64) : null;
}
