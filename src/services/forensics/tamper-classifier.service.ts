/**
 * Tamper vector classification from layer score patterns.
 */
import type { LayerScoreInput, TamperClassificationResult, TamperVector } from '../../types/dna-enhancements.types';

export class TamperClassifierService {
  classify(layerScores: LayerScoreInput[], enhancedScores?: LayerScoreInput[]): TamperClassificationResult {
    const get = (name: string) =>
      layerScores.find((l) => l.layer === name)?.score
      ?? enhancedScores?.find((l) => l.layer.includes(name))?.score
      ?? 0;

    const crypto = get('cryptographic');
    const perceptual = get('perceptual');
    const structural = get('structural');
    const semantic = get('semantic');
    const metadata = get('metadata');
    const stego = get('steganography');
    const perceptualExt = get('perceptual_extended');

    const secondary: TamperVector[] = [];
    let primary: TamperVector = 'UNKNOWN_TAMPER';
    let tamperConfidence = 50;

    if (crypto >= 0.99 && perceptual >= 0.95) {
      primary = 'EXACT_COPY';
      tamperConfidence = 5;
    } else if (crypto >= 0.99 && perceptual < 0.95) {
      primary = 'METADATA_REMOVAL';
      tamperConfidence = 25;
    } else if (crypto < 0.5 && perceptual >= 0.85 && stego >= 0.5) {
      primary = 'COMPRESSION';
      secondary.push('REENCODE');
      tamperConfidence = 55;
    } else if (crypto < 0.3 && perceptual >= 0.75 && perceptual < 0.9) {
      primary = 'CROP';
      secondary.push('RESIZE');
      tamperConfidence = 60;
    } else if (perceptual >= 0.7 && perceptual < 0.82 && structural < 0.6) {
      primary = 'ROTATION';
      secondary.push('MIRROR');
      tamperConfidence = 58;
    } else if (perceptual >= 0.65 && semantic >= 0.6 && metadata < 0.3) {
      primary = 'COLOR_ADJUSTMENT';
      tamperConfidence = 52;
    } else if (perceptual >= 0.55 && perceptual < 0.75 && stego < 0.3) {
      primary = 'SCREENSHOT';
      tamperConfidence = 65;
    } else if (perceptual >= 0.5 && perceptualExt >= 0.5 && crypto < 0.2) {
      primary = 'SCREEN_RECORDING';
      secondary.push('REENCODE');
      tamperConfidence = 70;
    } else if (stego < 0.2 && perceptual >= 0.6) {
      primary = 'WATERMARK_REMOVAL';
      tamperConfidence = 68;
    } else if (perceptual >= 0.6 && perceptual < 0.8 && semantic < 0.5) {
      primary = 'AI_EDITING';
      tamperConfidence = 62;
    } else if (perceptual >= 0.72 && perceptualExt >= 0.8) {
      primary = 'AI_UPSCALE';
      tamperConfidence = 58;
    } else if (perceptual >= 0.45 && perceptual < 0.65) {
      primary = 'PARTIAL_CLIP';
      tamperConfidence = 72;
    } else if (crypto < 0.2 && perceptual < 0.5) {
      primary = 'NONE';
      tamperConfidence = 10;
    }

    return {
      primaryVector: primary,
      secondaryVectors: secondary,
      tamperConfidence,
      description: describeTamper(primary, secondary, tamperConfidence),
    };
  }
}

function describeTamper(primary: TamperVector, secondary: TamperVector[], confidence: number): string {
  const sec = secondary.length ? ` Secondary signals: ${secondary.join(', ')}.` : '';
  return `${primary.replace(/_/g, ' ')} detected (confidence ${confidence}%).${sec}`;
}

export const tamperClassifierService = new TamperClassifierService();
