/**
 * Video source-composition investigation — the video analog of
 * `investigation-composition.service.ts`'s per-image pixel-source
 * breakdown, aggregated across a probe video's timeline instead of a
 * single frame.
 *
 * Two independent matching strategies feed the same per-frame composition
 * loop, tried in order:
 *
 *  1. Whole-frame match (reuses `partialVideoVaultSearch` /
 *     `comparePartialVideoProbeToVault` unchanged) — finds trimmed,
 *     re-encoded, or otherwise whole-frame-preserved reuse via perceptual
 *     hashing of entire frames.
 *  2. Patch-level fragment match (new) — finds a SPATIALLY CROPPED region
 *     of a protected frame reused in an otherwise-unrelated probe. Whole-
 *     frame perceptual hashing cannot see this (a half-cropped frame hashes
 *     nothing like the full original frame it came from), which is exactly
 *     why `fragment-splice-detector.service.ts` exists for images — every
 *     protected video frame already gets the same patch-level local-DNA
 *     index images/PDF pages get (video-page-protection.service.ts calls
 *     localDnaIndexService.buildIndex() per frame), so this reuses that
 *     detector as-is, restricted to one candidate video's frame ids at a
 *     time via the new `restrictToVaultIds` option.
 *
 * Both strategies converge on `buildInvestigationComposition` — the exact
 * same per-image pixel classification engine images and PDF pages use —
 * called once per aligned (probe keyframe, matched vault frame) pair.
 *
 * The only genuinely new logic is (a) collapsing N independent per-frame
 * `ImageCompositionBreakdown` results into duration-weighted overall
 * percentages plus a timeline of same-source runs, and (b) the fragment-
 * based candidate discovery/matching path — nothing in the codebase did
 * time-axis aggregation or cropped-video-frame matching before this.
 */
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { VaultService } from '../vault/vault.service';
import {
  comparePartialVideoProbeToVault,
  partialVideoVaultSearch,
} from './partial-video-recovery.service';
import { probeVideoDuration, extractFramesAtTimestamps } from './media-tools.service';
import { buildInvestigationComposition } from './investigation-composition.service';
import { fragmentSpliceDetectorService } from './fragment-splice-detector.service';
import type { FragmentReuseFinding } from '../../types/unified-investigation.types';
import type {
  VideoCompositionTimelineSegment,
  VideoCompositionFramePoint,
  VideoCompositionResult,
} from '../../types/video-investigation-composition.types';

export type {
  VideoCompositionTimelineSegment,
  VideoCompositionFramePoint,
  VideoCompositionResult,
} from '../../types/video-investigation-composition.types';

const PROBE_FRAME_COUNT = 16; // matches partial-video-recovery.service.ts's PROBE_KEYFRAMES default
const MIN_CANDIDATE_COMPOSITE = 30;
const FRAGMENT_MIN_PATCH_MATCHES = 4;
const FRAGMENT_DISCOVERY_CONCURRENCY = 4;

function extFromMimeOrName(mime: string, name: string): string {
  const fromName = name.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  return 'mp4';
}

/** Approximate timestamp of an evenly-spaced keyframe index, mirroring the
 *  fps math extractVideoFrameSamples uses internally. */
function keyframeTimestampMs(index: number, count: number, durationSec: number): number {
  const fps = count <= 1 ? 1 : Math.max(0.08, (count - 1) / Math.max(durationSec - 0.15, 0.5));
  return Math.round((index / fps) * 1000);
}

/**
 * Pure aggregation — the two genuinely new algorithms in this feature, kept
 * free of any DB/ffmpeg/network I/O so they can be unit tested directly:
 *
 *  1. Timeline collapsing: N independent per-frame composition points ->
 *     non-overlapping segments tiling the full probe duration (each frame
 *     represents the half-open slice up to the midpoint between it and its
 *     neighbors), then consecutive same-source segments are merged into runs.
 *  2. Duration-weighted overall percentages: a segment covering 10s of a
 *     30s video counts 10x as much as a 1s segment, not a flat per-frame
 *     average — a frame sampled once per second is not equal representation
 *     of a video with uneven match density.
 */
