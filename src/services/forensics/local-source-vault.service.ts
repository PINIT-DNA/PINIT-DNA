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

  for (const f of params.fragmentFindings.slice(0, 5)) {
    add(f.vaultId, {
      dnaRecordId: f.dnaRecordId,
      filename: f.ownerFilename,
      prior: 40 + (f.confidence ?? 0),
    });
  }
  for (const c of (params.rankedCandidates ?? []).slice(0, 8)) {
    add(c.vaultId, { dnaRecordId: c.dnaRecordId, prior: c.compositeScore ?? c.preliminaryScore ?? 0 });
  }
  add(params.embeddingVaultId, { filename: params.embeddingFilename, prior: 10 });

  const pool = [...ids.values()].slice(0, 8);
  if (pool.length === 0) return null;

  let best: CompositionVaultPick | null = null;
  for (const c of pool) {
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
        vaultKeypoints: score?.vaultKeypoints,
        probeKeypoints: score?.probeKeypoints,
        goodMatches: score?.goodMatches,
        templateScore: score?.templateScore,
        coverage: score?.estimatedCoveragePercent,
        localScore,
        detector: score?.detector,
      });
      if (!best || localScore > best.localScore) {
        best = {
          vaultId: c.vaultId,
          dnaRecordId: c.dnaRecordId,
          filename: c.filename ?? vf.originalFileName,
          localScore,
          diagnostics: score ?? undefined,
          reason: 'local_feature_and_template',
        };
      }
    } catch (err) {
      logger.warn('[LocalSourceVault] candidate skipped', { vaultId: c.vaultId.slice(0, 8), error: String(err) });
    }
  }

  if (best && best.localScore >= 12) {
    logger.info('[LocalSourceVault] selected', {
      vaultId: best.vaultId.slice(0, 8),
      filename: best.filename,
      localScore: best.localScore,
    });
    return best;
  }

  const frag = params.fragmentFindings[0];
  if (frag?.vaultId) {
    return {
      vaultId: frag.vaultId,
      dnaRecordId: frag.dnaRecordId,
      filename: frag.ownerFilename,
      localScore: frag.confidence ?? 0,
      reason: 'fragment_splice',
    };
  }

  if (params.embeddingVaultId) {
    return {
      vaultId: params.embeddingVaultId,
      filename: params.embeddingFilename,
      localScore: 0,
      reason: 'embedding_fallback',
    };
  }
  return best;
}
