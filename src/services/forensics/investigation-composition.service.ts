/**
 * Investigation image composition — protected reuse vs AI vs other on the probe,
 * plus a separate "how much of the original was used" meter.
 */
import type { FragmentReuseFinding } from '../../types/unified-investigation.types';
import type {
  CompositionLabel,
  ImageCompositionBreakdown,
} from '../../types/investigation-composition.types';
import type { ForensicScanResult } from './forensic-scanner.service';
import type { BlockDnaInvestigationResult } from '../../types/block-dna.types';
import { fromPythonPixelSource } from './pixel-source-map.service';

export const COMPOSITION_COLORS = {
  protected: '#10B981',
  ai: '#F59E0B',
  other: '#94A3B8',
  originalUsed: '#0D9488',
} as const;

const MIN_PROTECTED_PCT = 1.0;
const COLLAPSED_PCT = 1.5;
const LOCALIZED_MAX_PCT = 70;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function regionAreaPercent(region: {
  widthPercent: number;
  heightPercent: number;
}): number {
  return round1(Math.max(0, Math.min(100, (region.widthPercent * region.heightPercent) / 100)));
}

export function resolveAiProbabilityFromScan(scan?: ForensicScanResult | null): number | null {
  if (!scan) return null;
  const ens = scan.authenticityEnsemble?.aiProbability;
  if (typeof ens === 'number' && Number.isFinite(ens)) return clampPct(ens);
  const gen = scan.aiManipulation?.generatedConfidencePercent;
  if (typeof gen === 'number' && Number.isFinite(gen)) return clampPct(gen);
  const conf = scan.aiManipulation?.aiGeneratedConfidence;
  if (typeof conf === 'number' && Number.isFinite(conf)) {
    return clampPct(conf <= 1 ? conf * 100 : conf);
  }
  return null;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Split the uploaded image into three buckets that sum to 100.
 * Protected pixels win over the AI model (a pasted crop of a real photo is not "AI").
 *
 * Whole-image AI probability is a classifier score, not a pixel fraction.
 * For a located collage (crop pasted into a new scene), unmatched pixels are
 * the host image — counted as AI, not "other × probability".
 */
export function splitProbeComposition(
  protectedAreaPercent: number,
  aiProbability: number | null,
  options?: { collageRemainderIsAi?: boolean },
): { protectedFromAssetPercent: number; aiGeneratedPercent: number; otherPercent: number } {
  const protectedPct = round1(clampPct(protectedAreaPercent));
  const remaining = round1(Math.max(0, 100 - protectedPct));
  if (options?.collageRemainderIsAi && protectedPct >= MIN_PROTECTED_PCT) {
    return {
      protectedFromAssetPercent: protectedPct,
      aiGeneratedPercent: remaining,
      otherPercent: 0,
    };
  }
  if (aiProbability == null) {
    return {
      protectedFromAssetPercent: protectedPct,
      aiGeneratedPercent: 0,
      otherPercent: remaining,
    };
  }
  const aiShare = clampPct(aiProbability) / 100;
  const aiPct = round1(remaining * aiShare);
  let otherPct = round1(100 - protectedPct - aiPct);
  if (otherPct < 0) otherPct = 0;
  const drift = round1(protectedPct + aiPct + otherPct - 100);
  if (Math.abs(drift) > 0.05) {
    otherPct = round1(otherPct - drift);
  }
  return {
    protectedFromAssetPercent: protectedPct,
    aiGeneratedPercent: aiPct,
    otherPercent: Math.max(0, otherPct),
  };
}

export function buildCompositionLabels(parts: {
  protectedFromAssetPercent: number;
  aiGeneratedPercent: number;
  otherPercent: number;
}): CompositionLabel[] {
  return [
    {
      key: 'protected',
      label: 'Protected Vault content',
      percent: parts.protectedFromAssetPercent,
      color: COMPOSITION_COLORS.protected,
    },
    {
      key: 'ai',
      label: 'AI / Non-Vault content',
      percent: parts.aiGeneratedPercent,
      color: COMPOSITION_COLORS.ai,
    },
    {
      key: 'other',
      label: 'Unknown',
      percent: parts.otherPercent,
      color: COMPOSITION_COLORS.other,
    },
  ];
}

type SpatialPick = {
  protectedAreaPercent: number;
  originalUsedPercent: number | null;
  probeRegion?: FragmentReuseFinding['probeRegion'];
  vaultRegion?: FragmentReuseFinding['vaultRegion'];
};

function coverageOf(
  explicit: number | undefined,
  region?: { widthPercent: number; heightPercent: number },
): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return round1(clampPct(explicit));
  if (region) return regionAreaPercent(region);
  return 0;
}

