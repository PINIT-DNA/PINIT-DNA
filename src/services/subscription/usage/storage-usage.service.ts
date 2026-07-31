/**
 * Vault storage usage — sums originalSizeBytes for the user's vaulted DNA records.
 * Does not modify vault storage / encryption flows.
 */

import { prisma } from '../../../lib/prisma';

export class StorageUsageService {
  async getUsedBytes(userId: string): Promise<number> {
    const agg = await prisma.vaultRecord.aggregate({
      where: { dnaRecord: { ownerUserId: userId } },
      _sum: { originalSizeBytes: true },
    });
    return Number(agg._sum.originalSizeBytes ?? 0);
  }
}

export const storageUsageService = new StorageUsageService();
