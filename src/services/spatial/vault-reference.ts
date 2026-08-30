/**
 * Phase 4E — load enrolled vault original as spatial reference RGB (server-side only)
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { decodeImageForSpatialAuth } from './image-decode';

export interface VaultSpatialReference {
  referenceRgb: Buffer;
  referenceWidth: number;
  referenceHeight: number;
  vaultId: string;
}

/**
 * Retrieve lossless vault bytes for a DNA record and decode under file-pixel-order-v1.
 * Never accepts client-supplied reference bytes.
 */
export async function loadVaultSpatialReferenceRgb(params: {
  dnaRecordId: string;
  ownerUserId: string;
}): Promise<VaultSpatialReference | null> {
  const vault = await prisma.vaultRecord.findUnique({
    where: { dnaRecordId: params.dnaRecordId },
    select: {
      id: true,
      dnaRecord: { select: { ownerUserId: true } },
    },
  });
  if (!vault) {
    logger.warn('Spatial reference unavailable — no vault record', {
      dnaRecordId: params.dnaRecordId,
    });
    return null;
  }
  if (vault.dnaRecord?.ownerUserId !== params.ownerUserId) {
    logger.warn('Spatial reference denied — vault owner mismatch', {
      dnaRecordId: params.dnaRecordId,
    });
    return null;
  }

  try {
    const vaultService = new VaultService();
    const retrieved = await vaultService.retrieve(vault.id, params.ownerUserId);
    const decoded = await decodeImageForSpatialAuth(retrieved.originalBuffer);
    return {
      referenceRgb: decoded.rgb,
      referenceWidth: decoded.width,
      referenceHeight: decoded.height,
      vaultId: vault.id,
    };
  } catch (err) {
    logger.warn('Spatial reference load failed', {
      dnaRecordId: params.dnaRecordId,
      error: String(err),
    });
    return null;
  }
}