function isLocalizedCoverage(pct: number): boolean {
  return pct >= MIN_PROTECTED_PCT && pct <= LOCALIZED_MAX_PCT;
}

/**
 * Prefer a real paste bbox (warp / template / expanded crop) over a collapsed
 * ORB/patch island (e.g. 0.3% around a tree trunk).
 */
export function protectedAreaFromSignals(input: {
  fragmentFindings: FragmentReuseFinding[];
  localDnaHit?: { matchRatio: number; coverageRatio: number; patchMatchCount: number } | null;
  cropDetection?: ForensicScanResult['cropDetection'] | null;
}): SpatialPick {
  const top = input.fragmentFindings[0];
  const crop = input.cropDetection;
  const fragPct = top
    ? coverageOf(top.probeCoveragePercent, top.probeRegion)
    : 0;
  const cropPct = coverageOf(crop?.probeCoveragePercent, crop?.probeRegion);

  const cropPick: SpatialPick | null = crop?.probeRegion && isLocalizedCoverage(cropPct)
    ? {
        protectedAreaPercent: cropPct,
        originalUsedPercent: crop.vaultCoveragePercent
          ?? (crop.vaultRegion ? regionAreaPercent(crop.vaultRegion) : null),
        probeRegion: crop.probeRegion,
        vaultRegion: crop.vaultRegion,
      }
    : null;

  const fragPick: SpatialPick | null = top && isLocalizedCoverage(fragPct)
    ? {
        protectedAreaPercent: fragPct,
        originalUsedPercent: top.vaultCoveragePercent
          ?? regionAreaPercent(top.vaultRegion),
        probeRegion: top.probeRegion,
        vaultRegion: top.vaultRegion,
      }
    : null;

  if (cropPick && fragPick) {
    const fragmentCollapsed = fragPct < COLLAPSED_PCT;
    if (fragmentCollapsed || cropPct >= fragPct * 1.25) return cropPick;
    return fragPick;
  }
  if (cropPick) return cropPick;
  if (fragPick) return fragPick;

  const originalUsedFromFrag = top
    ? (top.vaultCoveragePercent ?? regionAreaPercent(top.vaultRegion))
    : null;

  const hit = input.localDnaHit;
  if (hit && hit.patchMatchCount > 0 && hit.matchRatio > 0 && hit.matchRatio <= 0.4) {
    return {
      protectedAreaPercent: round1(clampPct(hit.matchRatio * 100)),
      originalUsedPercent: round1(clampPct(hit.coverageRatio * 100)),
    };
  }

  return {
    protectedAreaPercent: 0,
    originalUsedPercent: originalUsedFromFrag,
    probeRegion: crop?.probeRegion ?? top?.probeRegion,
    vaultRegion: crop?.vaultRegion ?? top?.vaultRegion,
  };
}

