/**
 * Video investigation compare — keyframe perceptual + audio + structural.
 * Used ONLY for video/audio probe paths; image compare is unchanged.
 */
import crypto from 'crypto';
import { logger } from '../../lib/logger';
import { isFfmpegAvailable } from './media-tools.service';
import {
  comparePartialVideoProbeToVault,
  partialVideoToRetrievalScores,
} from './partial-video-recovery.service';
import type { DnaComparisonResult, LayerComparisonResult, DnaClassification } from '../../types/comparison.types';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';

const INVESTIGATION_KEYFRAMES_PROBE = 16;
const INVESTIGATION_KEYFRAMES_VAULT = 24;

export interface VideoForensicScores {
  sha256Exact: boolean;
  perceptualScore: number;
  structuralScore: number;
  audioScore: number;
  phase2Score: number;
  ffmpegUsed: boolean;
  keyframeCountA: number;
  keyframeCountB: number;
  matchedFrameRatio: number;
  temporalConsistency: number;
  partialRecoveryScore: number;
}

export async function computeVideoForensicScores(
  originalBuffer: Buffer,
  probeBuffer: Buffer,
  originalMime: string,
  probeMime: string,
  originalName: string,
  probeName: string,
): Promise<VideoForensicScores> {
  const shaA = crypto.createHash('sha256').update(originalBuffer).digest('hex');
  const shaB = crypto.createHash('sha256').update(probeBuffer).digest('hex');
  if (shaA === shaB) {
    return {
      sha256Exact: true,
      perceptualScore: 1,
      structuralScore: 1,
      audioScore: 1,
      phase2Score: 1,
      ffmpegUsed: await isFfmpegAvailable(),
      keyframeCountA: INVESTIGATION_KEYFRAMES_PROBE,
      keyframeCountB: INVESTIGATION_KEYFRAMES_VAULT,
      matchedFrameRatio: 1,
      temporalConsistency: 1,
      partialRecoveryScore: 100,
    };
  }

  const ffmpegUsed = await isFfmpegAvailable();
  const partial = await comparePartialVideoProbeToVault(
    probeBuffer,
    probeMime,
    probeName,
    originalBuffer,
    originalMime,
    originalName,
  );

  const mapped = partialVideoToRetrievalScores(partial);
  const perceptualScore = partial.avgMatchedPerceptual || partial.matchedFrameRatio;
  const structuralScore = partial.temporalConsistency;
  const audioScore = partial.audioScore / 100;
  const phase2Score = partial.compositeScore / 100;

  const sizeRatio = Math.min(originalBuffer.length, probeBuffer.length)
    / Math.max(originalBuffer.length, probeBuffer.length);
  const sizeStructural = sizeRatio > 0.85 ? 0.9 : sizeRatio > 0.15 ? 0.45 : 0.25;

  return {
    sha256Exact: false,
    perceptualScore: Math.max(perceptualScore, phase2Score * 0.85),
    structuralScore: Math.max(structuralScore, sizeStructural),
    audioScore,
    phase2Score,
    ffmpegUsed,
    keyframeCountA: partial.probeFrameCount,
    keyframeCountB: partial.vaultFrameCount,
    matchedFrameRatio: partial.matchedFrameRatio,
    temporalConsistency: partial.temporalConsistency,
    partialRecoveryScore: mapped.retrievalBoost,
  };
}

function layerResult(
  layer: number,
  score: number,
  fpA: string,
  fpB: string,
  changeDescription: string,
): LayerComparisonResult {
  const registry = DNA_LAYER_REGISTRY[layer];
  const threshold = layer === 1 ? 1 : layer === 3 ? 0.75 : 0.7;
  const matched = score >= threshold;
  return {
    layer,
    name: registry?.name ?? `Layer ${layer}`,
    implementation: registry?.implementation ?? 'video-forensic',
    similarityScore: score,
    similarityPercent: Math.round(score * 100),
    matched,
    fingerprintA: fpA.slice(0, 24),
    fingerprintB: fpB.slice(0, 24),
    changed: !matched,
    changeDescription,
  };
}

function classifyScore(overall: number, l1Exact: boolean): DnaClassification {
  if (l1Exact && overall >= 95) return 'DNA_MATCH';
  if (overall >= 95) return 'DNA_MATCH';
  if (overall >= 55) return 'SIMILAR';
  return 'DIFFERENT';
}

/**
 * Build a full 15-layer comparison result for video probes (investigation only).
 */
