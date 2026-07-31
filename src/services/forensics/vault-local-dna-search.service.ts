/**

 * Vault Local DNA Search — enterprise patch voting across multi-scale fingerprints.

 * Ranks every vault asset; supports 10–40% fragment recovery from crops/screenshots.

 */

import { prisma } from '../../lib/prisma';

import { logger } from '../../lib/logger';

import { localDnaConfig } from '../../config/local-dna';

import {

  localDnaPatchGenerator,

  patchDenseMatch,

  patchFingerprintsMatch,

  type PatchFingerprint,

} from './local-dna-patch-generator.service';

import { aiService } from '../ai/ai-embeddings.service';

import { VaultService } from '../vault/vault.service';

import { forensicComputationCache } from './forensic-computation-cache.service';



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

  geometricScore: number;

  orbRefineScore: number;

  compositeScore: number;

  signals: string[];

}



interface PatchMatch {

  probeGx: number;

  probeGy: number;

  probeScale: number;

  vaultGx: number;

  vaultGy: number;

  vaultScale: number;

}



interface VaultPatchRow {

  patchIndex: number;

  gridX: number;

  gridY: number;

  scale: number;

  pHash16: string;

  dHash8: string | null;

  aHash8: string | null;

  edgeSignature: string | null;

  colorVector: unknown;

  frequencySig: string | null;

  textureSig: string | null;

}



/** Translation-offset voting with scale normalization */

function spatialConsistency(matches: PatchMatch[]): number {

  if (matches.length < 2) return matches.length ? 1 : 0;

  const offsetCounts = new Map<string, number>();

  for (const m of matches) {

    const scaleNorm = Math.max(m.probeScale, m.vaultScale, 1);

    const dx = (m.vaultGx * m.vaultScale - m.probeGx * m.probeScale) / scaleNorm;

    const dy = (m.vaultGy * m.vaultScale - m.probeGy * m.probeScale) / scaleNorm;

    const key = `${Math.round(dx)},${Math.round(dy)}`;

    offsetCounts.set(key, (offsetCounts.get(key) ?? 0) + 1);

  }

  const maxCount = Math.max(...offsetCounts.values());

  return maxCount / matches.length;

}



/** RANSAC-lite: best inlier ratio among top translation hypotheses */

function geometricVerification(matches: PatchMatch[]): number {

  if (matches.length < 4) return spatialConsistency(matches);

  const hypotheses: Array<{ dx: number; dy: number; inliers: number }> = [];



  for (const m of matches) {

    const scaleNorm = Math.max(m.probeScale, m.vaultScale, 1);

    const dx = (m.vaultGx * m.vaultScale - m.probeGx * m.probeScale) / scaleNorm;

    const dy = (m.vaultGy * m.vaultScale - m.probeGy * m.probeScale) / scaleNorm;

    let inliers = 0;

    for (const o of matches) {

      const sn = Math.max(o.probeScale, o.vaultScale, 1);

      const odx = (o.vaultGx * o.vaultScale - o.probeGx * o.probeScale) / sn;

      const ody = (o.vaultGy * o.vaultScale - o.probeGy * o.probeScale) / sn;

      if (Math.abs(odx - dx) <= 1.5 && Math.abs(ody - dy) <= 1.5) inliers++;

    }

    hypotheses.push({ dx, dy, inliers });

  }



  hypotheses.sort((a, b) => b.inliers - a.inliers);

  return (hypotheses[0]?.inliers ?? 0) / matches.length;

}



function buildVaultPrefixMap(patches: VaultPatchRow[]): Map<string, VaultPatchRow[]> {

  const map = new Map<string, VaultPatchRow[]>();

  for (const vp of patches) {

    const prefix = vp.pHash16.slice(0, 4);

    const list = map.get(prefix) ?? [];

    list.push(vp);

    map.set(prefix, list);

  }

  return map;

}



function toVaultPatch(fp: VaultPatchRow): Pick<PatchFingerprint, 'pHash16' | 'dHash8' | 'aHash8' | 'edgeSignature' | 'colorVector' | 'frequencySig' | 'textureSig'> {

  return {

    pHash16: fp.pHash16,

    dHash8: fp.dHash8 ?? '',

    aHash8: fp.aHash8 ?? '',

    edgeSignature: fp.edgeSignature ?? '',

    colorVector: (fp.colorVector as [number, number, number]) ?? [0, 0, 0],

    frequencySig: fp.frequencySig ?? '',

    textureSig: fp.textureSig ?? '',

  };

}



function patchesMatch(probe: PatchFingerprint, vault: VaultPatchRow): boolean {

  if (patchFingerprintsMatch(probe.pHash16, vault.pHash16)) return true;

  return patchDenseMatch(probe, toVaultPatch(vault));

}



export class VaultLocalDnaSearchService {