export async function buildInvestigationComposition(input: {
  probeBuffer?: Buffer;
  probeMimeType?: string;
  vaultBuffer?: Buffer;
  vaultId?: string;
  vaultFilename?: string;
  fragmentFindings: FragmentReuseFinding[];
  localDnaHit?: { matchRatio: number; coverageRatio: number; patchMatchCount: number } | null;
  aiProbability?: number | null;
  scan?: ForensicScanResult | null;
}): Promise<ImageCompositionBreakdown> {
  let scan = input.scan ?? null;
  const mime = input.probeMimeType ?? '';
  if (
    input.probeBuffer
    && input.vaultBuffer
    && mime.startsWith('image/')
  ) {
    try {
      const { forensicScannerService } = await import('./forensic-scanner.service');
      const withRef = await forensicScannerService.scanProbe(
        input.probeBuffer,
        mime,
        input.vaultBuffer,
      );
      if (withRef.available) scan = withRef;
    } catch {
      /* block overlay optional */
    }
  }

  const pixelSource = fromPythonPixelSource(scan?.pixelSource ?? null);
  if (pixelSource && pixelSource.totalPixels > 0) {
    const parts = {
      protectedFromAssetPercent: round1(clampPct(pixelSource.protectedFromAssetPercent)),
      aiGeneratedPercent: round1(clampPct(pixelSource.aiGeneratedPercent)),
      otherPercent: round1(clampPct(pixelSource.otherPercent)),
    };
    const spatial = protectedAreaFromSignals({
      fragmentFindings: input.fragmentFindings,
      localDnaHit: input.localDnaHit,
      cropDetection: scan?.cropDetection,
    });
    const vaultPct = parts.protectedFromAssetPercent;
    const reason = vaultPct >= 50
      ? 'Majority of the image matches the authenticated Vault content.'
      : vaultPct >= 0.4
        ? `A protected region from ${input.vaultFilename ?? 'the vault original'} was located. Remaining pixels are non-vault or unknown based on this source match — not retrieval confidence.`
        : 'No verified protected Vault region was detected. Remaining content is classified as non-Vault/AI-suspected or unknown based on available evidence.';
    return {
      ...parts,
      originalUsedPercent: pixelSource.originalUsedPercent,
      quantifiable: true,
      estimate: false,
      reason,
      overlayPngBase64: pixelSource.overlayPngBase64,
      maskPngBase64: pixelSource.maskPngBase64,
      labels: buildCompositionLabels(parts),
      probeRegion: pixelSource.probeRegion ?? spatial.probeRegion,
      vaultRegion: spatial.vaultRegion,
      aiModelAvailable: true,
      vaultId: input.vaultId,
      vaultFilename: input.vaultFilename,
      pixelSource: {
        originalPixels: pixelSource.originalPixels,
        aiSuspectedPixels: pixelSource.aiSuspectedPixels,
        unknownPixels: pixelSource.unknownPixels,
        totalPixels: pixelSource.totalPixels,
        homographyVaultToProbe: pixelSource.homographyVaultToProbe,
        regions: pixelSource.regions,
        method: pixelSource.method,
      },
    };
  }

  const blocks = scan?.blockComposition;
  if (
    blocks
    && typeof blocks.protectedFromAssetPercent === 'number'
    && typeof blocks.aiGeneratedPercent === 'number'
  ) {
    const parts = {
      protectedFromAssetPercent: round1(clampPct(blocks.protectedFromAssetPercent)),
      aiGeneratedPercent: round1(clampPct(blocks.aiGeneratedPercent)),
      otherPercent: round1(clampPct(
        typeof blocks.otherPercent === 'number'
          ? blocks.otherPercent
          : 100 - blocks.protectedFromAssetPercent - blocks.aiGeneratedPercent,
      )),
    };
    const spatial = protectedAreaFromSignals({
      fragmentFindings: input.fragmentFindings,
      localDnaHit: input.localDnaHit,
      cropDetection: scan?.cropDetection,
    });
    const majority = parts.protectedFromAssetPercent >= 50;
    return {
      ...parts,
      originalUsedPercent: spatial.originalUsedPercent,
      quantifiable: true,
      estimate: false,
      reason: majority
        ? 'Majority of the image matches the authenticated Vault content.'
        : 'Green is vault-origin content located in this upload. Orange is non-vault / AI-suspected. Gray is unknown. These percents are pixel coverage, not retrieval similarity.',
      overlayPngBase64: blocks.overlayPngBase64,
      blockGrid: blocks.grid,
      labels: buildCompositionLabels(parts),
      probeRegion: blocks.probeRegion ?? spatial.probeRegion,
      vaultRegion: spatial.vaultRegion,
      aiModelAvailable: true,
      vaultId: input.vaultId,
      vaultFilename: input.vaultFilename,
    };
  }

  const spatial = protectedAreaFromSignals({
    fragmentFindings: input.fragmentFindings,
    localDnaHit: input.localDnaHit,
    cropDetection: scan?.cropDetection,
  });

  let aiProbability = input.aiProbability ?? resolveAiProbabilityFromScan(scan);
  if (aiProbability == null && input.probeBuffer && mime.startsWith('image/')) {
    try {
      const { forensicScannerService } = await import('./forensic-scanner.service');
      const extra = await forensicScannerService.scanProbe(input.probeBuffer, mime);
      aiProbability = resolveAiProbabilityFromScan(extra);
    } catch {
      /* AI sidecar optional */
    }
  }
  if (aiProbability == null && input.probeBuffer && mime.startsWith('image/')) {
    try {
      const { probeAiGeneration } = await import('../vault/ai-generation.engine');
      const probe = await probeAiGeneration(input.probeBuffer, mime, 'probe');
      if (probe.score > 0) aiProbability = probe.score;
    } catch {
      /* Node heuristic optional */
    }
  }
  const collageLocated = spatial.protectedAreaPercent >= MIN_PROTECTED_PCT
    && spatial.protectedAreaPercent <= LOCALIZED_MAX_PCT
    && (
      input.fragmentFindings.length > 0
      || (spatial.originalUsedPercent != null && spatial.originalUsedPercent >= 8)
      || Boolean(scan?.cropDetection?.probeRegion)
    );

  if (collageLocated && (aiProbability == null || aiProbability < 55)) {
    aiProbability = Math.max(aiProbability ?? 0, 80);
  }

  const aiModelAvailable = aiProbability != null;
  const parts = splitProbeComposition(spatial.protectedAreaPercent, aiProbability, {
    collageRemainderIsAi: collageLocated,
  });
  const hasImage = Boolean(input.probeBuffer && mime.startsWith('image/'));
  const quantifiable = hasImage;

  let reason: string;
  if (parts.protectedFromAssetPercent >= MIN_PROTECTED_PCT && parts.aiGeneratedPercent > 0) {
    reason = `A protected region from ${input.vaultFilename ?? 'the vault original'} was located. Remaining pixels are non-vault or unknown based on available evidence.`;
  } else if (parts.protectedFromAssetPercent >= MIN_PROTECTED_PCT) {
    reason = 'Green is the area that matches your protected file.';
  } else if (input.fragmentFindings.length > 0 && parts.protectedFromAssetPercent < MIN_PROTECTED_PCT) {
    reason = 'Protected content may be present, but no verified pixel-level vault region was outlined on this run.';
  } else {
    reason = 'No verified protected Vault region was detected. Remaining content is classified as non-Vault/AI-suspected or unknown based on available evidence.';
  }

  return {
    ...parts,
    originalUsedPercent: spatial.originalUsedPercent,
    quantifiable,
    estimate: true,
    reason,
    labels: buildCompositionLabels(parts),
    probeRegion: spatial.probeRegion,
    vaultRegion: spatial.vaultRegion,
    aiModelAvailable,
    vaultId: input.vaultId,
    vaultFilename: input.vaultFilename,
  };
}

export function applyBlockDnaToComposition(
  composition: ImageCompositionBreakdown,
  blockDna: BlockDnaInvestigationResult | null | undefined,
): ImageCompositionBreakdown {
  if (!blockDna?.available || blockDna.totalBlocks < 1) return composition;
  const parts = {
    protectedFromAssetPercent: blockDna.originalBlockPercent,
    aiGeneratedPercent: blockDna.modifiedBlockPercent,
    otherPercent: blockDna.unknownBlockPercent,
  };
  return {
    ...composition,
    ...parts,
    quantifiable: true,
    estimate: false,
    reason: blockDna.narrative,
    blockGrid: blockDna.blockGrid,
    labels: buildCompositionLabels(parts),
  };
}

