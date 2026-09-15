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
import { PIXEL_EVIDENCE_POLICY } from '../../types/dna-vnext.types';
import { pixelSourceConfig } from '../../config/pixel-source';
import type { CompositionHowWeKnow } from '../../types/investigation-composition.types';
import { stampRegionForensicFields } from './forensic-result-state';

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
 * Collage host pixels default to GREY (unknown) unless a separate AI detector
 * is confidently positive — never auto-paint remainder orange.
 */
export function splitProbeComposition(
  protectedAreaPercent: number,
  aiProbability: number | null,
  options?: { collageRemainderIsUnknown?: boolean },
): { protectedFromAssetPercent: number; aiGeneratedPercent: number; otherPercent: number; aiSuspectedPercent: number | null } {
  const protectedPct = round1(clampPct(protectedAreaPercent));
  const remaining = round1(Math.max(0, 100 - protectedPct));
  const aiSuspectedPercent = aiProbability == null ? null : round1(clampPct(aiProbability));
  // Mask buckets only. AI detector score is independent and must not fill orange.
  void options;
  return {
    protectedFromAssetPercent: protectedPct,
    aiGeneratedPercent: 0,
    otherPercent: remaining,
    aiSuspectedPercent,
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
      label: 'Non-Vault',
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

function evidencePolicy() {
  return {
    ...PIXEL_EVIDENCE_POLICY,
    evidenceRadiusPx: pixelSourceConfig.evidenceRadiusPx,
    minAuthenticableAreaPx: pixelSourceConfig.minAuthenticableAreaPx,
    maskEncoding: pixelSourceConfig.maskEncoding,
  } as const;
}

export function buildHowWeKnow(input: {
  vaultId?: string;
  vaultFilename?: string;
  dnaRecordId?: string;
  certificateId?: string;
  protectedPercent: number;
  regionCount: number;
}): CompositionHowWeKnow {
  const hasSource = (input.protectedPercent >= 0.4) && Boolean(input.vaultId);
  const narrative = hasSource
    ? `This protected source was enrolled in PinIT Hub`
      + (input.vaultId ? ` under Vault ID ${input.vaultId}` : '')
      + (input.dnaRecordId ? `, DNA Record ${input.dnaRecordId}` : '')
      + (input.certificateId ? `, and Certificate ${input.certificateId}` : '')
      + `. The investigation identified a spatial correspondence between the suspect image and the enrolled Vault source`
      + (input.vaultFilename ? ` (${input.vaultFilename})` : '')
      + `. Mapped regions passed available spatial similarity tests. Highlighted pixels are classified as Vault-origin because they sit in a sufficiently authenticated region — a pixel does not contain a Vault ID.`
    : 'No verified Vault-origin region was established. Grey means insufficient evidence. Orange is used only where a mapped region is confidently not from this Vault. That is not the same as “definitely AI generated.”';
  return {
    narrative,
    vaultId: input.vaultId,
    vaultFilename: input.vaultFilename,
    dnaRecordId: input.dnaRecordId,
    certificateId: input.certificateId,
    independentPixelContainsVaultId: false,
  };
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
  /**
   * Skip the LOCALIZED_MAX_PCT (70%) ceiling on the fragment pick. That
   * ceiling exists to route "this basically covers the whole probe" matches
   * to the whole-image comparison path instead (a near-100% fragment match
   * on a photo usually means it isn't really a small pasted fragment). It
   * does not apply when the probe is ITSELF already a crop of the vault
   * original with no whole-image comparison available (different aspect
   * ratios by definition) — there, a match spanning the full probe canvas
   * is the expected, correct signal, not a sign the fragment pick is wrong.
   */
  allowFullFragmentCoverage?: boolean;
}): SpatialPick {
  const top = input.fragmentFindings[0];
  const crop = input.cropDetection;
  const fragPct = top
    ? coverageOf(top.probeCoveragePercent, top.probeRegion)
    : 0;
  const cropPct = coverageOf(crop?.probeCoveragePercent, crop?.probeRegion);
  const fragCoverageOk = input.allowFullFragmentCoverage
    ? fragPct >= MIN_PROTECTED_PCT
    : isLocalizedCoverage(fragPct);

  const cropPick: SpatialPick | null = crop?.probeRegion && isLocalizedCoverage(cropPct)
    ? {
        protectedAreaPercent: cropPct,
        originalUsedPercent: crop.vaultCoveragePercent
          ?? (crop.vaultRegion ? regionAreaPercent(crop.vaultRegion) : null),
        probeRegion: crop.probeRegion,
        vaultRegion: crop.vaultRegion,
      }
    : null;

  const fragPick: SpatialPick | null = top && fragCoverageOk
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
  dnaRecordId?: string;
  certificateId?: string;
  ownerUserId?: string;
  candidateSources?: ImageCompositionBreakdown['candidateSources'];
  fragmentFindings: FragmentReuseFinding[];
  localDnaHit?: { matchRatio: number; coverageRatio: number; patchMatchCount: number } | null;
  aiProbability?: number | null;
  scan?: ForensicScanResult | null;
  /** See protectedAreaFromSignals — set when the probe is itself already a
   *  crop with no whole-image comparison available (e.g. a spatially
   *  cropped video frame), so a fragment match spanning the whole probe
   *  canvas is expected and correct, not a "not really a fragment" signal. */
  allowFullFragmentCoverage?: boolean;
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
    const aiSuspectedPercent = resolveAiProbabilityFromScan(scan);
    const stampedRegions = (pixelSource.regions ?? []).map((r) => stampRegionForensicFields({
      ...r,
      sourceVaultId: input.vaultId,
    }, {
      hmacVerified: false,
      provenanceDetected: Boolean(input.certificateId || input.dnaRecordId),
      aiDetectorPositive: (aiSuspectedPercent ?? 0) >= 70,
    }));

    if (input.ownerUserId && input.probeBuffer && input.candidateSources?.length) {
      try {
        const { VaultService } = await import('../vault/vault.service');
        const { forensicScannerService } = await import('./forensic-scanner.service');
        const extraVault = new VaultService();
        for (const src of input.candidateSources.slice(0, 2)) {
          if (!src.vaultId || src.vaultId === input.vaultId) continue;
          const vf = await extraVault.retrieve(src.vaultId, input.ownerUserId);
          if (!vf?.originalBuffer) continue;
          const extra = await forensicScannerService.scanProbe(input.probeBuffer, mime, vf.originalBuffer);
          const extraPix = fromPythonPixelSource(extra.pixelSource ?? null);
          if (!extraPix?.regions?.length) continue;
          for (const r of extraPix.regions.slice(0, 4)) {
            if ((r.coveragePercent ?? 0) < 0.4) continue;
            stampedRegions.push(stampRegionForensicFields({
              ...r,
              id: r.id ? `${src.vaultId.slice(0, 6)}-${r.id}` : `src-${src.vaultId.slice(0, 6)}`,
              sourceVaultId: src.vaultId,
            }, {
              hmacVerified: false,
              provenanceDetected: Boolean(src.dnaRecordId),
              aiDetectorPositive: false,
            }));
          }
        }
      } catch {
        /* extra vault regions optional */
      }
    }

    const extraNames = (input.candidateSources ?? [])
      .map((s) => s.filename)
      .filter(Boolean)
      .slice(0, 3);
    const reason = extraNames.length
      ? `Multiple Vault sources located separately: ${input.vaultFilename ?? 'primary'}${extraNames.map((n) => `, ${n}`).join('')}. Each region keeps its own vault identity.`
      : vaultPct >= 50
      ? 'Majority of the image matches the authenticated Vault content. Percents are pixel-mask coverage, not retrieval similarity.'
      : vaultPct >= 0.4
        ? `A protected region from ${input.vaultFilename ?? 'the vault original'} was located. Remaining pixels are non-vault (orange, mapped mismatch) or unknown (grey). Not retrieval confidence.`
        : 'No verified protected Vault region was detected. Grey = insufficient evidence. Orange is not automatically “AI generated.”';
    return {
      ...parts,
      nonVaultPercent: parts.aiGeneratedPercent,
      aiSuspectedPercent,
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
      dnaRecordId: input.dnaRecordId,
      certificateId: input.certificateId,
      candidateSources: input.candidateSources,
      howWeKnow: buildHowWeKnow({
        vaultId: input.vaultId,
        vaultFilename: input.vaultFilename,
        dnaRecordId: input.dnaRecordId,
        certificateId: input.certificateId,
        protectedPercent: vaultPct,
        regionCount: stampedRegions.length,
      }),
      pixelSource: {
        originalPixels: pixelSource.originalPixels,
        aiSuspectedPixels: pixelSource.aiSuspectedPixels,
        unknownPixels: pixelSource.unknownPixels,
        totalPixels: pixelSource.totalPixels,
        homographyVaultToProbe: pixelSource.homographyVaultToProbe,
        regions: stampedRegions,
        method: pixelSource.method,
        evidenceRadius: pixelSource.evidenceRadius ?? pixelSourceConfig.evidenceRadiusPx,
        transformation: pixelSource.transformation,
      },
      evidenceModel: evidencePolicy(),
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
      dnaRecordId: input.dnaRecordId,
      certificateId: input.certificateId,
      candidateSources: input.candidateSources,
      howWeKnow: buildHowWeKnow({
        vaultId: input.vaultId,
        vaultFilename: input.vaultFilename,
        dnaRecordId: input.dnaRecordId,
        certificateId: input.certificateId,
        protectedPercent: parts.protectedFromAssetPercent,
        regionCount: 0,
      }),
      evidenceModel: evidencePolicy(),
    };
  }

  const spatial = protectedAreaFromSignals({
    fragmentFindings: input.fragmentFindings,
    localDnaHit: input.localDnaHit,
    cropDetection: scan?.cropDetection,
    allowFullFragmentCoverage: input.allowFullFragmentCoverage,
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

  const aiModelAvailable = aiProbability != null;
  const parts = splitProbeComposition(spatial.protectedAreaPercent, aiProbability, {
    collageRemainderIsUnknown: collageLocated,
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
    reason = 'No verified protected Vault region was detected. Grey = insufficient evidence. A non-Vault photograph is not classified as AI-generated.';
  }

  return {
    ...parts,
    nonVaultPercent: parts.aiGeneratedPercent,
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
    dnaRecordId: input.dnaRecordId,
    certificateId: input.certificateId,
    candidateSources: input.candidateSources,
    howWeKnow: buildHowWeKnow({
      vaultId: input.vaultId,
      vaultFilename: input.vaultFilename,
      dnaRecordId: input.dnaRecordId,
      certificateId: input.certificateId,
      protectedPercent: parts.protectedFromAssetPercent,
      regionCount: 0,
    }),
    evidenceModel: evidencePolicy(),
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
    evidenceModel: composition.evidenceModel ?? PIXEL_EVIDENCE_POLICY,
  };
}

