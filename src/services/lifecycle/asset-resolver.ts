/**
 * Resolve the canonical Asset.id behind a lifecycle event.
 *
 * Asset.id stays the one identity that crosses module boundaries; Vault, DNA,
 * Certificate and ShareLink ids are never merged into it, only followed. Resolution
 * is owner-scoped: an id belonging to someone else resolves to null rather than
 * linking one account's event to another account's asset.
 *
 * Best-effort by design — an unresolved asset means the event is still recorded,
 * just without an asset link. It must never fail the action that produced it.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface AssetResolutionInput {
  ownerUserId: string;
  assetId?: string | null;
  vaultId?: string | null;
  dnaRecordId?: string | null;
  certificateId?: string | null;
  shareLinkId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/** Cheap memo for the hot path (one share link opened repeatedly, a monitoring run). */
const cache = new Map<string, string | null>();
const CACHE_LIMIT = 500;

function remember(key: string, value: string | null): string | null {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

export function clearAssetResolutionCache(): void {
  cache.clear();
}

export async function resolveAssetId(input: AssetResolutionInput): Promise<string | null> {
  const owner = String(input.ownerUserId || '').trim();
  if (!owner) return null;

  // An explicitly supplied asset id still has to belong to this owner.
  const direct = String(input.assetId || '').trim();
  const vaultId = String(input.vaultId || (input.entityType === 'vault' ? input.entityId : '') || '').trim();
  const dnaId = String(input.dnaRecordId || (input.entityType === 'dna_record' ? input.entityId : '') || '').trim();
  const certificateId = String(
    input.certificateId || (input.entityType === 'certificate' ? input.entityId : '') || '',
  ).trim();
  const shareLinkId = String(
    input.shareLinkId || (input.entityType === 'share_link' ? input.entityId : '') || '',
  ).trim();

  if (!direct && !vaultId && !dnaId && !certificateId && !shareLinkId) return null;

  const key = `${owner}|${direct}|${vaultId}|${dnaId}|${certificateId}|${shareLinkId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    if (direct) {
      const asset = await prisma.asset.findFirst({
        where: { id: direct, ownerUserId: owner },
        select: { id: true },
      });
      return remember(key, asset?.id ?? null);
    }

    if (vaultId || dnaId) {
      const or = [
        ...(vaultId ? [{ vaultId }] : []),
        ...(dnaId ? [{ dnaId }] : []),
      ];
      const asset = await prisma.asset.findFirst({
        where: { ownerUserId: owner, OR: or },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (asset) return remember(key, asset.id);
    }

    if (certificateId) {
      // Certificate.certificateId is the public id; Certificate.id is internal.
      const cert = await prisma.certificate.findFirst({
        where: { OR: [{ certificateId }, { id: certificateId }] },
        select: { assetId: true, ownerUserId: true },
      });
      if (cert?.assetId && (!cert.ownerUserId || cert.ownerUserId === owner)) {
        const owned = await prisma.asset.findFirst({
          where: { id: cert.assetId, ownerUserId: owner },
          select: { id: true },
        });
        if (owned) return remember(key, owned.id);
      }
    }

    if (shareLinkId) {
      const link = await prisma.shareLink.findFirst({
        where: { OR: [{ id: shareLinkId }, { token: shareLinkId }] },
        select: { assetId: true, vaultId: true, ownerUserId: true },
      });
      if (link && (!link.ownerUserId || link.ownerUserId === owner)) {
        if (link.assetId) {
          const owned = await prisma.asset.findFirst({
            where: { id: link.assetId, ownerUserId: owner },
            select: { id: true },
          });
          if (owned) return remember(key, owned.id);
        }
        if (link.vaultId) {
          const byVault = await prisma.asset.findFirst({
            where: { ownerUserId: owner, vaultId: link.vaultId },
            select: { id: true },
          });
          if (byVault) return remember(key, byVault.id);
        }
      }
    }

    return remember(key, null);
  } catch (err) {
    logger.debug('[Lifecycle] Asset resolution skipped', { error: String(err) });
    return null;
  }
}
