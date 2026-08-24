/**
 * Authorization identity — independent of how the user logged in.
 *
 * Face + liveness and WebAuthn/passkey are authentication factors only.
 * They mint a JWT. They are never re-used as vault/asset ownership.
 *
 * Even if a biometric bug mis-identifies a person, every protected API still
 * enforces: JWT.sub == resource.ownerUserId.
 *
 * Never trust userId from req.body / query / params.
 */
import { Request } from 'express';
import { prisma } from './prisma';
import { AppError } from '../api/middleware/error.middleware';

/** Client fields that must never be the authorization source. */
export const CLIENT_OWNER_KEYS = [
  'userId',
  'user_id',
  'ownerId',
  'owner_id',
  'ownerUserId',
  'owner_user_id',
  'tenantId',
  'tenant_id',
] as const;

/** JWT.sub — the only authorization principal for vault, assets, DNA, certificates. */
export function getAuthUserId(req: Request): string {
  const userId = (req as { user?: { sub?: string } }).user?.sub;
  if (!userId) throw new AppError(401, 'Unauthorized');
  return userId;
}

export function isPrivilegedAdminRole(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/**
 * Drop client-supplied owner/user/tenant ids so they cannot override JWT sub.
 * Privileged admins keep these fields for explicit cross-user admin routes.
 */
export function stripClientOwnerIdentity(req: Request): void {
  const role = (req as { user?: { role?: string } }).user?.role;
  if (isPrivilegedAdminRole(role)) return;

  const strip = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    const rec = obj as Record<string, unknown>;
    for (const key of CLIENT_OWNER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(rec, key)) delete rec[key];
    }
  };

  strip(req.body);
  strip(req.query);
  strip(req.params);
}

function notFound(resource: string): never {
  throw new AppError(404, `${resource} not found`);
}

/** Reject cross-tenant access. Null ownerUserId records are NOT shared. */
export function assertRecordOwner(ownerUserId: string | null | undefined, userId: string, resource = 'Resource'): void {
  if (!ownerUserId || ownerUserId !== userId) {
    throw new AppError(403, `${resource} access denied`);
  }
}

export async function assertDnaOwner(dnaRecordId: string, userId: string): Promise<void> {
  const rec = await prisma.dnaRecord.findFirst({
    where: { id: dnaRecordId, ownerUserId: userId },
    select: { id: true },
  });
  if (!rec) notFound('DNA record');
}

export async function assertVaultOwner(vaultId: string, userId: string): Promise<void> {
  const vault = await prisma.vaultRecord.findFirst({
    where: { id: vaultId, dnaRecord: { ownerUserId: userId } },
    select: { id: true },
  });
  if (!vault) notFound('Vault record');
}

export async function assertShareLinkOwnerByToken(token: string, userId: string): Promise<string> {
  const link = await prisma.shareLink.findFirst({
    where: { token, ownerUserId: userId },
    select: { id: true },
  });
  if (!link) notFound('Share link');
  return link.id;
}

export async function assertMonitorOwner(monitorId: string, userId: string): Promise<void> {
  const mon = await prisma.monitorRecord.findFirst({
    where: { id: monitorId, ownerUserId: userId },
    select: { id: true },
  });
  if (!mon) notFound('Monitor');
}

export async function assertCertificateOwnerByCertId(certificateId: string, userId: string): Promise<void> {
  const cert = await prisma.certificate.findUnique({
    where: { certificateId },
    select: { ownerUserId: true, dnaRecordId: true },
  });
  if (!cert) notFound('Certificate');
  if (cert.ownerUserId) {
    if (cert.ownerUserId !== userId) notFound('Certificate');
    return;
  }
  if (!cert.dnaRecordId) notFound('Certificate');
  const dna = await prisma.dnaRecord.findFirst({
    where: { id: cert.dnaRecordId, ownerUserId: userId },
    select: { id: true },
  });
  if (!dna) notFound('Certificate');
}

export async function assertCrawlResultOwner(crawlResultId: string, userId: string): Promise<void> {
  const cr = await prisma.crawlResult.findFirst({
    where: { id: crawlResultId, monitorRecord: { ownerUserId: userId } },
    select: { id: true },
  });
  if (!cr) notFound('Alert');
}

export async function assertEvidenceOwner(evidenceId: string, userId: string): Promise<void> {
  const ev = await prisma.evidenceRecord.findUnique({
    where: { id: evidenceId },
    select: { ownerUserId: true, dnaRecordId: true },
  });
  if (!ev) notFound('Evidence record');
  if (ev.ownerUserId) {
    if (ev.ownerUserId !== userId) notFound('Evidence record');
    return;
  }
  if (ev.dnaRecordId) {
    const dna = await prisma.dnaRecord.findFirst({
      where: { id: ev.dnaRecordId, ownerUserId: userId },
      select: { id: true },
    });
    if (dna) return;
  }
  notFound('Evidence record');
}

export async function ownedDnaIdSet(userId: string): Promise<Set<string>> {
  const rows = await prisma.dnaRecord.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export function filterByOwnedDna<T extends { dnaRecordId?: string | null }>(
  items: T[] | undefined,
  ownedIds: Set<string>,
): T[] {
  if (!items?.length) return [];
  return items.filter((item) => Boolean(item.dnaRecordId && ownedIds.has(item.dnaRecordId)));
}

export const dnaOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const vaultOwnerWhere = (userId: string) => ({
  dnaRecord: { ownerUserId: userId },
});

export const shareLinkOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const monitorOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const certificateOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const assetOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export async function assertAssetOwner(assetId: string, userId: string): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId: userId },
    select: { id: true },
  });
  if (!asset) notFound('Asset');
}