export function collapseFramePointsIntoTimeline(
  perFrame: VideoCompositionFramePoint[],
  probeDurationMs: number,
  sourceFilename: string,
): {
  timeline: VideoCompositionTimelineSegment[];
  overall: VideoCompositionResult['overall'];
} {
  const timeline: VideoCompositionTimelineSegment[] = [];
  for (let i = 0; i < perFrame.length; i++) {
    const point = perFrame[i]!;
    const prevMid = i === 0 ? 0 : Math.round((perFrame[i - 1]!.tMs + point.tMs) / 2);
    const nextMid = i === perFrame.length - 1
      ? probeDurationMs
      : Math.round((point.tMs + perFrame[i + 1]!.tMs) / 2);

    timeline.push({
      tStartMs: prevMid,
      tEndMs: Math.max(nextMid, prevMid),
      sourceVaultId: point.matchedFrameDnaRecordId,
      sourceFilename: point.matchedFrameDnaRecordId ? sourceFilename : null,
      matchedFrameDnaRecordId: point.matchedFrameDnaRecordId,
      protectedFromAssetPercent: point.breakdown?.protectedFromAssetPercent ?? 0,
      otherPercent: point.breakdown?.otherPercent ?? 100,
    });
  }

  // Collapse consecutive segments from the same source (or same "no match")
  // into runs, the time-axis analog of how pixelSource.regions[] groups
  // spatial pixels for images.
  const collapsed: VideoCompositionTimelineSegment[] = [];
  for (const seg of timeline) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.sourceVaultId === seg.sourceVaultId) {
      last.tEndMs = seg.tEndMs;
      // Keep the run's percent as a simple average across its collapsed slices.
      last.protectedFromAssetPercent = Math.round(
        (last.protectedFromAssetPercent + seg.protectedFromAssetPercent) / 2,
      );
      last.otherPercent = Math.round((last.otherPercent + seg.otherPercent) / 2);
    } else {
      collapsed.push({ ...seg });
    }
  }

  // ── Duration-weighted overall percentages ───────────────────────────────
  let weightedProtected = 0;
  let weightedOther = 0;
  let totalWeight = 0;
  let weightedOriginalUsed = 0;
  let originalUsedWeight = 0;

  for (const seg of timeline) {
    const weight = Math.max(0, seg.tEndMs - seg.tStartMs);
    weightedProtected += seg.protectedFromAssetPercent * weight;
    weightedOther += seg.otherPercent * weight;
    totalWeight += weight;
  }
  for (const point of perFrame) {
    if (point.breakdown?.originalUsedPercent != null) {
      weightedOriginalUsed += point.breakdown.originalUsedPercent;
      originalUsedWeight++;
    }
  }

  const overall = {
    protectedFromAssetPercent: totalWeight ? Math.round(weightedProtected / totalWeight) : 0,
    otherPercent: totalWeight ? Math.round(weightedOther / totalWeight) : 100,
    originalUsedPercent: originalUsedWeight ? Math.round(weightedOriginalUsed / originalUsedWeight) : null,
  };

  return { timeline: collapsed, overall };
}

