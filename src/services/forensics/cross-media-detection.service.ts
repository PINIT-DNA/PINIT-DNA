/**
 * Phase 2 — Cross-media detection (video→screenshot, PDF→image, etc.).
 */
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import type {
  CrossMediaMatchResult,
  DnaEnhancementBundle,
} from '../../types/dna-enhancements.types';
import { verifyOcrDna } from './ocr-dna.service';
import { verifyScreenshotDna } from './screenshot-dna.service';
import { detectMediaProfile } from './adaptive-scoring.service';

export class CrossMediaDetectionService {
  detect(
    probeMime: string,
    probeFileType: string | undefined,
    probeBundle: DnaEnhancementBundle | undefined,
    storedMime: string,
    storedFileType: string | undefined,
    storedBundle: DnaEnhancementBundle | undefined,
  ): CrossMediaMatchResult | undefined {
    if (!isPhase2Active() || !dnaPhase2.crossMedia) return undefined;
    if (!probeBundle || !storedBundle) return undefined;

    const probeMedia = detectMediaProfile(probeMime, probeFileType);
    const storedMedia = detectMediaProfile(storedMime, storedFileType);
    if (probeMedia === storedMedia) return undefined;

    const matchedLayers: string[] = [];
    let confidence = 0;
    let relationship = `${storedMedia} → ${probeMedia}`;

    // Video → Screenshot / Image
    if (storedMedia === 'video' && probeMedia === 'image') {
      if (storedBundle.video && probeBundle.screenshot) {
        const vScore = verifyScreenshotDna(probeBundle.screenshot, {
          uiLayoutFingerprint: storedBundle.video.keyframeHashes?.[0],
          aspectRatioProfile: probeBundle.screenshot.aspectRatioProfile,
        } as typeof probeBundle.screenshot);
        if (vScore > 0.4) {
          matchedLayers.push('video_frame→screenshot');
          confidence = Math.max(confidence, vScore);
        }
      }
      if (storedBundle.video?.framePHashes?.length && probeBundle.perceptual?.bmHash64) {
        matchedLayers.push('frame_phash→perceptual');
        confidence = Math.max(confidence, 0.55);
      }
      relationship = 'Video frame captured as screenshot/image';
    }

    // PDF/Document → Image/Screenshot
    if (storedMedia === 'document' && probeMedia === 'image') {
      if (storedBundle.ocr && probeBundle.ocr) {
        const ocrScore = verifyOcrDna(probeBundle.ocr, storedBundle.ocr);
        if (ocrScore >= 0.6) {
          matchedLayers.push('ocr');
          confidence = Math.max(confidence, ocrScore);
        }
      }
      relationship = 'Document exported or photographed as image';
    }

    // Video → Screen recording variant
    if (storedMedia === 'video' && probeBundle.screenRecording) {
      if (storedBundle.screenRecording && probeBundle.screenRecording) {
        matchedLayers.push('screen_recording');
        confidence = Math.max(confidence, 0.5);
      }
      relationship = 'Video related to screen recording';
    }

    // Image → Video (slideshow/re-encode)
    if (storedMedia === 'image' && probeMedia === 'video' && storedBundle.perceptual && probeBundle.video) {
      matchedLayers.push('image→video_keyframe');
      confidence = Math.max(confidence, 0.45);
      relationship = 'Image re-encoded as video';
    }

    if (!matchedLayers.length || confidence < 0.4) {
      return { detected: false, sourceMedia: storedMedia, probeMedia, relationship, confidence: 0, matchedLayers: [] };
    }

    return {
      detected: true,
      sourceMedia: storedMedia,
      probeMedia,
      relationship,
      confidence: Math.round(confidence * 1000) / 1000,
      matchedLayers,
    };
  }
}

export const crossMediaDetectionService = new CrossMediaDetectionService();
