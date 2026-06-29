/**
 * Phase 2 — DNA Explanation Engine (why a file matched or failed).
 */
import type {
  DnaExplanationResult,
  DnaExplanationLine,
  LayerScoreInput,
  DnaEnhancementBundle,
} from '../../types/dna-enhancements.types';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';

const LAYER_LABELS: Record<string, string> = {
  cryptographic: 'SHA256',
  structural: 'Structural',
  perceptual: 'Perceptual',
  semantic: 'Semantic',
  metadata: 'Metadata',
  steganography: 'Watermark',
  ocr: 'OCR',
  video_frame: 'Video Frames',
  audio: 'Audio',
  screenshot: 'Screenshot',
  screen_recording: 'Screen Recording',
  crypto_extended: 'SHA3/BLAKE3',
  perceptual_extended: 'BM/Wavelet Hash',
  structural_extended: 'Multi-scale Structural',
  semantic_extended: 'LAB Color',
  metadata_extended: 'Extended EXIF',
};

export class DnaExplanationService {
  explain(
    overallConfidence: number,
    coreScores: LayerScoreInput[],
    enhancedScores?: LayerScoreInput[],
    bundle?: DnaEnhancementBundle,
  ): DnaExplanationResult | undefined {
    if (!isPhase2Active() || !dnaPhase2.explanation) return undefined;

    const all = [...coreScores, ...(enhancedScores ?? [])];
    const matchedBecause: DnaExplanationLine[] = [];
    const failedBecause: DnaExplanationLine[] = [];

    for (const ls of all) {
      const label = LAYER_LABELS[ls.layer] ?? ls.layer;
      const line: DnaExplanationLine = {
        layer: ls.layer,
        label,
        matched: ls.passed,
        score: ls.score,
        detail: ls.passed
          ? `${label} matched (${Math.round(ls.score * 100)}%)`
          : `${label} below threshold (${Math.round(ls.score * 100)}%)`,
      };
      if (ls.passed || ls.score >= 0.7) matchedBecause.push(line);
      else failedBecause.push(line);
    }

    if (bundle?.ocr && !matchedBecause.some((l) => l.layer === 'ocr')) {
      failedBecause.push({
        layer: 'ocr',
        label: 'OCR',
        matched: false,
        score: 0,
        detail: 'OCR text differs or unavailable',
      });
    }

    const summary = this.buildSummary(overallConfidence, matchedBecause, failedBecause);

    return {
      summary,
      matchedBecause,
      failedBecause,
      overallConfidence: Math.round(overallConfidence * 1000) / 10,
    };
  }

  private buildSummary(
    confidence: number,
    matched: DnaExplanationLine[],
    failed: DnaExplanationLine[],
  ): string {
    const pct = (confidence * 100).toFixed(1);
    const hits = matched.map((m) => m.label).join(', ');
    const misses = failed.filter((f) => f.layer === 'metadata' || f.layer === 'metadata_extended')
      .map((f) => f.label)
      .join(', ');
    let s = `Overall confidence ${pct}%. Matched because: ${hits || 'partial signals'}.`;
    if (misses) s += ` Not matched: ${misses} removed or altered.`;
    return s;
  }
}

export const dnaExplanationService = new DnaExplanationService();