export async function aggregateVideoComposition(params: {
  probeBuffer: Buffer;
  probeMimeType: string;
  probeFileName: string;
  ownerUserId: string;
}): Promise<VideoCompositionResult | null> {
  const probeExt = extFromMimeOrName(params.probeMimeType, params.probeFileName);
  const probeDurationSec = await probeVideoDuration(params.probeBuffer, probeExt);
  if (!probeDurationSec) {
    logger.debug('[VideoComposition] Could not probe duration — skipping', { probe: params.probeFileName });
    return null;
  }

  const candidates = await partialVideoVaultSearch(
    params.probeBuffer,
    params.probeMimeType,
    params.probeFileName,
    params.ownerUserId,
    { limit: 1 },
  );
  const winner = candidates[0];
  if (winner && winner.scores.composite >= MIN_CANDIDATE_COMPOSITE) {
    const result = await buildCompositionFromWholeFrameMatch(params, winner, probeDurationSec, probeExt);
    if (result) return result;
  } else {
    logger.debug('[VideoComposition] No whole-frame match — trying patch-level fragment search', {
      probe: params.probeFileName,
      topComposite: winner?.scores.composite ?? 0,
    });
  }

  // Whole-frame perceptual hashing cannot see a spatially cropped fragment of
  // a frame (a half-cropped frame hashes nothing like the full original it
  // came from) — fall back to the same patch-level local-DNA matching images
  // use for pasted-fragment detection, since every protected video frame is
  // already indexed the same way. Extract the probe's keyframe grid once and
  // reuse it for both discovery and the full per-frame pass below.
  const keyframeTimestamps: number[] = [];
  for (let i = 0; i < PROBE_FRAME_COUNT; i++) {
    keyframeTimestamps.push(keyframeTimestampMs(i, PROBE_FRAME_COUNT, probeDurationSec));
  }
  const probeFrameBuffers = await extractFramesAtTimestamps(params.probeBuffer, keyframeTimestamps, probeExt);
  if (!probeFrameBuffers.size) return null;

  const fragmentCandidate = await discoverCandidateVideoViaFragments(probeFrameBuffers, params.ownerUserId);
  if (!fragmentCandidate) {
    logger.debug('[VideoComposition] No qualifying vault video match (whole-frame or fragment)', {
      probe: params.probeFileName,
    });
    return null;
  }
  return buildCompositionFromFragmentMatch(
    params, fragmentCandidate, probeDurationSec, keyframeTimestamps, probeFrameBuffers,
  );
}

