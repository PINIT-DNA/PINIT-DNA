/**
 * Protected asset quota — counts vault records (any file type).
 */

import { prisma } from '../../../lib/prisma';

export class AssetQuotaService {
  async getProtectedAssetCount(userId: string): Promise<number> {
    return prisma.vaultRecord.count({
      where: { dnaRecord: { ownerUserId: userId } },
    });
  }
}

export const assetQuotaService = new AssetQuotaService();
