/**
 * Tenant isolation helpers — every authenticated query must scope to JWT sub.
 * Never trust userId from req.body / query / params.
 */
import { Request } from 'express';
import { prisma } from './prisma';
import { AppError } from '../api/middleware/error.middleware';

export function getAuthUserId(req: Request): string {
  const userId = (req as { user?: { sub?: string } }).user?.sub;
  if (!userId) throw new AppError(401, 'Unauthorized');
  return userId;
}

/** Reject cross-tenant access. Null ownerUserId records are NOT shared — deny unless owner matches after backfill. */
export function assertRecordOwner(ownerUserId: string | null | undefined, userId: string, resource = 'Resource'): void {
  if (!ownerUserId || ownerUserId !== userId) {
    throw new AppError(403, `${resource} access denied`);
  }
}

export async function assertDnaOwner(dnaRecordId: string, userId: string): Promise<void> {
  const rec = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { ownerUserId: true },
  });
  if (!rec) throw new AppError(404, 'DNA record not found');
  assertRecordOwner(rec.ownerUserId, userId, 'DNA record');
}

export async function assertVaultOwner(vaultId: string, userId: string): Promise<void> {
  const vault = await prisma.vaultRecord.findUnique({
    where: { id: vaultId },
    select: { dnaRecord: { select: { ownerUserId: true } } },
  });
  if (!vault) throw new AppError(404, 'Vault record not found');
  assertRecordOwner(vault.dnaRecord?.ownerUserId, userId, 'Vault');
}

export async function assertShareLinkOwnerByToken(token: string, userId: string): Promise<string> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: { id: true, ownerUserId: true },
  });
  if (!link) throw new AppError(404, 'Share link not found');
  assertRecordOwner(link.ownerUserId, userId, 'Share link');
  return link.id;
}

export async function assertMonitorOwner(monitorId: string, userId: string): Promise<void> {
  const mon = await prisma.monitorRecord.findUnique({
    where: { id: monitorId },
    select: { ownerUserId: true },
  });
  if (!mon) throw new AppError(404, 'Monitor not found');
  assertRecordOwner(mon.ownerUserId, userId, 'Monitor');
}

export async function assertCertificateOwnerByCertId(certificateId: string, userId: string): Promise<void> {
  const cert = await prisma.certificate.findUnique({
    where: { certificateId },
    select: { ownerUserId: true, dnaRecordId: true },
  });
  if (!cert) throw new AppError(404, 'Certificate not found');
  if (cert.ownerUserId) {
    assertRecordOwner(cert.ownerUserId, userId, 'Certificate');
    return;
  }
  const dna = await prisma.dnaRecord.findUnique({
    where: { id: cert.dnaRecordId },
    select: { ownerUserId: true },
  });
  assertRecordOwner(dna?.ownerUserId, userId, 'Certificate');
}

export async function assertCrawlResultOwner(crawlResultId: string, userId: string): Promise<void> {
  const cr = await prisma.crawlResult.findUnique({
    where: { id: crawlResultId },
    select: { monitorRecord: { select: { ownerUserId: true } } },
  });
  if (!cr) throw new AppError(404, 'Alert not found');
  assertRecordOwner(cr.monitorRecord?.ownerUserId, userId, 'Alert');
}

export async function assertEvidenceOwner(evidenceId: string, userId: string): Promise<void> {
  const ev = await prisma.evidenceRecord.findUnique({
    where: { id: evidenceId },
    select: { ownerUserId: true, dnaRecordId: true },
  });
  if (!ev) throw new AppError(404, 'Evidence record not found');
  if (ev.ownerUserId) {
    assertRecordOwner(ev.ownerUserId, userId, 'Evidence');
    return;
  }
  if (ev.dnaRecordId) {
    await assertDnaOwner(ev.dnaRecordId, userId);
    return;
  }
  throw new AppError(403, 'Evidence access denied');
}

export const dnaOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const vaultOwnerWhere = (userId: string) => ({
  dnaRecord: { ownerUserId: userId },
});

export const shareLinkOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const monitorOwnerWhere = (userId: string) => ({ ownerUserId: userId });

export const certificateOwnerWhere = (userId: string) => ({ ownerUserId: userId });