async function buildCompositionFromWholeFrameMatch(
  params: { probeBuffer: Buffer; probeMimeType: string; probeFileName: string; ownerUserId: string },
  winner: Awaited<ReturnType<typeof partialVideoVaultSearch>>[number],
  probeDurationSec: number,
  probeExt: string,
): Promise<VideoCompositionResult | null> {
  const vaultSvc = new VaultService();
  const retrieved = await vaultSvc.retrieve(winner.vaultId, params.ownerUserId);
  const vaultMime = retrieved.originalMimeType ?? 'video/mp4';
  const vaultExt = extFromMimeOrName(vaultMime, retrieved.originalFileName);

  const full = await comparePartialVideoProbeToVault(
    params.probeBuffer,
    params.probeMimeType,
    params.probeFileName,
    retrieved.originalBuffer,
    vaultMime,
    retrieved.originalFileName,
    { vaultDnaRecordId: winner.dnaRecordId, enrichOrbClip: false, skipAudio: true },
  );

  const probeDurationMs = Math.round(probeDurationSec * 1000);
  const matchByProbeIndex = new Map(full.frameMatches.map((m) => [m.probeIndex, m]));
  const alignedIds = full.frameMatches
    .map((m) => m.matchedFrameDnaRecordId)
    .filter((id): id is string => !!id);

  if (!alignedIds.length) {
    logger.debug('[VideoComposition] No aligned protected frames', {
      probe: params.probeFileName,
      vaultId: winner.vaultId,
    });
    return null;
  }

  const protectedFrames = await prisma.dnaRecord.findMany({
    where: { id: { in: [...new Set(alignedIds)] } },
    select: { id: true, frameTimestampMs: true },
  });
  const frameTimestampById = new Map(protectedFrames.map((f) => [f.id, f.frameTimestampMs ?? 0]));
  const vaultFrameBuffers = await extractFramesAtTimestamps(
    retrieved.originalBuffer,
    [...new Set(protectedFrames.map((f) => f.frameTimestampMs ?? 0))],
    vaultExt,
  );

  // Re-derive the same evenly-spaced probe keyframe grid comparePartialVideoProbeToVault
  // used internally (it wasn't given explicit probeFrames, so it extracted its own —
  // frameMatches.probeIndex references that grid, not any buffer we still hold), so we
  // need the actual probe frame at each matched keyframe boundary for composition.
  const keyframeTimestamps: number[] = [];
  for (let i = 0; i < PROBE_FRAME_COUNT; i++) {
    keyframeTimestamps.push(keyframeTimestampMs(i, PROBE_FRAME_COUNT, probeDurationSec));
  }
  const probeFrameBuffers = await extractFramesAtTimestamps(
    params.probeBuffer,
    keyframeTimestamps,
    probeExt,
  );

  const perFrame: VideoCompositionFramePoint[] = [];
  let framesMatched = 0;

  for (let i = 0; i < PROBE_FRAME_COUNT; i++) {
    const tMs = keyframeTimestamps[i]!;
    const match = matchByProbeIndex.get(i);
    const matchedFrameDnaRecordId = match?.matchedFrameDnaRecordId ?? null;

    const probeFrameBuffer = probeFrameBuffers.get(tMs);
    const probeFrameJpegBase64 = probeFrameBuffer?.toString('base64');

    if (!matchedFrameDnaRecordId) {
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId: null, breakdown: null, probeFrameJpegBase64 });
      continue;
    }

    const vaultFrameTs = frameTimestampById.get(matchedFrameDnaRecordId) ?? 0;
    const vaultFrameBuffer = vaultFrameBuffers.get(vaultFrameTs);

    if (!vaultFrameBuffer || !probeFrameBuffer) {
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId, breakdown: null, probeFrameJpegBase64 });
      continue;
    }

    try {
      const breakdown = await buildInvestigationComposition({
        probeBuffer: probeFrameBuffer,
        probeMimeType: 'image/jpeg',
        vaultBuffer: vaultFrameBuffer,
        vaultId: matchedFrameDnaRecordId,
        vaultFilename: retrieved.originalFileName,
        dnaRecordId: matchedFrameDnaRecordId,
        ownerUserId: params.ownerUserId,
        fragmentFindings: [],
      });
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId, breakdown, probeFrameJpegBase64 });
      framesMatched++;
    } catch (err) {
      logger.warn('[VideoComposition] Per-frame composition failed (non-fatal)', {
        probeIndex: i,
        matchedFrameDnaRecordId,
        error: String(err),
      });
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId, breakdown: null, probeFrameJpegBase64 });
    }
  }

  if (!framesMatched) return null;

  const { timeline, overall } = collapseFramePointsIntoTimeline(
    perFrame,
    probeDurationMs,
    retrieved.originalFileName,
  );

  logger.info('[VideoComposition] Whole-frame aggregation complete', {
    probe: params.probeFileName,
    vaultId: winner.vaultId,
    framesSampled: PROBE_FRAME_COUNT,
    framesMatched,
    overall,
    timelineSegments: timeline.length,
  });

  return {
    vaultId: winner.vaultId,
    vaultDnaRecordId: winner.dnaRecordId,
    vaultFilename: retrieved.originalFileName,
    probeDurationMs,
    framesSampled: PROBE_FRAME_COUNT,
    framesMatched,
    overall,
    timeline,
    perFrame,
  };
}

interface FragmentVideoCandidate {
  videoDnaRecordId: string;
  vaultId: string;
  votes: number;
  /** This candidate video's own protected frame DnaRecordIds. */
  frameVaultIds: string[];
  /** Per-probe-timestamp fragment findings, already resolved to this
   *  video's own frames and reused directly from the discovery pass — no
   *  second patch search needed, since discovery already searched a
   *  superset containing these exact frames. */
  findingsByTimestamp: Map<number, FragmentReuseFinding[]>;
}

/**
 * Runs patch-level fragment detection on the probe's keyframe grid,
 * restricted to exactly this owner's protected VIDEO frame indexes (across
 * all their videos) — not the account-wide scan detectSplicedFragments does
 * by default. That distinction matters: a real account can easily have more
 * protected images/PDF pages than the default 20-candidate scan window, and
 * an unrestricted search can burn through the results budget on unrelated
 * non-video content (a screenshot with similar UI chrome, say) before ever
 * reaching the actual video frames, especially since detectSplicedFragments
 * caps findings at 5 per call and sorts by raw confidence, which has no way
 * to know "this candidate isn't even a video" should be deprioritized.
 * Restricting the pool up front avoids that failure mode entirely and also
 * tells us, for free, which parent video each match belongs to.
 */
