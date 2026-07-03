/**
 * Partial video forensic recovery — trimmed clips, re-encoded, WhatsApp, subclips.
 * Compares probe keyframes independently against vault video fingerprints.
 * Image investigation paths are unchanged.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { computeBmHash64 } from './perceptual-enhancements';
import { extractVideoFrameSamples, extractAudioSample, isFfmpegAvailable } from './media-tools.service';
import { localFeatureMatchService } from './local-feature-match.service';
import { aiService } from '../ai/ai-embeddings.service';
import type { VaultSimilarityVector, SimilarityVectorScores } from './vault-similarity-vector.service';

const PROBE_KEYFRAMES = 16;
const VAULT_KEYFRAMES = 24;
const PROBE_KEYFRAMES_LIGHT = 10;
const VAULT_KEYFRAMES_LIGHT = 12;
const STRONG_FRAME_THRESHOLD = 0.68;
const WEAK_FRAME_THRESHOLD = 0.52;
const VAULT_COMPARE_CONCURRENCY = 2;

export interface PartialVideoFrameMatch {
  probeIndex: number;
  vaultIndex: number;
  perceptual: number;
}

export interface PartialVideoMatchResult {
  matchedFrameCount: number;
  probeFrameCount: number;
  vaultFrameCount: number;
  matchedFrameRatio: number;
  strongMatchRatio: number;
  avgMatchedPerceptual: number;
  temporalConsistency: number;
  perceptualScore: number;
  orbScore: number;
  clipScore: number;
  audioScore: number;
  compositeScore: number;
  partialRecoveryScore: number;
  signals: string[];
  bestProbeFrame?: Buffer;
  bestVaultFrame?: Buffer;
  frameMatches: PartialVideoFrameMatch[];
}

function extFromFile(mimeType: string, name: string): string {
  const fromName = name.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('quicktime')) return 'mov';
  return 'mp4';
}

function isVideoMime(mime: string, name: string): boolean {
  if (mime.startsWith('video/')) return true;
  return /\.(mp4|mov|avi|mkv|webm|m4v|mpeg|mpg)$/i.test(name);
}

function hammingSimilarity(a: string, b: string, bits = 64): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return Math.max(0, 1 - dist / bits);
}

function audioSimilarity(a: Buffer, b: Buffer): number {
  const ha = crypto.createHash('sha256').update(a.slice(0, 65536)).digest('hex');
  const hb = crypto.createHash('sha256').update(b.slice(0, 65536)).digest('hex');
  if (ha === hb) return 1;
  return hammingSimilarity(ha.slice(0, 16), hb.slice(0, 16));
}

export async function extractUniformVideoKeyframes(
  buffer: Buffer,
  mimeType: string,
  name: string,
  count: number,
): Promise<Buffer[]> {
  const ext = extFromFile(mimeType, name);
  return extractVideoFrameSamples(buffer, count, ext);
}

/**
 * Asymmetric partial compare — each probe frame matched independently to best vault frame.
 */
