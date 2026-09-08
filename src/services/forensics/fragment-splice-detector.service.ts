/**
 * Fragment splice / partial-reuse detector.
 *
 * Distinct from vault-local-dna-search.service.ts (which recovers a CROP of the
 * SAME photo — most of the probe matches, thresholds require a meaningful match
 * ratio). This service answers a different question: "does a SMALL, spatially
 * coherent fragment of a protected original (e.g. just the eyes) appear pasted
 * into an otherwise-unrelated probe image?" Gating is deliberately loose on
 * match ratio (a real fragment is legitimately a tiny % of the probe) but tight
 * on spatial coherence and on the matched region staying small relative to the
 * probe canvas — a large matched region is a crop/full match, not a splice, and
 * is left to the existing whole-image search.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { localDnaConfig } from '../../config/local-dna';
import {
  localDnaPatchGenerator,
  patchFingerprintsMatch,
  patchDenseMatch,
  type PatchFingerprint,
} from './local-dna-patch-generator.service';
import { forensicComputationCache } from './forensic-computation-cache.service';
import type { FragmentReuseFinding } from '../../types/unified-investigation.types';

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

interface Rect { x: number; y: number; w: number; h: number; }

interface IslandMatch {
  probeRect: Rect;
  vaultRect: Rect;
  probeScale: number;
}

export interface FragmentSpliceOptions {
  /** Exclude the vault the orchestrator already accepted as the whole-image match */
  excludeVaultId?: string;
  /** Always search this vault first so a crop pasted into AI art is measured */
  preferVaultId?: string;
  maxCandidates?: number;
  minPatchMatches?: number;
  /** Skip the "too large to be a splice" filter; still report area % */
  forComposition?: boolean;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Reconstruct a patch's pixel rect from its grid coordinates. Mirrors the
 * placement logic in local-dna-patch-generator.service.ts: fixed-scale grid
 * patches sit at gx*scale, overlapping pyramid tiles sit at gx*stride. */