export async function compareVideoInvestigation(
  original: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  },
  probe: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  },
  baseResult?: DnaComparisonResult | null,
): Promise<DnaComparisonResult> {
  const scores = await computeVideoForensicScores(
    original.buffer,
    probe.buffer,
    original.mimeType,
    probe.mimeType,
    original.originalName,
    probe.originalName,
  );

  logger.info('[VideoForensicCompare] Scores', {
    perceptual: Math.round(scores.perceptualScore * 100),
    structural: Math.round(scores.structuralScore * 100),
    audio: Math.round(scores.audioScore * 100),
    phase2: Math.round(scores.phase2Score * 100),
    ffmpeg: scores.ffmpegUsed,
    framesA: scores.keyframeCountA,
    framesB: scores.keyframeCountB,
    exact: scores.sha256Exact,
  });

  const l1 = scores.sha256Exact ? 1 : 0;
  const l3 = scores.perceptualScore;
  const l2 = scores.structuralScore;
  const l4 = Math.max(scores.perceptualScore * 0.9, scores.phase2Score);
  const l5 = scores.audioScore > 0 ? scores.audioScore : scores.structuralScore * 0.7;

  const videoLayers: LayerComparisonResult[] = [
    layerResult(1, l1, 'vault-sha256', 'probe-sha256', scores.sha256Exact ? 'Exact byte match' : 'Binary hash differs'),
    layerResult(2, l2, 'vault-structure', 'probe-structure', `Container/size similarity ${Math.round(l2 * 100)}%`),
    layerResult(3, l3, 'vault-keyframes', 'probe-keyframes', `Partial keyframe match ${Math.round(scores.matchedFrameRatio * 100)}% of probe frames (${scores.keyframeCountB} vault frames)`),
    layerResult(4, l4, 'vault-scenes', 'probe-scenes', `Scene/visual similarity ${Math.round(l4 * 100)}%`),
    layerResult(5, l5, 'vault-audio-meta', 'probe-audio-meta', scores.audioScore > 0 ? `Audio track ${Math.round(l5 * 100)}%` : 'Metadata / duration proxy'),
  ];

  const weights: Record<number, number> = {
    1: 0.35, 2: 0.15, 3: 0.30, 4: 0.12, 5: 0.08,
  };

  let weighted = 0;
  let wSum = 0;
  for (const l of videoLayers) {
    const w = weights[l.layer] ?? 0;
    weighted += l.similarityScore * w;
    wSum += w;
  }

  const mergedLayers: LayerComparisonResult[] = [];
  for (let i = 1; i <= 15; i++) {
    const videoLayer = videoLayers.find((l) => l.layer === i);
    const baseLayer = baseResult?.layerComparisons.find((l) => l.layer === i);
    if (videoLayer && i <= 5) {
      mergedLayers.push(
        baseLayer && baseLayer.similarityScore > videoLayer.similarityScore
          ? baseLayer
          : videoLayer,
      );
    } else if (baseLayer) {
      mergedLayers.push(baseLayer);
    } else {
      mergedLayers.push(layerResult(i, 0, 'n/a', 'n/a', 'Not applicable for video probe'));
    }
  }

  const rawScore = mergedLayers.reduce((sum, l) => {
    const w = weights[l.layer] ?? (l.layer <= 6 ? 0.05 : 0);
    return sum + l.similarityScore * w;
  }, weighted);

  const overallConfidenceScore = scores.sha256Exact
    ? 100
    : Math.min(100, Math.round(Math.max(
      scores.partialRecoveryScore,
      rawScore * 100,
      scores.perceptualScore * 100,
      scores.matchedFrameRatio * 85,
    )));

  const classification = classifyScore(overallConfidenceScore, scores.sha256Exact);
  const tamperingDetected = !scores.sha256Exact && overallConfidenceScore < 95;

  return {
    comparisonId: baseResult?.comparisonId ?? `video-${Date.now()}`,
    fileA: baseResult?.fileA ?? {
      filename: original.originalName,
      fileType: 'VIDEO',
      mimeType: original.mimeType,
      sizeBytes: original.sizeBytes,
      detectedBy: 'vault-registry',
    },
    fileB: baseResult?.fileB ?? {
      filename: probe.originalName,
      fileType: 'VIDEO',
      mimeType: probe.mimeType,
      sizeBytes: probe.sizeBytes,
      detectedBy: 'probe-upload',
    },
    sameFileType: true,
    classification,
    overallConfidenceScore,
    tamperingDetected,
    layerComparisons: mergedLayers,
    changedLayers: mergedLayers.filter((l) => l.changed).map((l) => l.name),
    matchedLayers: mergedLayers.filter((l) => l.matched).map((l) => l.name),
    processingMs: baseResult?.processingMs ?? 0,
    comparedAt: new Date().toISOString(),
    forensicReport: {
      summary: scores.sha256Exact
        ? 'Exact video match — byte-identical to vault original'
        : `Video forensic compare — ${overallConfidenceScore}% (partial frames ${Math.round(scores.matchedFrameRatio * 100)}%, temporal ${Math.round(scores.temporalConsistency * 100)}%)`,
      methodology: scores.ffmpegUsed
        ? 'FFmpeg keyframe extraction + perceptual hash + audio fingerprint'
        : 'Binary structural + phase-2 video DNA fallback',
      classification,
      overallConfidenceScore,
      tamperingDetected,
      tamperingIndicators: [],
      layerAnalysis: Object.fromEntries(mergedLayers.map((l) => [`L${l.layer}`, l.changeDescription])),
      changedLayers: mergedLayers.filter((l) => l.changed).map((l) => l.name),
      unchangedLayers: mergedLayers.filter((l) => !l.changed).map((l) => l.name),
      recommendation: overallConfidenceScore >= 95 ? 'Original verified' : 'Review tamper indicators',
      engineVersion: 'video-forensic-1.0',
      timestamp: new Date().toISOString(),
    },
  };
}