async function discoverCandidateVideoViaFragments(
  probeFrameBuffers: Map<number, Buffer>,
  ownerUserId: string,
): Promise<FragmentVideoCandidate | null> {
  const videoFrames = await prisma.dnaRecord.findMany({
    where: { ownerUserId, videoDnaRecordId: { not: null } },
    select: { id: true, videoDnaRecordId: true },
  });
  if (!videoFrames.length) return null;

  const allFrameVaultIds = videoFrames.map((f) => f.id);
  const videoIdByFrameId = new Map(videoFrames.map((f) => [f.id, f.videoDnaRecordId!]));

  const votesByVideo = new Map<string, number>();
  // Kept so a winning video's per-frame findings don't need a second, fully
  // redundant patch search below — this discovery pass already searched the
  // superset (every video frame across the account), so its results for the
  // winning video's own frames are already final, not just a hint.
  const findingsByTimestamp = new Map<number, FragmentReuseFinding[]>();

  // Each call generates a full multi-scale patch grid and hash-matches it —
  // real per-frame cost, and this loop was the dominant share of total
  // investigation time end-to-end (measured ~14 of ~16 minutes on a real
  // video). Bounded concurrency overlaps that work across frames instead of
  // running the 16 (PROBE_FRAME_COUNT) searches one at a time, mirroring the
  // FRAME_PROTECTION_CONCURRENCY pattern used for video frame protection.
  const entries = [...probeFrameBuffers.entries()];
  let cursor = 0;
  const workers = Array.from({ length: FRAGMENT_DISCOVERY_CONCURRENCY }, async () => {
    while (cursor < entries.length) {
      const [tMs, frameBuffer] = entries[cursor++]!;
      const findings = await fragmentSpliceDetectorService
        .detectSplicedFragments(frameBuffer, ownerUserId, 'image/jpeg', {
          restrictToVaultIds: allFrameVaultIds,
          forComposition: true,
          minPatchMatches: FRAGMENT_MIN_PATCH_MATCHES,
          // The probe frame here may itself already be a spatial crop of the
          // original — in that case the matched region legitimately spans
          // 100% of the probe's own canvas, which is not the "full match, not
          // a splice" false positive the default bbox-area filter guards
          // against (there's no larger unrelated canvas it's pasted into).
          maxBBoxAreaPercentOverride: 100,
        })
        .catch(() => [] as FragmentReuseFinding[]);
      findingsByTimestamp.set(tMs, findings);

      const parentVideoIds = new Set<string>();
      for (const f of findings) {
        const videoId = videoIdByFrameId.get(f.dnaRecordId);
        if (videoId) parentVideoIds.add(videoId);
      }
      for (const videoId of parentVideoIds) {
        votesByVideo.set(videoId, (votesByVideo.get(videoId) ?? 0) + 1);
      }
    }
  });
  await Promise.all(workers);

  if (!votesByVideo.size) return null;
  const [topVideoId, topVotes] = [...votesByVideo.entries()].sort((a, b) => b[1] - a[1])[0]!;

  const videoVault = await prisma.vaultRecord.findUnique({
    where: { dnaRecordId: topVideoId },
    select: { id: true },
  });
  if (!videoVault) return null;

  const frameVaultIds = videoFrames
    .filter((f) => f.videoDnaRecordId === topVideoId)
    .map((f) => f.id);
  const frameVaultIdSet = new Set(frameVaultIds);

  const winningFindingsByTimestamp = new Map<number, FragmentReuseFinding[]>();
  for (const [tMs, findings] of findingsByTimestamp.entries()) {
    const filtered = findings.filter((f) => frameVaultIdSet.has(f.dnaRecordId));
    if (filtered.length) winningFindingsByTimestamp.set(tMs, filtered);
  }

  logger.info('[VideoComposition] Fragment-based candidate discovered', {
    videoDnaRecordId: topVideoId,
    votes: topVotes,
    discoveryFrames: probeFrameBuffers.size,
  });

  return {
    videoDnaRecordId: topVideoId,
    vaultId: videoVault.id,
    votes: topVotes,
    frameVaultIds,
    findingsByTimestamp: winningFindingsByTimestamp,
  };
}

