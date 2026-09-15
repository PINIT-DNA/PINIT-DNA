/**
 * PINIT Local DNA Index — builds multi-scale vault feature index on upload.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { localDnaConfig } from '../../config/local-dna';
import { localDnaPatchGenerator } from './local-dna-patch-generator.service';
import { packPatchesToArchive } from './local-dna-patch-packer.service';
import { aiService } from '../ai/ai-embeddings.service';
import { forensicScannerService } from './forensic-scanner.service';

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

      // Enterprise tile FAISS index (Python) — crop-resistant fast search
      void forensicScannerService.indexVaultTiles(
        params.buffer,
        params.mimeType,
        params.vaultId,
        params.dnaRecordId,
      ).catch(() => { /* non-fatal */ });

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
        // Rebuild path: this is the SAME record being re-indexed, not other
        // historical data — clearing its own prior rows (either old per-patch
        // format or a stale archive) before writing the fresh one is correct.
        await prisma.localDnaPatch.deleteMany({ where: { indexId: existing.id } });
        await prisma.localDnaPatchArchive.deleteMany({ where: { indexId: existing.id } });
        await prisma.localFeatureIndex.update({ where: { id: existing.id }, data: indexData });
        await this.writePatchArchive(existing.id, grid.patches);
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

      await this.writePatchArchive(index.id, grid.patches);

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

  /**
   * Packed replacement for the old per-patch-row insert: one gzip-compressed,
   * Merkle-rooted blob per index instead of one row (plus four secondary
   * indexes) per patch tile. A video frame can carry 2,000+ patches — at one
   * row each, that per-row/per-index overhead (not the fingerprint data
   * itself) is what actually explodes storage under every-frame protection.
   * Detection capability is unchanged: fragment-splice-detector.service.ts
   * unpacks this back to the exact same patch fingerprints it always used.
   */
  private async writePatchArchive(
    indexId: string,
    patches: Awaited<ReturnType<typeof localDnaPatchGenerator.generateMultiScaleGrid>>['patches'],
  ): Promise<void> {
    const archive = packPatchesToArchive(patches);
    await prisma.localDnaPatchArchive.create({
      data: {
        indexId,
        patchCount: archive.patchCount,
        merkleRoot: archive.merkleRoot,
        format: archive.format,
        compression: archive.compression,
        blob: archive.blob,
      },
    });
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