export async function comparePartialVideoFrames(
  probeFrames: Buffer[],
  vaultFrames: Buffer[],
  audioPair?: { probe: Buffer | null; vault: Buffer | null },
): Promise<PartialVideoMatchResult> {
  const signals: string[] = [];
  if (!probeFrames.length || !vaultFrames.length) {
    return {
      matchedFrameCount: 0,
      probeFrameCount: probeFrames.length,
      vaultFrameCount: vaultFrames.length,
      matchedFrameRatio: 0,
      strongMatchRatio: 0,
      avgMatchedPerceptual: 0,
      temporalConsistency: 0,
      perceptualScore: 0,
      orbScore: 0,
      clipScore: 0,
      audioScore: 0,
      compositeScore: 0,
      partialRecoveryScore: 0,
      signals: ['no_keyframes'],
      frameMatches: [],
    };
  }

  const [probeHashes, vaultHashes] = await Promise.all([
    Promise.all(probeFrames.map((f) => computeBmHash64(f))),
    Promise.all(vaultFrames.map((f) => computeBmHash64(f))),
  ]);

  const frameMatches: PartialVideoFrameMatch[] = [];
  let weakCount = 0;

  for (let pi = 0; pi < probeHashes.length; pi++) {
    let bestVi = 0;
    let bestScore = 0;
    for (let vi = 0; vi < vaultHashes.length; vi++) {
      const s = hammingSimilarity(probeHashes[pi]!, vaultHashes[vi]!);
      if (s > bestScore) {
        bestScore = s;
        bestVi = vi;
      }
    }
    if (bestScore >= STRONG_FRAME_THRESHOLD) {
      frameMatches.push({ probeIndex: pi, vaultIndex: bestVi, perceptual: bestScore });
    } else if (bestScore >= WEAK_FRAME_THRESHOLD) {
      weakCount++;
    }
  }

  const matchedFrameCount = frameMatches.length;
  const matchedFrameRatio = matchedFrameCount / probeFrames.length;
  const strongMatchRatio = matchedFrameCount / Math.max(1, vaultFrames.length);
  const avgMatchedPerceptual = matchedFrameCount
    ? frameMatches.reduce((a, m) => a + m.perceptual, 0) / matchedFrameCount
    : 0;

  let temporalConsistency = 0;
  if (frameMatches.length >= 2) {
    const sorted = [...frameMatches].sort((a, b) => a.probeIndex - b.probeIndex);
    let monotonic = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.vaultIndex >= sorted[i - 1]!.vaultIndex) monotonic++;
    }
    temporalConsistency = monotonic / (sorted.length - 1);
  } else if (frameMatches.length === 1) {
    temporalConsistency = 1;
  }

  let audioScore = 0;
  if (audioPair?.probe && audioPair.vault) {
    audioScore = audioSimilarity(audioPair.probe, audioPair.vault);
    if (audioScore >= 0.55) signals.push('audio_overlap');
  }

  const perceptualScore = Math.round(
    (matchedFrameRatio * 0.5 + avgMatchedPerceptual * 0.5) * 100,
  );

  if (matchedFrameCount >= 2) signals.push('partial_video_frames');
  if (matchedFrameRatio >= 0.35) signals.push('partial_video_recovery');
  if (temporalConsistency >= 0.6) signals.push('temporal_consistency');
  if (weakCount >= 2) signals.push('weak_frame_matches');

  const durationRatio = Math.min(1, probeFrames.length / Math.max(1, vaultFrames.length));
  const partialRecoveryScore = Math.round(
    perceptualScore * 0.45
    + matchedFrameRatio * 100 * 0.30
    + temporalConsistency * 100 * 0.12
    + audioScore * 100 * 0.08
    + durationRatio * 100 * 0.05,
  );

  let compositeScore = partialRecoveryScore;
  if (matchedFrameCount >= 3 && matchedFrameRatio >= 0.25) {
    compositeScore = Math.max(compositeScore, Math.round(38 + matchedFrameRatio * 42));
  }
  if (matchedFrameRatio >= 0.45 && avgMatchedPerceptual >= 0.75) {
    compositeScore = Math.max(compositeScore, Math.round(55 + matchedFrameRatio * 25));
  }
  if (matchedFrameRatio >= 0.6 && temporalConsistency >= 0.5) {
    compositeScore = Math.max(compositeScore, Math.min(85, Math.round(60 + matchedFrameRatio * 20)));
  }

  const bestMatch = frameMatches.sort((a, b) => b.perceptual - a.perceptual)[0];

  return {
    matchedFrameCount,
    probeFrameCount: probeFrames.length,
    vaultFrameCount: vaultFrames.length,
    matchedFrameRatio,
    strongMatchRatio,
    avgMatchedPerceptual,
    temporalConsistency,
    perceptualScore,
    orbScore: 0,
    clipScore: 0,
    audioScore: Math.round(audioScore * 100),
    compositeScore,
    partialRecoveryScore,
    signals,
    bestProbeFrame: bestMatch ? probeFrames[bestMatch.probeIndex] : probeFrames[0],
    bestVaultFrame: bestMatch ? vaultFrames[bestMatch.vaultIndex] : vaultFrames[0],
    frameMatches,
  };
}

