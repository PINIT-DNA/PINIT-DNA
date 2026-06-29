/**
 * Phase 2 — Adaptive weighted scoring by media profile.
 */
import type { LayerScoreInput, MediaProfile, WeightedDnaScoreResult } from '../../types/dna-enhancements.types';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { weightedDnaScoringService } from './weighted-dna-scoring.service';
import type { DnaEnhancementBundle } from '../../types/dna-enhancements.types';
import { verifyOcrDna } from './ocr-dna.service';
import { verifyVideoDna } from './video-dna-enhancements.service';
import { verifyAudioDna } from './audio-dna-enhancements.service';
import { verifyScreenshotDna } from './screenshot-dna.service';
import { verifyScreenRecordingDna } from './screen-recording-dna.service';

const PROFILES: Record<MediaProfile, Record<string, number>> = {
  image: {
    perceptual: 0.40,
    semantic: 0.30,
    ocr: 0.15,
    metadata: 0.05,
    steganography: 0.10,
  },
  document: {
    ocr: 0.45,
    semantic: 0.25,
    cryptographic: 0.15,
    metadata: 0.10,
    steganography: 0.05,
  },
  video: {
    video_frame: 0.40,
    audio: 0.35,
    steganography: 0.15,
    metadata: 0.10,
  },
  audio: {
    audio: 0.50,
    semantic: 0.20,
    cryptographic: 0.15,
    metadata: 0.10,
    steganography: 0.05,
  },
  unknown: {
    cryptographic: 0.22,
    perceptual: 0.22,
    semantic: 0.12,
    metadata: 0.05,
    steganography: 0.10,
  },
};

export function detectMediaProfile(
  mimeType: string,
  fileType?: string,
): MediaProfile {
  if (fileType === 'VIDEO' || mimeType.startsWith('video/')) return 'video';
  if (fileType === 'AUDIO' || mimeType.startsWith('audio/')) return 'audio';
  if (['PDF', 'DOCX', 'PPTX', 'TXT', 'CSV'].includes(fileType ?? '')) return 'document';
  if (mimeType.startsWith('image/') || fileType === 'IMAGE') return 'image';
  return 'unknown';
}

export class AdaptiveScoringService {
  compute(
    mediaProfile: MediaProfile,
    coreLayerScores: LayerScoreInput[],
    probeEnhancements?: DnaEnhancementBundle,
    storedEnhancements?: DnaEnhancementBundle,
  ): WeightedDnaScoreResult & { mediaProfile: MediaProfile } {
    if (!isPhase2Active() || !dnaPhase2.adaptiveScoring) {
      const base = weightedDnaScoringService.compute(coreLayerScores, probeEnhancements, storedEnhancements);
      return { ...base, mediaProfile };
    }

    const weights = PROFILES[mediaProfile] ?? PROFILES.unknown;
    const phase2Scores = this.buildPhase2Scores(probeEnhancements, storedEnhancements);

    let weightedSum = 0;
    let weightTotal = 0;
    const enhancedLayerScores: LayerScoreInput[] = [];

    for (const ls of coreLayerScores) {
      const w = weights[ls.layer] ?? 0;
      if (w > 0) {
        weightedSum += ls.score * w;
        weightTotal += w;
      }
    }

    for (const ps of phase2Scores) {
      const w = weights[ps.layer] ?? ps.weight;
      enhancedLayerScores.push({ ...ps, weight: w });
      weightedSum += ps.score * w;
      weightTotal += w;
    }

    const overallMatchScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const stego = coreLayerScores.find((l) => l.layer === 'steganography')?.score ?? 0;
    const crypto = coreLayerScores.find((l) => l.layer === 'cryptographic')?.score ?? 0;

    return {
      overallMatchScore: Math.round(overallMatchScore * 1000) / 1000,
      ownershipConfidence: Math.min(100, Math.round(overallMatchScore * 70 + stego * 20 + (crypto >= 1 ? 10 : 0))),
      tamperConfidence: Math.min(100, Math.round((1 - crypto) * 40 + (1 - overallMatchScore) * 30)),
      layerScores: coreLayerScores,
      enhancedLayerScores: enhancedLayerScores.length ? enhancedLayerScores : undefined,
      mediaProfile,
    };
  }

  private buildPhase2Scores(
    probe?: DnaEnhancementBundle,
    stored?: DnaEnhancementBundle,
  ): LayerScoreInput[] {
    if (!probe || !stored) return [];
    const out: LayerScoreInput[] = [];

    if (probe.ocr && stored.ocr) {
      const score = verifyOcrDna(probe.ocr, stored.ocr);
      out.push({ layer: 'ocr', score, weight: 0.15, passed: score >= 0.7 });
    }
    if (probe.video && stored.video) {
      const score = verifyVideoDna(probe.video, stored.video);
      out.push({ layer: 'video_frame', score, weight: 0.4, passed: score >= 0.65 });
    }
    if (probe.audio && stored.audio) {
      const score = verifyAudioDna(probe.audio, stored.audio);
      out.push({ layer: 'audio', score, weight: 0.35, passed: score >= 0.65 });
    }
    if (probe.screenshot && stored.screenshot) {
      const score = verifyScreenshotDna(probe.screenshot, stored.screenshot);
      out.push({ layer: 'screenshot', score, weight: 0.1, passed: score >= 0.6 });
    }
    if (probe.screenRecording && stored.screenRecording) {
      const score = verifyScreenRecordingDna(probe.screenRecording, stored.screenRecording);
      out.push({ layer: 'screen_recording', score, weight: 0.1, passed: score >= 0.6 });
    }
    return out;
  }
}

export const adaptiveScoringService = new AdaptiveScoringService();
