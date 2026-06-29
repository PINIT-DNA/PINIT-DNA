/**
 * PINIT-DNA — Phase 2 forensic enhancement feature flags (v2.2)
 * All OFF by default — requires DNA_ENHANCEMENTS_ENABLED + DNA_PHASE2_ENABLED.
 */
import { dnaEnhancements as base } from './dna-enhancements';

function flag(key: string, defaultValue = false): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

export const dnaPhase2 = {
  /** Master Phase 2 switch — OCR/Video/Audio/Screenshot DNA + adaptive scoring */
  enabled: flag('DNA_PHASE2_ENABLED', false),

  ocr: flag('DNA_P2_OCR', true),
  video: flag('DNA_P2_VIDEO', true),
  audio: flag('DNA_P2_AUDIO', true),
  screenshot: flag('DNA_P2_SCREENSHOT', true),
  screenRecording: flag('DNA_P2_SCREEN_RECORD', true),

  adaptiveScoring: flag('DNA_P2_ADAPTIVE_SCORE', true),
  explanation: flag('DNA_P2_EXPLANATION', true),
  evidenceConfidence: flag('DNA_P2_EVIDENCE', true),
  selfLearning: flag('DNA_P2_SELF_LEARNING', false),
  transformationHistory: flag('DNA_P2_TRANSFORM_HISTORY', true),
  crossMedia: flag('DNA_P2_CROSS_MEDIA', true),
  lightweightApi: flag('DNA_P2_LIGHTWEIGHT_API', true),

  /** Lazy OCR — skip when file has no text-like content heuristic */
  ocrLazy: flag('DNA_P2_OCR_LAZY', true),

  ffmpegPath: process.env['FFMPEG_PATH'] ?? 'ffmpeg',
  ffprobePath: process.env['FFPROBE_PATH'] ?? 'ffprobe',
  fpcalcPath: process.env['FPCALC_PATH'] ?? 'fpcalc',

  maxVideoKeyframes: parseInt(process.env['DNA_P2_VIDEO_KEYFRAMES'] ?? '8', 10),
  maxOcrChars: parseInt(process.env['DNA_P2_OCR_MAX_CHARS'] ?? '50000', 10),
} as const;

/** Phase 2 active only when both master switches are on */
export function isPhase2Active(): boolean {
  return base.enabled && dnaPhase2.enabled;
}

export type DnaPhase2Config = typeof dnaPhase2;
