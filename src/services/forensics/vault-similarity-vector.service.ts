/**
 * Stage 3–4 — Score EVERY vault DNA record against a probe using stored DB fingerprints.
 * No arbitrary 100-record cap. Produces a ranked similarity vector per vault asset.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { StructuralLayer } from '../layers/layer2.structural';
import { aiService } from '../ai/ai-embeddings.service';
import { SemanticLayer } from '../layers/layer4.semantic';
import { localFeatureMatchService } from './local-feature-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { ForensicImageVariant } from './forensic-image-preprocessor.service';

export interface SimilarityVectorScores {
  sha256: number;
  pHash: number;
  aHash: number;
  dHash: number;
  perceptualBlend: number;
  structural: number;
  semanticColor: number;
  clip: number;
  orb: number;
  aspectRatio: number;
  composite: number;
}

export interface VaultSimilarityVector {
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  filename: string;
  scores: SimilarityVectorScores;
  signals: string[];
}

const VECTOR_WEIGHTS = {
  sha256: 0.12,
  perceptualBlend: 0.22,
  structural: 0.18,
  semanticColor: 0.08,
  clip: 0.10,
  orb: 0.22,
  aspectRatio: 0.08,
} as const;

function hammingHexSimilarity(a: string, b: string, bits = 64): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return Math.max(0, 1 - dist / bits);
}

export class VaultSimilarityVectorService {
  private readonly perceptual = new PerceptualLayer();
  private readonly structural = new StructuralLayer();
  private readonly semantic = new SemanticLayer();

  /**
   * Compare probe against every vaulted DNA record for this owner.
   */
  async scoreEntireVault(
    probeBuffer: Buffer,
    probeMime: string,
    probeName: string,
    probeSize: number,
    ownerUserId: string,
    variants: ForensicImageVariant[],
    options?: { orbTopK?: number; relaxedVisual?: boolean },
  ): Promise<VaultSimilarityVector[]> {
    const orbTopK = options?.orbTopK ?? 15;
    const relaxed = options?.relaxedVisual ?? true;
    const phashFloor = relaxed ? 0.38 : 0.52;

    const probeHash = crypto.createHash('sha256').update(probeBuffer).digest('hex');
    const bestVariant = variants.find((v) => v.label === 'normalized') ?? variants[0] ?? {
      label: 'original', buffer: probeBuffer, mimeType: probeMime,
    };

    let probeP: Awaited<ReturnType<PerceptualLayer['computeFingerprints']>> | null = null;
    let probeS: Awaited<ReturnType<StructuralLayer['generate']>>['data'] | null = null;
    let probeColorFp: string | null = null;

    if (bestVariant.mimeType.startsWith('image/')) {
      try {
        probeP = await this.perceptual.computeFingerprints(bestVariant.buffer);
        const sg = await this.structural.generate({
          filePath: '',
          buffer: bestVariant.buffer,
          originalName: probeName,
          mimeType: bestVariant.mimeType,
          sizeBytes: probeSize,
        });
        if (sg.success) probeS = sg.data;

        try {
          const sem = await this.semantic.generate({
            filePath: '',
            buffer: bestVariant.buffer,
            originalName: probeName,
            mimeType: bestVariant.mimeType,
            sizeBytes: probeSize,
          });
          if (sem.success && sem.data?.colorFingerprint) {
            probeColorFp = sem.data.colorFingerprint as string;
          }
        } catch { /* optional */ }

      } catch (e) {
        logger.debug('[VaultVector] Probe fingerprint partial', { error: String(e) });
      }
    }

    const vaultRows = await prisma.dnaRecord.findMany({
      where: { ownerUserId, vaultRecord: { isNot: null } },
      include: {
        vaultRecord: { select: { id: true, originalFileName: true, originalSizeBytes: true } },
        cryptoLayer: { select: { sha256Hash: true } },
        perceptualLayer: { select: { pHash64: true, aHash64: true, dHash64: true } },
        structuralLayer: { select: { edgeSignature64: true } },
        semanticLayer: { select: { colorFingerprint: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const clipScores = new Map<string, number>();
    try {
      const query = probeName.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ').trim() || 'image';
      const sem = await aiService.findSimilar(query, Math.min(vaultRows.length, 40));
      for (const hit of sem.results) {
        clipScores.set(hit.dnaRecordId, Math.round(hit.similarity * 100));
      }
    } catch { /* AI offline */ }

    const vectors: VaultSimilarityVector[] = [];

    for (const row of vaultRows) {
      if (!row.vaultRecord) continue;
      const signals: string[] = [];
      const scores: SimilarityVectorScores = {
        sha256: 0, pHash: 0, aHash: 0, dHash: 0, perceptualBlend: 0,
        structural: 0, semanticColor: 0, clip: 0, orb: 0, aspectRatio: 0, composite: 0,
      };

      if (row.cryptoLayer?.sha256Hash === probeHash) {
        scores.sha256 = 100;
        signals.push('cryptographic_hash');
      }

      if (probeP && row.perceptualLayer?.pHash64) {
        const stored = row.perceptualLayer;
        scores.pHash = Math.round(
          hammingHexSimilarity(probeP.pHash64, stored.pHash64, 64) * 100,
        );
        scores.aHash = Math.round(
          hammingHexSimilarity(probeP.aHash64, stored.aHash64, 64) * 100,
        );
        scores.dHash = Math.round(
          hammingHexSimilarity(probeP.dHash64, stored.dHash64, 64) * 100,
        );
        const blend = this.perceptual.verify(probeP, {
          pHash64: stored.pHash64,
          aHash64: stored.aHash64 ?? '',
          dHash64: stored.dHash64 ?? '',
        });
        scores.perceptualBlend = Math.round(blend * 100);
        if (blend >= phashFloor) signals.push('perceptual_hash');
      }

      if (probeS && row.structuralLayer?.edgeSignature64) {
        const sSim = this.structural.verify(probeS, {
          edgeSignature64: row.structuralLayer.edgeSignature64,
        });
        scores.structural = Math.round(sSim * 100);
        if (sSim >= 0.50) signals.push('structural_fingerprint');
      }

      if (probeColorFp && row.semanticLayer?.colorFingerprint) {
        scores.semanticColor = Math.round(
          hammingHexSimilarity(probeColorFp, row.semanticLayer.colorFingerprint, 48) * 100,
        );
        if (scores.semanticColor >= 55) signals.push('color_fingerprint');
      }

      scores.clip = clipScores.get(row.id) ?? 0;
      if (scores.clip >= 40) signals.push('clip_similarity');

      scores.composite = Math.round(
        scores.sha256 * VECTOR_WEIGHTS.sha256
        + scores.perceptualBlend * VECTOR_WEIGHTS.perceptualBlend
        + scores.structural * VECTOR_WEIGHTS.structural
        + scores.semanticColor * VECTOR_WEIGHTS.semanticColor
        + scores.clip * VECTOR_WEIGHTS.clip
        + scores.aspectRatio * VECTOR_WEIGHTS.aspectRatio,
      );

      if (scores.composite >= 30 || signals.length > 0) {
        vectors.push({
          vaultId: row.vaultRecord.id,
          dnaRecordId: row.id,
          ownerUserId,
          filename: row.vaultRecord.originalFileName,
          scores,
          signals,
        });
      }
    }

    vectors.sort((a, b) => b.scores.composite - a.scores.composite);

    // ORB/AKAZE refinement on top-K only (expensive)
    if (probeBuffer && bestVariant.mimeType.startsWith('image/')) {
      const probeBuf = bestVariant.buffer;
      for (const vec of vectors.slice(0, orbTopK)) {
        try {
          const { VaultService } = await import('../vault/vault.service');
          const vaultSvc = new VaultService();
          const retrieved = await vaultSvc.retrieve(vec.vaultId, ownerUserId);
          const local = await localFeatureMatchService.compare(probeBuf, retrieved.originalBuffer);
          vec.scores.orb = Math.round(local.similarity * 100);
          if (local.similarity >= 0.35) {
            vec.signals.push('local_features', local.method);
            vec.scores.composite = Math.round(
              vec.scores.composite * (1 - VECTOR_WEIGHTS.orb)
              + vec.scores.orb * VECTOR_WEIGHTS.orb,
            );
          }
        } catch { /* skip */ }
      }
      vectors.sort((a, b) => b.scores.composite - a.scores.composite);
    }

    logger.info('[VaultVector] Entire vault scored', {
      ownerUserId: ownerUserId.slice(0, 8),
      vaultRecords: vaultRows.length,
      vectorsReturned: vectors.length,
      topComposite: vectors[0]?.scores.composite ?? 0,
    });

    return vectors;
  }

  toRankedCandidates(vectors: VaultSimilarityVector[]): RankedVaultCandidate[] {
    return vectors.map((v, i) => ({
      rank: i + 1,
      dnaRecordId: v.dnaRecordId,
      vaultId: v.vaultId,
      ownerUserId: v.ownerUserId,
      preliminaryScore: v.scores.composite,
      compositeScore: v.scores.composite,
      tier: v.scores.composite >= 82 ? 4 : 3,
      method: `Vault similarity vector (${v.signals.slice(0, 4).join(', ') || 'multi-signal'})`,
      signals: v.signals,
    }));
  }
}

export const vaultSimilarityVectorService = new VaultSimilarityVectorService();