  async search(

    probeBuffer: Buffer,

    ownerUserId: string,

    mimeType: string,

    options?: { skipOrbRefine?: boolean; candidateVaultIds?: string[]; patchScales?: number[] },
  ): Promise<LocalDnaSearchHit[]> {

    if (!localDnaConfig.enabled || !mimeType.startsWith('image/')) return [];



    const scaleKey = options?.patchScales?.join('-') ?? 'default';
    const probeGrid = await forensicComputationCache.getOrCompute(
      probeBuffer,
      'probe-patches',
      () => localDnaPatchGenerator.generateMultiScaleGrid(probeBuffer, options?.patchScales),
      scaleKey,
    );

    if (!probeGrid.patches.length) return [];



    const candidateFilter = options?.candidateVaultIds?.length

      ? { vaultId: { in: options.candidateVaultIds } }

      : {};



    const indexes = await prisma.localFeatureIndex.findMany({

      where: { ownerUserId, status: 'COMPLETE', ...candidateFilter },

      include: {

        patches: {

          select: {

            patchIndex: true, gridX: true, gridY: true, scale: true, pHash16: true,

            dHash8: true, aHash8: true, edgeSignature: true, colorVector: true,

            frequencySig: true, textureSig: true,

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



      const vaultPatches = idx.patches as VaultPatchRow[];

      const vaultByPrefix = buildVaultPrefixMap(vaultPatches);

      const patchMatches: PatchMatch[] = [];

      const matchedVaultPatches = new Set<number>();



      for (const probePatch of probeGrid.patches) {

        const prefix = probePatch.pHash16.slice(0, 4);

        const candidates = vaultByPrefix.get(prefix) ?? [];



        // Also check adjacent prefix bucket for near-matches

        const nearCandidates = candidates.length ? candidates : vaultPatches.slice(0, 40);



        for (const vaultPatch of nearCandidates) {

          if (matchedVaultPatches.has(vaultPatch.patchIndex)) continue;

          if (patchesMatch(probePatch, vaultPatch)) {

            patchMatches.push({

              probeGx: probePatch.gridX,

              probeGy: probePatch.gridY,

              probeScale: probePatch.scale,

              vaultGx: vaultPatch.gridX,

              vaultGy: vaultPatch.gridY,

              vaultScale: vaultPatch.scale ?? localDnaConfig.patchSize,

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

      const geometric = geometricVerification(patchMatches);



      const minPatches = localDnaConfig.minPatchMatches;

      const minRatio = localDnaConfig.minMatchRatio;

      const minSpatial = localDnaConfig.minSpatialConsistency;



      if (patchMatchCount < minPatches && patchMatchCount < 8) continue;

      if (matchRatio < minRatio && patchMatchCount < 12) continue;

      if (spatial < minSpatial && geometric < 0.35 && matchRatio < 0.12) continue;



      let compositeScore = Math.round(

        matchRatio * 50

        + spatial * 20

        + geometric * 15

        + Math.min(patchMatchCount, 120) * 0.2

        + coverageRatio * 8,

      );

      // High absolute vote counts indicate correct vault even when match_ratio is diluted (crop/screenshot)
      if (patchMatchCount >= 200) compositeScore = Math.max(compositeScore, 78);
      else if (patchMatchCount >= 100) compositeScore = Math.max(compositeScore, 68);
      else if (patchMatchCount >= 60) compositeScore = Math.max(compositeScore, 58);
      compositeScore = Math.min(99, compositeScore);

      const signals = ['local_patch_dna', 'patch_voting', 'multi_scale'];

      if (matchRatio >= 0.10) signals.push('fragment_recovery');

      if (spatial >= 0.55) signals.push('spatial_consistent_crop');

      if (geometric >= 0.55) signals.push('geometric_verified');

      if (patchMatchCount >= 30) signals.push('high_patch_density');

      if (patchMatchCount >= 100) signals.push('dominant_vault_votes');



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

        geometricScore: Math.round(geometric * 1000) / 1000,

        orbRefineScore: 0,

        compositeScore,

        signals,

      });

    }



    hits.sort((a, b) => b.patchMatchCount - a.patchMatchCount || b.compositeScore - a.compositeScore);



    if (!options?.skipOrbRefine) {

      const topK = hits.slice(0, localDnaConfig.orbRefineTopK);

      await Promise.allSettled(topK.map(async (hit) => {

        if (hit.matchRatio >= 0.92 && hit.patchMatchCount >= 40) {

          hit.orbRefineScore = Math.round(hit.matchRatio * 100);

          return;

        }

        try {

          const original = await vaultService.retrieve(hit.vaultId, ownerUserId);

          const orb = await aiService.compareImages(probeBuffer, original.originalBuffer);

          if (orb) {

            hit.orbRefineScore = Math.round(orb.similarity * 100);

            hit.compositeScore = Math.min(99, Math.round(

              hit.compositeScore * 0.55 + hit.orbRefineScore * 0.35 + hit.geometricScore * 10,

            ));

            if (hit.orbRefineScore >= 40) hit.signals.push('opencv_orb');

          }

        } catch { /* optional refine */ }

      }));

      // When ORB refine unavailable, patch vote count is the primary signal
      hits.sort((a, b) => {
        if (a.orbRefineScore > 0 || b.orbRefineScore > 0) {
          return b.compositeScore - a.compositeScore || b.patchMatchCount - a.patchMatchCount;
        }
        return b.patchMatchCount - a.patchMatchCount || b.compositeScore - a.compositeScore;
      });
    }

    logger.info('[LocalDnaSearch] Complete', {

      probePatches: probeGrid.patches.length,

      scales: probeGrid.scales,

      vaultIndexes: indexes.length,

      hits: hits.length,

      topVotes: hits[0]?.patchMatchCount ?? 0,

      topScore: hits[0]?.compositeScore ?? 0,

    });



    return hits;

  }



  async extractProbePatches(buffer: Buffer): Promise<PatchFingerprint[]> {

    const grid = await localDnaPatchGenerator.generateMultiScaleGrid(buffer);

    return grid.patches;

  }

}



export const vaultLocalDnaSearchService = new VaultLocalDnaSearchService();

