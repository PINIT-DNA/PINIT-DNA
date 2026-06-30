/**
 * PINIT Local DNA Index — builds and persists vault feature index on upload.
 * Splits images into 32×32 patches with local fingerprints + optional ORB descriptors.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { localDnaConfig } from '../../config/local-dna';
import { localDnaPatchGenerator } from './local-dna-patch-generator.service';
import { aiService } from '../ai/ai-embeddings.service';

const BATCH_SIZE = 400;

export class LocalDnaIndexService {
  /**
   * Build (or rebuild) local DNA index for a vaulted image. Fire-and-forget safe.
   */
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
      const grid = await localDnaPatchGenerator.generateGrid(params.buffer);
      if (!grid.patches.length) return null;

      let orbKeypoints = 0;
      let orbDescriptors: unknown = null;
      const cvIndex = await aiService.extractLocalDnaIndex(params.buffer, params.mimeType);
      if (cvIndex) {
        orbKeypoints = cvIndex.orbKeypoints ?? 0;
        orbDescriptors = cvIndex.orbDescriptors ?? null;
      } else {
        logger.debug('[LocalDnaIndex] ORB descriptors skipped — python-ai offline or unavailable');
      }

      const existing = await prisma.localFeatureIndex.findUnique({
        where: { dnaRecordId: params.dnaRecordId },
        select: { id: true },
      });

      if (existing) {
        await prisma.localDnaPatch.deleteMany({ where: { indexId: existing.id } });
        await prisma.localFeatureIndex.update({
          where: { id: existing.id },
          data: {
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
            status: 'COMPLETE',
          },
        });
        await this.insertPatches(existing.id, grid.patches);
        logger.info('[LocalDnaIndex] Rebuilt', {
          dnaRecordId: params.dnaRecordId.slice(0, 8),
          patches: grid.patches.length,
          ms: Date.now() - start,
        });
        return { patchCount: grid.patches.length, indexId: existing.id };
      }

      const index = await prisma.localFeatureIndex.create({
        data: {
          dnaRecordId: params.dnaRecordId,
          ownerUserId: params.ownerUserId,
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
          status: 'COMPLETE',
        },
      });

      await this.insertPatches(index.id, grid.patches);

      logger.info('[LocalDnaIndex] Created', {
        dnaRecordId: params.dnaRecordId.slice(0, 8),
        patches: grid.patches.length,
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
    patches: Awaited<ReturnType<typeof localDnaPatchGenerator.generateGrid>>['patches'],
  ): Promise<void> {
    for (let i = 0; i < patches.length; i += BATCH_SIZE) {
      const chunk = patches.slice(i, i + BATCH_SIZE);
      await prisma.localDnaPatch.createMany({
        data: chunk.map((p) => ({
          indexId,
          patchIndex: p.patchIndex,
          gridX: p.gridX,
          gridY: p.gridY,
          pHash16: p.pHash16,
          edgeSignature: p.edgeSignature,
          colorVector: p.colorVector,
          frequencySig: p.frequencySig,
        })),
      });
    }
  }

  /** Backfill indexes for all vaulted images owned by a user. */
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
      if (existing?.status === 'COMPLETE' && existing.patchCount > 0) continue;

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
