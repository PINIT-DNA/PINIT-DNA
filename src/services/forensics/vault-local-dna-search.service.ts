/**
 * Vault Local DNA Search — Google-Lens-style patch voting across vault feature index.
 * Finds original vault assets from partial crops, screenshots, and edited fragments.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { localDnaConfig } from '../../config/local-dna';
import { localDnaPatchGenerator, patchFingerprintsMatch, type PatchFingerprint } from './local-dna-patch-generator.service';
import { aiService } from '../ai/ai-embeddings.service';
import { VaultService } from '../vault/vault.service';

const vaultService = new VaultService();

export interface LocalDnaSearchHit {
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  filename?: string;
  patchMatchCount: number;
  probePatchCount: number;
  vaultPatchCount: number;
  matchRatio: number;
  coverageRatio: number;
  spatialConsistency: number;
  orbRefineScore: number;
  compositeScore: number;
  signals: string[];
}

interface PatchMatch {
  probeGx: number;
  probeGy: number;
  vaultGx: number;
  vaultGy: number;
}

function spatialConsistency(matches: PatchMatch[]): number {
  if (matches.length < 2) return matches.length ? 1 : 0;
  const offsetCounts = new Map<string, number>();
  for (const m of matches) {
    const key = `${m.vaultGx - m.probeGx},${m.vaultGy - m.probeGy}`;
    offsetCounts.set(key, (offsetCounts.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(...offsetCounts.values());
  return maxCount / matches.length;
}

function buildVaultPrefixMap(
  patches: Array<{ patchIndex: number; gridX: number; gridY: number; pHash16: string }>,
): Map<string, typeof patches> {
  const map = new Map<string, typeof patches>();
  for (const vp of patches) {
    const prefix = vp.pHash16.slice(0, 4);
    const list = map.get(prefix) ?? [];
    list.push(vp);
    map.set(prefix, list);
  }
  return map;
}

export class VaultLocalDnaSearchService {
  /**
   * Extract probe patches and search owner's vault feature index.
   */
  async search(
    probeBuffer: Buffer,
    ownerUserId: string,
    mimeType: string,
  ): Promise<LocalDnaSearchHit[]> {
    if (!localDnaConfig.enabled || !mimeType.startsWith('image/')) return [];

    const probeGrid = await localDnaPatchGenerator.generateGrid(probeBuffer);
    if (!probeGrid.patches.length) return [];

    const indexes = await prisma.localFeatureIndex.findMany({
      where: { ownerUserId, status: 'COMPLETE' },
      include: {
        patches: {
          select: {
            patchIndex: true, gridX: true, gridY: true, pHash16: true,
          },
        },
        dnaRecord: { select: { imageFilename: true } },
      },
    });

    if (!indexes.length) {
      logger.debug('[LocalDnaSearch] No vault indexes for owner', { ownerUserId: ownerUserId.slice(0, 8) });
      return [];
    }

    const hits: LocalDnaSearchHit[] = [];

    for (const idx of indexes) {
      if (!idx.vaultId || !idx.patches.length) continue;

      const vaultByPrefix = buildVaultPrefixMap(idx.patches);
      const patchMatches: PatchMatch[] = [];
      const matchedVaultPatches = new Set<number>();

      for (const probePatch of probeGrid.patches) {
        const prefix = probePatch.pHash16.slice(0, 4);
        const candidates = vaultByPrefix.get(prefix) ?? [];

        for (const vaultPatch of candidates) {
          if (matchedVaultPatches.has(vaultPatch.patchIndex)) continue;
          if (patchFingerprintsMatch(probePatch.pHash16, vaultPatch.pHash16)) {
            patchMatches.push({
              probeGx: probePatch.gridX,
              probeGy: probePatch.gridY,
              vaultGx: vaultPatch.gridX,
              vaultGy: vaultPatch.gridY,
            });
            matchedVaultPatches.add(vaultPatch.patchIndex);
            break;
          }
        }
      }

      const patchMatchCount = patchMatches.length;
      const matchRatio = patchMatchCount / probeGrid.patches.length;
      const coverageRatio = patchMatchCount / idx.patches.length;
      const spatial = spatialConsistency(patchMatches);

      if (patchMatchCount < localDnaConfig.minPatchMatches) continue;
      if (matchRatio < localDnaConfig.minMatchRatio && patchMatchCount < 15) continue;
      if (spatial < localDnaConfig.minSpatialConsistency && matchRatio < 0.15) continue;

      let compositeScore = Math.round(
        matchRatio * 55
        + spatial * 25
        + Math.min(patchMatchCount, 80) * 0.25
        + coverageRatio * 10,
      );
      compositeScore = Math.min(99, compositeScore);

      const signals = ['local_patch_dna', 'patch_voting'];
      if (matchRatio >= 0.10) signals.push('fragment_recovery');
      if (spatial >= 0.7) signals.push('spatial_consistent_crop');
      if (patchMatchCount >= 20) signals.push('high_patch_density');

      hits.push({
        vaultId: idx.vaultId,
        dnaRecordId: idx.dnaRecordId,
        ownerUserId: idx.ownerUserId,
        filename: idx.dnaRecord.imageFilename,
        patchMatchCount,
        probePatchCount: probeGrid.patches.length,
        vaultPatchCount: idx.patches.length,
        matchRatio: Math.round(matchRatio * 1000) / 1000,
        coverageRatio: Math.round(coverageRatio * 1000) / 1000,
        spatialConsistency: Math.round(spatial * 1000) / 1000,
        orbRefineScore: 0,
        compositeScore,
        signals,
      });
    }

    hits.sort((a, b) => b.compositeScore - a.compositeScore);

    // ORB refine top-K hits
    const topK = hits.slice(0, localDnaConfig.orbRefineTopK);
    await Promise.allSettled(topK.map(async (hit) => {
      try {
        const original = await vaultService.retrieve(hit.vaultId, ownerUserId);
        const orb = await aiService.compareImages(probeBuffer, original.originalBuffer);
        if (orb) {
          hit.orbRefineScore = Math.round(orb.similarity * 100);
          hit.compositeScore = Math.min(99, Math.round(
            hit.compositeScore * 0.65 + hit.orbRefineScore * 0.35,
          ));
          if (hit.orbRefineScore >= 50) hit.signals.push('opencv_orb');
        }
      } catch { /* optional refine */ }
    }));

    hits.sort((a, b) => b.compositeScore - a.compositeScore);

    logger.info('[LocalDnaSearch] Complete', {
      probePatches: probeGrid.patches.length,
      vaultIndexes: indexes.length,
      hits: hits.length,
      topScore: hits[0]?.compositeScore ?? 0,
    });

    return hits;
  }

  /** Generate probe patches only (for indexing reuse). */
  async extractProbePatches(buffer: Buffer): Promise<PatchFingerprint[]> {
    const grid = await localDnaPatchGenerator.generateGrid(buffer);
    return grid.patches;
  }
}

export const vaultLocalDnaSearchService = new VaultLocalDnaSearchService();
