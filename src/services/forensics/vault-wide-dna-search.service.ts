/**
 * Stage 10 — Search ALL vault DNA records (perceptual + structural + semantic).
 * Never limited to recent 100 rows only.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { StructuralLayer } from '../layers/layer2.structural';
import { aiService } from '../ai/ai-embeddings.service';
import { localFeatureMatchService } from './local-feature-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { ForensicImageVariant } from './forensic-image-preprocessor.service';

export interface VaultWideSearchOptions {
  phashThreshold?: number;
  relaxedVisual?: boolean;
  enableLocalFeatures?: boolean;
  localFeatureTopK?: number;
}

export class VaultWideDnaSearchService {
  private readonly perceptual = new PerceptualLayer();
  private readonly structural = new StructuralLayer();

  async searchAll(
    variants: ForensicImageVariant[],
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
    options?: VaultWideSearchOptions,
  ): Promise<RankedVaultCandidate[]> {
    const phashThreshold = options?.phashThreshold ?? 0.65;
    const scoreMap = new Map<string, RankedVaultCandidate>();

    const add = (c: Omit<RankedVaultCandidate, 'rank'> & { compositeScore?: number }) => {
      const key = c.vaultId;
      const compositeScore = c.compositeScore ?? c.preliminaryScore;
      const existing = scoreMap.get(key);
      if (!existing || compositeScore > existing.compositeScore) {
        scoreMap.set(key, {
          ...c,
          compositeScore,
          rank: 0,
          signals: [...new Set([...(existing?.signals ?? []), ...c.signals])],
        });
      } else if (existing) {
        existing.signals = [...new Set([...existing.signals, ...c.signals])];
      }
    };

    const [perceptualRows, structuralRows] = await Promise.all([
      prisma.perceptualLayer.findMany({
        where: {
          dnaRecord: { ownerUserId, vaultRecord: { isNot: null } },
        },
        select: {
          pHash64: true,
          aHash64: true,
          dHash64: true,
          dnaRecordId: true,
          dnaRecord: {
            select: {
              ownerUserId: true,
              imageFilename: true,
              vaultRecord: { select: { id: true, originalFileName: true } },
            },
          },
        },
      }),
      prisma.structuralLayer.findMany({
        where: {
          dnaRecord: { ownerUserId, vaultRecord: { isNot: null } },
        },
        select: {
          edgeSignature64: true,
          dnaRecordId: true,
          dnaRecord: {
            select: {
              ownerUserId: true,
              vaultRecord: { select: { id: true } },
            },
          },
        },
      }),
    ]);

    const structuralByDna = new Map(
      structuralRows.map((r) => [r.dnaRecordId, r]),
    );

    for (const variant of variants) {
      if (!variant.mimeType.startsWith('image/')) continue;

      let probeP: Awaited<ReturnType<PerceptualLayer['computeFingerprints']>> | null = null;
      let probeS: Awaited<ReturnType<StructuralLayer['generate']>>['data'] | null = null;

      try {
        probeP = await this.perceptual.computeFingerprints(variant.buffer);
        const sg = await this.structural.generate({
          filePath: '',
          buffer: variant.buffer,
          originalName,
          mimeType: variant.mimeType,
          sizeBytes,
        });
        if (sg.success) probeS = sg.data;
      } catch (e) {
        logger.debug('Vault-wide search probe failed', { variant: variant.label, error: String(e) });
        continue;
      }

      for (const row of perceptualRows) {
        if (!row.pHash64 || !row.dnaRecord.vaultRecord) continue;
        const sim = this.perceptual.verify(probeP!, {
          pHash64: row.pHash64,
          aHash64: row.aHash64 ?? '',
          dHash64: row.dHash64 ?? '',
        });

        let prelim = sim >= phashThreshold ? Math.round(sim * 100) : 0;
        const signals: string[] = [];

        if (prelim > 0) signals.push('perceptual_hash');

        const st = structuralByDna.get(row.dnaRecordId);
        if (probeS && st?.edgeSignature64) {
          const sSim = this.structural.verify(probeS, { edgeSignature64: st.edgeSignature64 });
          if (sSim >= 0.55) {
            prelim = Math.max(prelim, Math.round(sSim * 100));
            signals.push('structural_fingerprint');
          }
        }

        if (prelim >= (options?.relaxedVisual ? 28 : 35)) {
          add({
            dnaRecordId: row.dnaRecordId,
            vaultId: row.dnaRecord.vaultRecord.id,
            ownerUserId: row.dnaRecord.ownerUserId ?? ownerUserId,
            preliminaryScore: prelim,
            compositeScore: prelim,
            tier: prelim >= 85 ? 4 : 3,
            method: signals.includes('structural_fingerprint')
              ? 'Visual + structural DNA'
              : 'Perceptual hash vault search',
            signals: [...signals, `variant:${variant.label}`],
          });
        }
      }
    }

    try {
      const query = originalName.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ');
      const semantic = await aiService.findSimilar(query, 25);
      for (const hit of semantic.results) {
        const row = perceptualRows.find((r) => r.dnaRecordId === hit.dnaRecordId);
        if (!row?.dnaRecord.vaultRecord) continue;
        const semScore = Math.round(hit.similarity * 100);
        add({
          dnaRecordId: hit.dnaRecordId,
          vaultId: row.dnaRecord.vaultRecord.id,
          ownerUserId: row.dnaRecord.ownerUserId ?? ownerUserId,
          preliminaryScore: semScore,
          compositeScore: semScore,
          tier: 3,
          method: 'Semantic embedding match',
          signals: ['semantic_dna', 'clip_similarity'],
        });
      }
    } catch { /* AI offline */ }

    let ranked = [...scoreMap.values()]
      .sort((a, b) => b.compositeScore - a.compositeScore);

    if (options?.enableLocalFeatures !== false && ranked.length && variants[0]?.mimeType.startsWith('image/')) {
      const topK = options?.localFeatureTopK ?? 8;
      const probeBuf = variants.find((v) => v.label === 'normalized')?.buffer ?? variants[0]!.buffer;
      const refined = ranked.slice(0, topK);

      for (const cand of refined) {
        const vault = await prisma.vaultRecord.findUnique({
          where: { id: cand.vaultId },
          select: { dnaRecordId: true },
        });
        if (!vault) continue;
        try {
          const { VaultService } = await import('../vault/vault.service');
          const vaultSvc = new VaultService();
          const retrieved = await vaultSvc.retrieve(cand.vaultId, ownerUserId);
          const local = await localFeatureMatchService.compare(probeBuf, retrieved.originalBuffer);
          if (local.similarity > 0.4) {
            const boost = Math.round(local.similarity * 100);
            const existing = scoreMap.get(cand.vaultId);
            if (existing) {
              existing.compositeScore = Math.max(existing.compositeScore, boost);
              existing.signals = [...new Set([...existing.signals, 'local_features', local.method])];
            }
          }
        } catch { /* skip */ }
      }

      ranked = [...scoreMap.values()].sort((a, b) => b.compositeScore - a.compositeScore);
    }

    logger.info('Vault-wide DNA search complete', {
      ownerUserId: ownerUserId.slice(0, 8),
      perceptualIndexSize: perceptualRows.length,
      candidatesFound: ranked.length,
    });

    return ranked.map((c, i) => ({ ...c, rank: i + 1 }));
  }
}

export const vaultWideDnaSearchService = new VaultWideDnaSearchService();