function patchPixelRect(gx: number, gy: number, scale: number, imageWidth: number, imageHeight: number): Rect {
  const isFixedGrid = (localDnaConfig.patchScales as readonly number[]).includes(scale);
  let left: number;
  let top: number;
  if (isFixedGrid) {
    left = gx * scale;
    top = gy * scale;
  } else {
    const stride = Math.max(8, Math.round(scale * (1 - localDnaConfig.overlapRatio)));
    left = gx * stride;
    top = gy * stride;
  }
  left = Math.max(0, Math.min(left, imageWidth));
  top = Math.max(0, Math.min(top, imageHeight));
  const w = Math.max(0, Math.min(scale, imageWidth - left));
  const h = Math.max(0, Math.min(scale, imageHeight - top));
  return { x: left, y: top, w, h };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (!s.length) return 0;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function estimateIslandSimilarity(island: IslandMatch[]): {
  sx: number; sy: number; tx: number; ty: number; ok: boolean;
} {
  const scalesX: number[] = [];
  const scalesY: number[] = [];
  for (let i = 0; i < island.length; i++) {
    for (let j = i + 1; j < island.length; j++) {
      const dvx = island[j]!.vaultRect.x - island[i]!.vaultRect.x;
      const dvy = island[j]!.vaultRect.y - island[i]!.vaultRect.y;
      const dpx = island[j]!.probeRect.x - island[i]!.probeRect.x;
      const dpy = island[j]!.probeRect.y - island[i]!.probeRect.y;
      if (Math.abs(dvx) >= 16) scalesX.push(dpx / dvx);
      if (Math.abs(dvy) >= 16) scalesY.push(dpy / dvy);
    }
  }
  const sx = scalesX.length ? median(scalesX) : 1;
  const sy = scalesY.length ? median(scalesY) : sx;
  const ok = Number.isFinite(sx) && Number.isFinite(sy) && sx > 0.12 && sx < 4 && sy > 0.12 && sy < 4;
  const tx = median(island.map((m) => m.probeRect.x - sx * m.vaultRect.x));
  const ty = median(island.map((m) => m.probeRect.y - sy * m.vaultRect.y));
  return { sx, sy, tx, ty, ok };
}

function mapVaultRectToProbe(
  vault: Rect,
  t: { sx: number; sy: number; tx: number; ty: number },
  probeW: number,
  probeH: number,
): Rect {
  let x = t.sx * vault.x + t.tx;
  let y = t.sy * vault.y + t.ty;
  let w = t.sx * vault.w;
  let h = t.sy * vault.h;
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > probeW) w = probeW - x;
  if (y + h > probeH) h = probeH - y;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function rectsClose(a: Rect, b: Rect, margin: number): boolean {
  return !(
    a.x + a.w + margin < b.x
    || b.x + b.w + margin < a.x
    || a.y + a.h + margin < b.y
    || b.y + b.h + margin < a.y
  );
}

/** Group matched patches into spatially-coherent islands by pixel-rect proximity in probe coords */
function clusterIslands(matches: IslandMatch[]): IslandMatch[][] {
  const used = new Array(matches.length).fill(false);
  const islands: IslandMatch[][] = [];
  for (let i = 0; i < matches.length; i++) {
    if (used[i]) continue;
    const queue = [i];
    used[i] = true;
    const island: IslandMatch[] = [];
    while (queue.length) {
      const idx = queue.shift()!;
      const cur = matches[idx]!;
      island.push(cur);
      const margin = Math.max(cur.probeRect.w, cur.probeRect.h, 24);
      for (let j = 0; j < matches.length; j++) {
        if (used[j]) continue;
        if (rectsClose(cur.probeRect, matches[j]!.probeRect, margin)) {
          used[j] = true;
          queue.push(j);
        }
      }
    }
    islands.push(island);
  }
  return islands;
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

export class FragmentSpliceDetectorService {
  async detectSplicedFragments(
    probeBuffer: Buffer,
    ownerUserId: string,
    mimeType: string,
    options?: FragmentSpliceOptions,
  ): Promise<FragmentReuseFinding[]> {
    const cfg = localDnaConfig.fragmentDetection;
    if (!cfg.enabled || !mimeType.startsWith('image/')) return [];

    const probeGrid = await forensicComputationCache.getOrCompute(
      probeBuffer,
      'probe-patches',
      () => localDnaPatchGenerator.generateMultiScaleGrid(probeBuffer),
      'default',
    );
    if (!probeGrid.patches.length || !probeGrid.imageWidth || !probeGrid.imageHeight) return [];

    const probeArea = probeGrid.imageWidth * probeGrid.imageHeight;
    const minPatches = options?.minPatchMatches
      ?? (options?.forComposition ? 3 : cfg.minPatchMatches);
    const maxBBox = options?.forComposition ? 95 : cfg.maxProbeBBoxAreaPercent;

    const patchSelect = {
      patchIndex: true, gridX: true, gridY: true, scale: true, pHash16: true,
      dHash8: true, aHash8: true, edgeSignature: true, colorVector: true,
      frequencySig: true, textureSig: true,
    } as const;
    const include = {
      patches: { select: patchSelect },
      dnaRecord: { select: { imageFilename: true } },
    };

    const preferred = options?.preferVaultId
      ? await prisma.localFeatureIndex.findMany({
          where: { ownerUserId, status: 'COMPLETE', vaultId: options.preferVaultId },
          include,
          take: 1,
        })
      : [];

    const rest = await prisma.localFeatureIndex.findMany({
      where: {
        ownerUserId,
        status: 'COMPLETE',
        ...(options?.excludeVaultId ? { vaultId: { not: options.excludeVaultId } } : {}),
        ...(options?.preferVaultId ? { vaultId: { not: options.preferVaultId } } : {}),
      },
      include,
      take: options?.maxCandidates ?? 20,
    });
    const indexes = [...preferred, ...rest];

    const findings: FragmentReuseFinding[] = [];

    for (const idx of indexes) {
      if (!idx.vaultId || !idx.patches.length || !idx.imageWidth || !idx.imageHeight) continue;

      const vaultPatches = idx.patches as VaultPatchRow[];
      const vaultByPrefix = new Map<string, VaultPatchRow[]>();
      for (const vp of vaultPatches) {
        const prefix = vp.pHash16.slice(0, 4);
        const list = vaultByPrefix.get(prefix) ?? [];
        list.push(vp);
        vaultByPrefix.set(prefix, list);
      }

      const matched: IslandMatch[] = [];
      const usedVaultPatches = new Set<number>();

      for (const probePatch of probeGrid.patches) {
        const prefix = probePatch.pHash16.slice(0, 4);
        const candidates = vaultByPrefix.get(prefix) ?? [];
        for (const vp of candidates) {
          if (usedVaultPatches.has(vp.patchIndex)) continue;
          if (patchesMatch(probePatch, vp)) {
            const probeRect = patchPixelRect(
              probePatch.gridX, probePatch.gridY, probePatch.scale,
              probeGrid.imageWidth, probeGrid.imageHeight,
            );
            const vaultRect = patchPixelRect(
              vp.gridX, vp.gridY, vp.scale ?? localDnaConfig.patchSize,
              idx.imageWidth, idx.imageHeight,
            );
            matched.push({ probeRect, vaultRect, probeScale: probePatch.scale });
            usedVaultPatches.add(vp.patchIndex);
            break;
          }
        }
      }

      if (matched.length < minPatches) continue;

      // Note: a raw match count isn't a reliable "this is a whole-image match" signal on
      // its own — a busy/repetitive background can rack up many spurious per-patch hash
      // matches without covering much of the probe. The real discriminator is each
      // island's probe bounding-box AREA (checked below, per cluster) — a genuinely large
      // whole-image match will cluster into one island spanning most of the probe canvas
      // and get filtered by maxProbeBBoxAreaPercent there instead.
      const islands = clusterIslands(matched);
      for (const island of islands) {
        if (island.length < minPatches) continue;

        let probeBBox: Rect | null = null;
        let vaultBBox: Rect | null = null;
        for (const m of island) {
          probeBBox = probeBBox ? unionRect(probeBBox, m.probeRect) : m.probeRect;
          vaultBBox = vaultBBox ? unionRect(vaultBBox, m.vaultRect) : m.vaultRect;
        }
        if (!probeBBox || !vaultBBox) continue;

        const probeBBoxAreaPct = ((probeBBox.w * probeBBox.h) / probeArea) * 100;
        // A pasted fragment is a straight (unscaled) copy, so its true probe→vault pixel
        // offset is constant regardless of which patch scale detected it — dividing by
        // per-patch probeScale (as vault-local-dna-search.service.ts does for crop/scale
        // recovery) would make identical raw offsets disagree across scales. Bucket by a
        // fixed pixel tolerance instead, generous enough for JPEG/resize jitter.
        const BUCKET_PX = 12;
        const offsetCounts = new Map<string, number>();
        for (const m of island) {
          const dx = Math.round((m.vaultRect.x - m.probeRect.x) / BUCKET_PX);
          const dy = Math.round((m.vaultRect.y - m.probeRect.y) / BUCKET_PX);
          const key = `${dx},${dy}`;
          offsetCounts.set(key, (offsetCounts.get(key) ?? 0) + 1);
        }
        const maxOffsetCount = Math.max(...offsetCounts.values());
        // Advisory only, not a hard gate: empirically, dense-match's fuzzy secondary-signal
        // tolerance means even a clean, tightly-clustered (in probe pixel space) island of
        // genuine matches often maps to several nearby-but-not-identical vault offsets
        // (JPEG block artifacts, near-duplicate texture patches) rather than one exact
        // offset. Pixel-proximity clustering (clusterIslands) is the real anti-spurious-
        // match filter; requiring vault-side offset agreement on top of it discarded real
        // matches without actually rejecting more false ones in testing.
        const spatialConsistency = maxOffsetCount / island.length;
        logger.debug('[FragmentSplice] Island evaluated', {
          islandSize: island.length,
          probeBBoxAreaPct: Math.round(probeBBoxAreaPct * 10) / 10,
          spatialConsistency: Math.round(spatialConsistency * 100) / 100,
        });
        if (probeBBoxAreaPct > maxBBox) continue;

        const confidence = Math.min(95, Math.round(
          40
          + Math.min(30, island.length * 4)
          + spatialConsistency * 20
          + Math.max(0, 10 - probeBBoxAreaPct / 5),
        ));

        const vaultArea = idx.imageWidth * idx.imageHeight;
        let reportProbeBBox = probeBBox;
        const geom = estimateIslandSimilarity(island);
        if (geom.ok && spatialConsistency >= 0.35) {
          const mapped = mapVaultRectToProbe(vaultBBox, geom, probeGrid.imageWidth, probeGrid.imageHeight);
          const mappedPct = ((mapped.w * mapped.h) / probeArea) * 100;
          if (mappedPct >= 1 && mappedPct <= 70 && mappedPct > probeBBoxAreaPct * 1.5) {
            reportProbeBBox = mapped;
          }
        }
        const reportProbePct = ((reportProbeBBox.w * reportProbeBBox.h) / probeArea) * 100;
        const probeCoveragePercent = round1(reportProbePct);
        const vaultCoveragePercent = vaultArea > 0
          ? round1(((vaultBBox.w * vaultBBox.h) / vaultArea) * 100)
          : 0;

        findings.push({
          vaultId: idx.vaultId,
          dnaRecordId: idx.dnaRecordId,
          ownerFilename: idx.dnaRecord.imageFilename ?? undefined,
          patchMatchCount: island.length,
          confidence,
          probeRegion: {
            xPercent: round1((reportProbeBBox.x / probeGrid.imageWidth) * 100),
            yPercent: round1((reportProbeBBox.y / probeGrid.imageHeight) * 100),
            widthPercent: round1((reportProbeBBox.w / probeGrid.imageWidth) * 100),
            heightPercent: round1((reportProbeBBox.h / probeGrid.imageHeight) * 100),
          },
          vaultRegion: {
            xPercent: round1((vaultBBox.x / idx.imageWidth) * 100),
            yPercent: round1((vaultBBox.y / idx.imageHeight) * 100),
            widthPercent: round1((vaultBBox.w / idx.imageWidth) * 100),
            heightPercent: round1((vaultBBox.h / idx.imageHeight) * 100),
          },
          probeCoveragePercent,
          vaultCoveragePercent,
        });
      }
    }

    findings.sort((a, b) => b.confidence - a.confidence);
    if (findings.length) {
      logger.info('[FragmentSplice] Detected candidate fragment reuse', {
        ownerUserId: ownerUserId.slice(0, 8),
        findings: findings.length,
        top: findings[0]?.confidence,
      });
    }
    return findings.slice(0, 5);
  }
}

export const fragmentSpliceDetectorService = new FragmentSpliceDetectorService();