async function buildCompositionFromFragmentMatch(
  params: { probeBuffer: Buffer; probeMimeType: string; probeFileName: string; ownerUserId: string },
  candidate: FragmentVideoCandidate,
  probeDurationSec: number,
  keyframeTimestamps: number[],
  probeFrameBuffers: Map<number, Buffer>,
): Promise<VideoCompositionResult | null> {
  const vaultSvc = new VaultService();
  const retrieved = await vaultSvc.retrieve(candidate.vaultId, params.ownerUserId).catch(() => null);
  const vaultFilename = retrieved?.originalFileName ?? 'Protected video';

  const probeDurationMs = Math.round(probeDurationSec * 1000);
  const perFrame: VideoCompositionFramePoint[] = [];
  let framesMatched = 0;

  for (let i = 0; i < PROBE_FRAME_COUNT; i++) {
    const tMs = keyframeTimestamps[i]!;
    const probeFrameBuffer = probeFrameBuffers.get(tMs);
    const probeFrameJpegBase64 = probeFrameBuffer?.toString('base64');

    if (!probeFrameBuffer) {
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId: null, breakdown: null, probeFrameJpegBase64 });
      continue;
    }

    // Reused directly from the discovery pass (see discoverCandidateVideoViaFragments)
    // instead of re-running detectSplicedFragments — discovery already searched a
    // superset that includes this candidate's own frames, so a second search over
    // the exact same probe buffer would return identical results at double the cost.
    const findings = candidate.findingsByTimestamp.get(tMs) ?? [];

    if (!findings.length) {
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId: null, breakdown: null, probeFrameJpegBase64 });
      continue;
    }

    const best = findings[0]!; // detectSplicedFragments sorts by confidence desc
    const matchedFrameDnaRecordId = best.dnaRecordId;

    try {
      // No vaultBuffer here — the probe frame and the matched vault frame are
      // different aspect ratios by definition (that's the whole crop), so a
      // whole-frame pixel/homography compare would be meaningless. This
      // exercises buildInvestigationComposition's fragment-only fallback
      // path (protectedAreaFromSignals), the same one images use for a crop
      // pasted into unrelated content.
      const breakdown = await buildInvestigationComposition({
        probeBuffer: probeFrameBuffer,
        probeMimeType: 'image/jpeg',
        vaultId: matchedFrameDnaRecordId,
        vaultFilename,
        dnaRecordId: matchedFrameDnaRecordId,
        ownerUserId: params.ownerUserId,
        fragmentFindings: findings,
        // The probe frame IS the crop (not a fragment pasted into a bigger
        // unrelated canvas), so a match spanning its whole area is correct,
        // not a sign the fragment pick should be discarded as "too complete
        // to be a real splice" — the assumption the default 70% ceiling
        // encodes for photo/collage investigation.
        allowFullFragmentCoverage: true,
      });
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId, breakdown, probeFrameJpegBase64 });
      framesMatched++;
    } catch (err) {
      logger.warn('[VideoComposition] Fragment-based per-frame composition failed (non-fatal)', {
        probeIndex: i,
        matchedFrameDnaRecordId,
        error: String(err),
      });
      perFrame.push({ probeIndex: i, tMs, matchedFrameDnaRecordId, breakdown: null, probeFrameJpegBase64 });
    }
  }

  if (!framesMatched) return null;

  const { timeline, overall } = collapseFramePointsIntoTimeline(perFrame, probeDurationMs, vaultFilename);

  logger.info('[VideoComposition] Fragment-based aggregation complete', {
    probe: params.probeFileName,
    vaultDnaRecordId: candidate.videoDnaRecordId,
    framesSampled: PROBE_FRAME_COUNT,
    framesMatched,
    overall,
    timelineSegments: timeline.length,
  });

  return {
    vaultId: candidate.vaultId,
    vaultDnaRecordId: candidate.videoDnaRecordId,
    vaultFilename,
    probeDurationMs,
    framesSampled: PROBE_FRAME_COUNT,
    framesMatched,
    overall,
    timeline,
    perFrame,
  };
}
