/**
 * PINIT Local DNA Index — builds multi-scale vault feature index on upload.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { localDnaConfig } from '../../config/local-dna';
import { localDnaPatchGenerator } from './local-dna-patch-generator.service';
import { aiService } from '../ai/ai-embeddings.service';

const BATCH_SIZE = 400;

export class LocalDnaIndexService {
  async buildIndex(params: {
    buffer: Buffer;
    mimeType: string;
    dnaRecordId: string;
    vaultId: string;
    ownerUserId: string;
  }): Promise<{ patchCount: number; indexId: string } | null> {
    if (!localDnaConfig.enabled || !params.mimeType.startsWith('image/')) return null;

    const start = Date.now();
    try {
      const grid = await localDnaPatchGenerator.generateMultiScaleGrid(params.buffer);
      if (!grid.patches.length) return null;

      let orbKeypoints = 0;
      let orbDescriptors: unknown = null;
      const cvIndex = await aiService.extractLocalDnaIndex(params.buffer, params.mimeType);
      if (cvIndex) {
        orbKeypoints = cvIndex.orbKeypoints ?? 0;
        orbDescriptors = cvIndex.orbDescriptors ?? null;
      }

      const existing = await prisma.localFeatureIndex.findUnique({
        where: { dnaRecordId: params.dnaRecordId },
        select: { id: true },
      });

      const indexData = {
        vaultId: params.vaultId,
        imageWidth: grid.imageWidth,
        imageHeight: grid.imageHeight,
        patchSize: grid.patchSize,
        gridCols: grid.gridCols,
        gridRows: grid.gridRows,
        patchCount: grid.patches.length,
        globalPHash: grid.globalPHash,
        orbKeypoints,
        orbDescriptors: orbDescriptors as object | undefined,
        indexVersion: '2.0.0',
        status: 'COMPLETE',
      };

      if (existing) {
        await prisma.localDnaPatch.deleteMany({ where: { indexId: existing.id } });
        await prisma.localFeatureIndex.update({ where: { id: existing.id }, data: indexData });
        await this.insertPatches(existing.id, grid.patches);
        logger.info('[LocalDnaIndex] Rebuilt multi-scale', {
          dnaRecordId: params.dnaRecordId.slice(0, 8),
          patches: grid.patches.length,
          scales: grid.scales,
          ms: Date.now() - start,
        });
        return { patchCount: grid.patches.length, indexId: existing.id };
      }

      const index = await prisma.localFeatureIndex.create({
        data: {
          dnaRecordId: params.dnaRecordId,
          ownerUserId: params.ownerUserId,
          ...indexData,
        },
      });

      await this.insertPatches(index.id, grid.patches);

      logger.info('[LocalDnaIndex] Created multi-scale', {
        dnaRecordId: params.dnaRecordId.slice(0, 8),
        patches: grid.patches.length,
        scales: grid.scales,
        orbKeypoints,
        ms: Date.now() - start,
      });

      return { patchCount: grid.patches.length, indexId: index.id };
    } catch (err) {
      logger.error('[LocalDnaIndex] Build failed', {
        dnaRecordId: params.dnaRecordId,
        error: String(err),
      });
      return null;
    }
  }

  private async insertPatches(
    indexId: string,
    patches: Awaited<ReturnType<typeof localDnaPatchGenerator.generateMultiScaleGrid>>['patches'],
  ): Promise<void> {
    for (let i = 0; i < patches.length; i += BATCH_SIZE) {
      const chunk = patches.slice(i, i + BATCH_SIZE);
      await prisma.localDnaPatch.createMany({
        data: chunk.map((p) => ({
          indexId,
          patchIndex: p.patchIndex,
          gridX: p.gridX,
          gridY: p.gridY,
          scale: p.scale,
          pHash16: p.pHash16,
          dHash8: p.dHash8,
          aHash8: p.aHash8,
          edgeSignature: p.edgeSignature,
          colorVector: p.colorVector,
          frequencySig: p.frequencySig,
          textureSig: p.textureSig,
        })),
      });
    }
  }

  async backfillOwner(ownerUserId: string): Promise<{ indexed: number; failed: number }> {
    const vaults = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      include: { dnaRecord: true },
    });

    let indexed = 0;
    let failed = 0;

    for (const v of vaults) {
      if (!v.dnaRecord.imageMimeType.startsWith('image/')) continue;
      const existing = await prisma.localFeatureIndex.findUnique({
        where: { dnaRecordId: v.dnaRecordId },
      });
      if (existing?.status === 'COMPLETE' && existing.indexVersion === '2.0.0' && existing.patchCount > 0) continue;

      try {
        const { VaultService } = await import('../vault/vault.service');
        const vs = new VaultService();
        const file = await vs.retrieve(v.id, ownerUserId);
        const result = await this.buildIndex({
          buffer: file.originalBuffer,
          mimeType: file.originalMimeType,
          dnaRecordId: v.dnaRecordId,
          vaultId: v.id,
          ownerUserId,
        });
        if (result) indexed++;
        else failed++;
      } catch {
        failed++;
      }
    }

    return { indexed, failed };
  }
}

export const localDnaIndexService = new LocalDnaIndexService();
