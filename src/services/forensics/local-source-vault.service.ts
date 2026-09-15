import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { aiService } from '../ai/ai-embeddings.service';
import type { FragmentReuseFinding, RankedVaultCandidate } from '../../types/unified-investigation.types';

const vaultService = new VaultService();

export interface CompositionVaultPick {
  vaultId: string;
  dnaRecordId?: string;
  filename?: string;
  localScore: number;
  diagnostics?: Record<string, unknown>;
  reason: string;
  /** Other vaults that also locally matched this probe (not merged into one fake source). */
  additionalSources?: Array<{
    vaultId: string;
    filename?: string;
    dnaRecordId?: string;
    localScore: number;
    inliers?: number;
    templateScore?: number;
    coveragePercent?: number;
  }>;
}

/**
 * Choose the vault image that is the spatial *source* of a pasted crop.
 * Global embedding winner is only a fallback — a 5% crop can lose CLIP to an unrelated file.
 */
export async function pickCompositionSourceVault(params: {
  ownerUserId: string;
  probeBuffer: Buffer;
  probeMimeType: string;
  embeddingVaultId?: string;
  embeddingFilename?: string;
  fragmentFindings: FragmentReuseFinding[];
  rankedCandidates?: RankedVaultCandidate[];
  provenanceVaultId?: string;
}): Promise<CompositionVaultPick | null> {
  const ids = new Map<string, { vaultId: string; dnaRecordId?: string; filename?: string; prior: number }>();

  const add = (vaultId?: string | null, extra?: { dnaRecordId?: string; filename?: string; prior?: number }) => {
    if (!vaultId) return;
    const prev = ids.get(vaultId);
    ids.set(vaultId, {
      vaultId,
      dnaRecordId: extra?.dnaRecordId ?? prev?.dnaRecordId,
      filename: extra?.filename ?? prev?.filename,
      prior: Math.max(prev?.prior ?? 0, extra?.prior ?? 0),
    });
  };

  // Owner vault images first so a second pasted original (flower) is actually scored.
  try {
    const extras = await prisma.vaultRecord.findMany({
        where: {
          originalMimeType: { startsWith: 'image/' },
          dnaRecord: { ownerUserId: params.ownerUserId },
        },
        select: { id: true, dnaRecordId: true, originalFileName: true },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      for (const v of extras) {
        add(v.id, { dnaRecordId: v.dnaRecordId, filename: v.originalFileName, prior: 8 });
      }
    } catch (err) {
      logger.warn('[LocalSourceVault] owner vault list failed', { error: String(err) });
    }

  for (const f of params.fragmentFindings.slice(0, 5)) {
    add(f.vaultId, {
      dnaRecordId: f.dnaRecordId,
      filename: f.ownerFilename,
      prior: 40 + (f.confidence ?? 0),
    });
  }
  for (const c of (params.rankedCandidates ?? []).slice(0, 4)) {
    add(c.vaultId, { dnaRecordId: c.dnaRecordId, prior: c.compositeScore ?? c.preliminaryScore ?? 0 });
  }
  add(params.embeddingVaultId, { filename: params.embeddingFilename, prior: 10 });
  add(params.provenanceVaultId, { prior: 55 });

  const pool = [...ids.values()].slice(0, 12);
  if (pool.length === 0) return null;

  const scored: CompositionVaultPick[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, pool.length) }, async () => {
    while (cursor < pool.length) {
      const c = pool[cursor++]!;
      try {
        const vf = await vaultService.retrieve(c.vaultId, params.ownerUserId);
        if (!vf?.originalBuffer) continue;
        const score = await aiService.forensicLocalSourceScore(
          params.probeBuffer,
          vf.originalBuffer,
          params.probeMimeType,
        );
        const localScore = (score?.localScore ?? 0) + c.prior * 0.15;
        logger.info('[LocalSourceVault] scored candidate', {
          vaultId: c.vaultId.slice(0, 8),
          filename: c.filename,
          inliers: score?.inliers,
          templateScore: score?.templateScore,
          coverage: score?.estimatedCoveragePercent,
          localScore,
          method: score?.method,
        });
        scored.push({
          vaultId: c.vaultId,
          dnaRecordId: c.dnaRecordId,
          filename: c.filename ?? vf.originalFileName,
          localScore,
          diagnostics: score ?? undefined,
          reason: 'local_feature_and_template',
        });
      } catch (err) {
        logger.warn('[LocalSourceVault] candidate skipped', { vaultId: c.vaultId.slice(0, 8), error: String(err) });
      }
    }
  });
  await Promise.all(workers);

  scored.sort((a, b) => b.localScore - a.localScore);
  const best = scored[0] ?? null;

  const looksLikeSeparatePaste = (s: CompositionVaultPick): boolean => {
    if (!best || s.vaultId === best.vaultId) return false;
    const cov = Number(s.diagnostics?.estimatedCoveragePercent ?? 0);
    const tmpl = Number(s.diagnostics?.templateScore ?? 0);
    const inliers = Number(s.diagnostics?.inliers ?? 0);
    const compact = cov >= 0.8 && cov <= 70;
    return s.localScore >= 10 || inliers >= 6 || tmpl >= 0.38 || (compact && tmpl >= 0.32);
  };

  const additionalSources = scored
    .filter(looksLikeSeparatePaste)
    .slice(0, 5)
    .map((s) => ({
      vaultId: s.vaultId,
      filename: s.filename,
      dnaRecordId: s.dnaRecordId,
      localScore: s.localScore,
      inliers: Number(s.diagnostics?.inliers ?? 0),
      templateScore: Number(s.diagnostics?.templateScore ?? 0),
      coveragePercent: Number(s.diagnostics?.estimatedCoveragePercent ?? 0),
    }));

  for (const f of params.fragmentFindings) {
    if (!f.vaultId || f.vaultId === best?.vaultId) continue;
    if (additionalSources.some((s) => s.vaultId === f.vaultId)) continue;
    if ((f.confidence ?? 0) < 45) continue;
    additionalSources.push({
      vaultId: f.vaultId,
      filename: f.ownerFilename,
      dnaRecordId: f.dnaRecordId,
      localScore: f.confidence ?? 0,
      coveragePercent: f.probeCoveragePercent,
    });
  }

  if (best && additionalSources.length === 0) {
    const runnerUp = scored.find((s) => {
      if (s.vaultId === best.vaultId) return false;
      const tmpl = Number(s.diagnostics?.templateScore ?? 0);
      return s.localScore >= 8 && tmpl >= 0.35;
    });
    if (runnerUp) {
      additionalSources.push({
        vaultId: runnerUp.vaultId,
        filename: runnerUp.filename,
        dnaRecordId: runnerUp.dnaRecordId,
        localScore: runnerUp.localScore,
        inliers: Number(runnerUp.diagnostics?.inliers ?? 0),
        templateScore: Number(runnerUp.diagnostics?.templateScore ?? 0),
        coveragePercent: Number(runnerUp.diagnostics?.estimatedCoveragePercent ?? 0),
      });
    }
  }

  if (best && best.localScore >= 12) {
    logger.info('[LocalSourceVault] selected', {
      vaultId: best.vaultId.slice(0, 8),
      filename: best.filename,
      localScore: best.localScore,
      extraSources: additionalSources.length,
    });
    return { ...best, additionalSources };
  }

  const frag = params.fragmentFindings[0];
  if (frag?.vaultId) {
    try {
      const vf = await vaultService.retrieve(frag.vaultId, params.ownerUserId);
      if (vf?.originalBuffer) {
        return {
          vaultId: frag.vaultId,
          dnaRecordId: frag.dnaRecordId,
          filename: frag.ownerFilename ?? vf.originalFileName,
          localScore: frag.confidence ?? 0,
          reason: 'fragment_splice',
        };
      }
    } catch {
      /* stale fragment id */
    }
  }

  return best;
}
