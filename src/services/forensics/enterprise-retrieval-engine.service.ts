/**
 * Enterprise Original Identity Retrieval Engine
 *
 * Retrieval hierarchy — exhausts preprocessing + multi-scale local DNA + vault
 * vector search BEFORE the 15-layer forensic verifier runs.
 *
 * Does NOT replace DNA generation, vault storage, or layer architecture.
 */
import { logger } from '../../lib/logger';
import { forensicImagePreprocessor } from './forensic-image-preprocessor.service';
import { vaultLocalDnaSearchService, type LocalDnaSearchHit } from './vault-local-dna-search.service';
import { pinitIdentificationConfig } from '../../config/pinit-identification';

export interface RetrievalProbe {
  label: string;
  buffer: Buffer;
  mimeType: string;
}

export interface EnterpriseRetrievalResult {
  probes: RetrievalProbe[];
  localDnaHits: LocalDnaSearchHit[];
  bestProbe: RetrievalProbe;
  topVaultId: string | null;
  totalPatchVotes: number;
  retrievalConfidence: number;
}

function mergeLocalHits(allHits: LocalDnaSearchHit[]): LocalDnaSearchHit[] {
  const byVault = new Map<string, LocalDnaSearchHit>();

  for (const hit of allHits) {
    const prev = byVault.get(hit.vaultId);
    if (!prev) {
      byVault.set(hit.vaultId, { ...hit, signals: [...hit.signals] });
      continue;
    }
    prev.patchMatchCount = Math.max(prev.patchMatchCount, hit.patchMatchCount);
    prev.compositeScore = Math.max(prev.compositeScore, hit.compositeScore);
    prev.matchRatio = Math.max(prev.matchRatio, hit.matchRatio);
    prev.spatialConsistency = Math.max(prev.spatialConsistency, hit.spatialConsistency);
    prev.orbRefineScore = Math.max(prev.orbRefineScore, hit.orbRefineScore);
    prev.coverageRatio = Math.max(prev.coverageRatio, hit.coverageRatio);
    const agreements = (prev.signals.filter((s) => s === 'probe_agreement').length || 0) + 1;
    prev.signals = [...new Set([
      ...prev.signals.filter((s) => s !== 'probe_agreement'),
      ...hit.signals,
      'multi_probe_merge',
      ...(agreements >= 2 ? ['probe_agreement'] : []),
    ])];
  }

  const merged = [...byVault.values()];
  for (const hit of merged) {
    const probeBoost = hit.signals.includes('probe_agreement') ? 6 : 0;
    hit.compositeScore = Math.min(99, Math.round(
      hit.compositeScore * 0.65
      + Math.min(hit.patchMatchCount, 200) * 0.12
      + hit.spatialConsistency * 22
      + hit.orbRefineScore * 0.15
      + probeBoost,
    ));
    if (hit.patchMatchCount >= 50) hit.signals.push('high_vote_count');
  }
  merged.sort((a, b) => b.patchMatchCount - a.patchMatchCount || b.compositeScore - a.compositeScore);
  return merged;
}

export class EnterpriseRetrievalEngine {
  /**
   * Run full retrieval hierarchy on a probe image.
   * Tries original + forensic variants; merges patch votes across all probes.
   */
  async retrieve(
    buffer: Buffer,
    mimeType: string,
    ownerUserId: string,
    options?: {
      skipOrbRefine?: boolean;
      fullVariants?: boolean;
      investigationFast?: boolean;
      candidateVaultIds?: string[];
      maxProbes?: number;
      patchScales?: number[];
    },
  ): Promise<EnterpriseRetrievalResult> {
    const useScanner = options?.investigationFast
      ? false
      : pinitIdentificationConfig.phase5ScannerPipeline;
    const variants = await forensicImagePreprocessor.generateVariants(buffer, mimeType, {
      fast: options?.investigationFast || (!options?.fullVariants && !useScanner),
      scanner: useScanner,
    });

    let probes: RetrievalProbe[] = variants.map((v) => ({
      label: v.label,
      buffer: v.buffer,
      mimeType: v.mimeType,
    }));

    if (options?.investigationFast) {
      const keep = new Set(['original', 'normalized', 'denoised']);
      probes = probes.filter((p) => keep.has(p.label));
    }
    if (options?.maxProbes && probes.length > options.maxProbes) {
      probes = probes.slice(0, options.maxProbes);
    }

    const searchOpts = {
      skipOrbRefine: options?.skipOrbRefine,
      candidateVaultIds: options?.candidateVaultIds,
      patchScales: options?.patchScales,
    };

    const allHits: LocalDnaSearchHit[] = [];

    // Search probes in parallel (bounded)
    const batchSize = options?.investigationFast ? probes.length : 3;
    for (let i = 0; i < probes.length; i += batchSize) {
      const batch = probes.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((p) => vaultLocalDnaSearchService.search(
          p.buffer, ownerUserId, p.mimeType, searchOpts,
        )),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') allHits.push(...r.value);
      }
    }

    const localDnaHits = mergeLocalHits(allHits);
    const top = localDnaHits[0] ?? null;
    const bestProbe = probes[0]!;

    const totalPatchVotes = top?.patchMatchCount ?? 0;
    const second = localDnaHits[1];
    const voteMargin = totalPatchVotes - (second?.patchMatchCount ?? 0);
    const retrievalConfidence = top
      ? Math.min(99, Math.round(
        top.compositeScore * 0.65
        + Math.min(totalPatchVotes, 200) * 0.15
        + top.orbRefineScore * 0.1
        + Math.min(voteMargin, 80) * 0.1,
      ))
      : 0;

    logger.info('[EnterpriseRetrieval] Complete', {
      probes: probes.length,
      vaultHits: localDnaHits.length,
      topVault: top?.vaultId?.slice(0, 8),
      patchVotes: totalPatchVotes,
      confidence: retrievalConfidence,
    });

    return {
      probes,
      localDnaHits,
      bestProbe,
      topVaultId: top?.vaultId ?? null,
      totalPatchVotes,
      retrievalConfidence,
    };
  }
}

export const enterpriseRetrievalEngine = new EnterpriseRetrievalEngine();