export async function comparePartialVideoProbeToVault(
  probeBuffer: Buffer,
  probeMime: string,
  probeName: string,
  vaultBuffer: Buffer,
  vaultMime: string,
  vaultName: string,
  options?: {
    probeFrames?: Buffer[];
    probeAudio?: Buffer | null;
    vaultFrameCount?: number;
    enrichOrbClip?: boolean;
    skipAudio?: boolean;
  },
): Promise<PartialVideoMatchResult> {
  const ext = extFromFile(probeMime, probeName);
  const vaultFramesTarget = options?.vaultFrameCount ?? VAULT_KEYFRAMES;
  const enrichOrbClip = options?.enrichOrbClip !== false;

  const [probeFrames, vaultFrames, audioProbe, audioVault] = await Promise.all([
    options?.probeFrames?.length
      ? Promise.resolve(options.probeFrames)
      : extractUniformVideoKeyframes(probeBuffer, probeMime, probeName, PROBE_KEYFRAMES),
    extractUniformVideoKeyframes(vaultBuffer, vaultMime, vaultName, vaultFramesTarget),
    options?.skipAudio
      ? Promise.resolve(null)
      : (options?.probeAudio !== undefined
        ? Promise.resolve(options.probeAudio)
        : extractAudioSample(probeBuffer, ext)),
    options?.skipAudio ? Promise.resolve(null) : extractAudioSample(vaultBuffer, ext),
  ]);

  const result = await comparePartialVideoFrames(probeFrames, vaultFrames, {
    probe: audioProbe,
    vault: audioVault,
  });

  if (enrichOrbClip && result.bestProbeFrame && result.bestVaultFrame) {
    try {
      const [orb, clip] = await Promise.all([
        localFeatureMatchService.compare(result.bestProbeFrame, result.bestVaultFrame),
        aiService.compareImages(result.bestProbeFrame, result.bestVaultFrame),
      ]);
      result.orbScore = Math.round(orb.similarity * 100);
      if (orb.similarity >= 0.32) result.signals.push('orb_frame_match', orb.method);
      if (clip && clip.similarity > 0) {
        result.clipScore = Math.round(clip.similarity * 100);
        if (clip.similarity >= 0.4) result.signals.push('clip_frame_similarity');
      }
      result.compositeScore = Math.round(
        result.compositeScore * 0.72
        + result.orbScore * 0.18
        + result.clipScore * 0.10,
      );
      result.partialRecoveryScore = Math.max(result.partialRecoveryScore, result.compositeScore);
    } catch { /* optional enrichment */ }
  }

  return result;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

/**
 * Score all video vault assets against a video probe (partial frame recovery).
 */
export async function partialVideoVaultSearch(
  probeBuffer: Buffer,
  probeMime: string,
  probeName: string,
  ownerUserId: string,
  options?: {
    candidateVaultIds?: string[];
    limit?: number;
    orbTopK?: number;
    lightMode?: boolean;
  },
): Promise<VaultSimilarityVector[]> {
  if (!isVideoMime(probeMime, probeName)) return [];

  const candidateSet = options?.candidateVaultIds?.length
    ? new Set(options.candidateVaultIds)
    : null;

  const vaultRows = await prisma.dnaRecord.findMany({
    where: {
      ownerUserId,
      vaultRecord: candidateSet ? { id: { in: [...candidateSet] } } : { isNot: null },
      OR: [
        { fileType: 'VIDEO' },
        { imageMimeType: { startsWith: 'video/' } },
      ],
    },
    include: {
      vaultRecord: { select: { id: true, originalFileName: true, originalMimeType: true } },
      cryptoLayer: { select: { sha256Hash: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  let videoRows = vaultRows.filter((r) =>
    r.vaultRecord
    && (
      r.fileType === 'VIDEO'
      || r.imageMimeType?.startsWith('video/')
      || isVideoMime(r.imageMimeType ?? '', r.vaultRecord.originalFileName)
    ),
  );

  if (!videoRows.length && !candidateSet) {
    const allVault = await prisma.dnaRecord.findMany({
      where: { ownerUserId, vaultRecord: { isNot: null } },
      include: {
        vaultRecord: { select: { id: true, originalFileName: true, originalMimeType: true } },
        cryptoLayer: { select: { sha256Hash: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    videoRows = allVault.filter((r) =>
      r.vaultRecord && isVideoMime(r.imageMimeType ?? '', r.vaultRecord.originalFileName),
    );
  }

  if (!videoRows.length) {
    logger.info('[PartialVideoRecovery] No video vault assets for owner');
    return [];
  }

  const probeHash = crypto.createHash('sha256').update(probeBuffer).digest('hex');
  const vaultSvc = new VaultService();
  const vectors: VaultSimilarityVector[] = [];
  const lightMode = options?.lightMode !== false && !options?.candidateVaultIds?.length;
  const probeFrameTarget = lightMode ? PROBE_KEYFRAMES_LIGHT : PROBE_KEYFRAMES;
  const vaultFrameTarget = lightMode ? VAULT_KEYFRAMES_LIGHT : VAULT_KEYFRAMES;
  const ext = extFromFile(probeMime, probeName);

  const probeFrames = await extractUniformVideoKeyframes(
    probeBuffer, probeMime, probeName, probeFrameTarget,
  );
  const probeAudio = lightMode ? null : await extractAudioSample(probeBuffer, ext);

  if (!probeFrames.length) {
    logger.warn('[PartialVideoRecovery] No probe keyframes — check FFMPEG_PATH', {
      probe: probeName,
      ffmpeg: await isFfmpegAvailable(),
    });
    return [];
  }

  const clipNameScores = new Map<string, number>();
  try {
    const query = probeName.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ').trim() || 'video';
    const sem = await aiService.findSimilar(query, Math.min(videoRows.length, 20));
    for (const hit of sem.results) {
      clipNameScores.set(hit.dnaRecordId, Math.round(hit.similarity * 100));
    }
  } catch { /* offline */ }

  let bestComposite = 0;
  let compared = 0;
  const maxCompare = lightMode
    ? Math.min(videoRows.length, options?.limit ?? 12)
    : videoRows.length;
  const rowsToCompare = videoRows.slice(0, maxCompare);

  await mapWithConcurrency(rowsToCompare, VAULT_COMPARE_CONCURRENCY, async (row) => {
    if (!row.vaultRecord) return;
    if (lightMode && bestComposite >= 72 && compared >= 2) return;
    try {
      compared++;
      if (row.sha256Hash === probeHash || row.cryptoLayer?.sha256Hash === probeHash) {
        vectors.push({
          vaultId: row.vaultRecord.id,
          dnaRecordId: row.id,
          ownerUserId,
          filename: row.vaultRecord.originalFileName,
          scores: {
            sha256: 100, pHash: 100, aHash: 100, dHash: 100, perceptualBlend: 100,
            structural: 100, semanticColor: 0, clip: 100, orb: 100, aspectRatio: 100, composite: 100,
          },
          signals: ['cryptographic_hash', 'partial_video_exact'],
        });
        bestComposite = 100;
        return;
      }

      const retrieved = await vaultSvc.retrieve(row.vaultRecord.id, ownerUserId);
      const partial = await comparePartialVideoProbeToVault(
        probeBuffer,
        probeMime,
        probeName,
        retrieved.originalBuffer,
        retrieved.originalMimeType ?? row.imageMimeType ?? 'video/mp4',
        retrieved.originalFileName,
        {
          probeFrames,
          probeAudio,
          vaultFrameCount: vaultFrameTarget,
          enrichOrbClip: !lightMode,
          skipAudio: lightMode,
        },
      );

      if (partial.matchedFrameCount === 0 && partial.compositeScore < 22) return;

      bestComposite = Math.max(bestComposite, partial.compositeScore);

      const scores: SimilarityVectorScores = {
        sha256: 0,
        pHash: partial.perceptualScore,
        aHash: 0,
        dHash: 0,
        perceptualBlend: partial.perceptualScore,
        structural: Math.round(partial.temporalConsistency * 100),
        semanticColor: 0,
        clip: Math.max(partial.clipScore, clipNameScores.get(row.id) ?? 0),
        orb: partial.orbScore,
        aspectRatio: Math.round(partial.matchedFrameRatio * 100),
        composite: partial.compositeScore,
      };

      vectors.push({
        vaultId: row.vaultRecord.id,
        dnaRecordId: row.id,
        ownerUserId,
        filename: row.vaultRecord.originalFileName,
        scores,
        signals: [...new Set([
          ...partial.signals,
          `matched_probe_frames:${partial.matchedFrameCount}`,
        ])],
      });
    } catch (e) {
      logger.debug('[PartialVideoRecovery] Vault compare failed', {
        vaultId: row.vaultRecord?.id?.slice(0, 8),
        error: String(e),
      });
    }
  });

  vectors.sort((a, b) => b.scores.composite - a.scores.composite);
  const limited = vectors.slice(0, options?.limit ?? vectors.length);

  logger.info('[PartialVideoRecovery] Vault search complete', {
    probe: probeName,
    videoVaults: videoRows.length,
    compared,
    lightMode,
    probeFrames: probeFrames.length,
    matches: limited.length,
    topComposite: limited[0]?.scores.composite ?? 0,
    topFrameRatio: limited[0]?.scores.aspectRatio ?? 0,
    ffmpeg: await isFfmpegAvailable(),
  });

  return limited;
}

/** Map partial video match into retrieval / DNA scores for fusion */
export function partialVideoToRetrievalScores(partial: PartialVideoMatchResult): {
  retrievalBoost: number;
  dna15Proxy: number;
  frameRatio: number;
} {
  const frameRatio = partial.matchedFrameRatio;
  const retrievalBoost = Math.max(
    partial.partialRecoveryScore,
    partial.compositeScore,
    Math.round(35 + frameRatio * 45),
  );
  const dna15Proxy = Math.max(
    partial.compositeScore,
    Math.round(partial.avgMatchedPerceptual * 100 * 0.7 + frameRatio * 100 * 0.3),
  );
  return { retrievalBoost, dna15Proxy, frameRatio };
}
