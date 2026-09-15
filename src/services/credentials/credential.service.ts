import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { certificateService } from '../certificates/certificate.service';
import {
  mapCertificateLifecycle,
  toCertificateCredentialDto,
  type CredentialDto,
} from './credential-projection';

const SOURCE_CERTIFICATE = 'PINIT_CERTIFICATE' as const;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

type CredentialStore = {
  upsert: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<Array<{ id: string; sourceId: string }>>;
};

function credentialStore(): CredentialStore | null {
  const store = (prisma as { credential?: CredentialStore }).credential;
  return store ?? null;
}

type RawCredentialRow = { id: string; sourceId: string };

async function upsertCertificateProjection(data: {
  userId: string;
  sourceId: string;
  lifecycleStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  issuedAt: Date;
  expiresAt: Date | null;
  assetId: string | null;
}): Promise<void> {
  const store = credentialStore();
  if (store) {
    await store.upsert({
      where: {
        sourceType_sourceId: {
          sourceType: SOURCE_CERTIFICATE,
          sourceId: data.sourceId,
        },
      },
      create: {
        userId: data.userId,
        type: 'CERTIFICATE',
        sourceType: SOURCE_CERTIFICATE,
        sourceId: data.sourceId,
        trustState: 'PINIT_VERIFIED',
        lifecycleStatus: data.lifecycleStatus,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
        assetId: data.assetId,
      },
      update: {
        lifecycleStatus: data.lifecycleStatus,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
        assetId: data.assetId,
        trustState: 'PINIT_VERIFIED',
        type: 'CERTIFICATE',
      },
    });
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO "credentials" (
      "id", "createdAt", "updatedAt", "userId", "type", "sourceType", "sourceId",
      "trustState", "lifecycleStatus", "issuedAt", "expiresAt", "assetId"
    )
    VALUES (
      ${randomUUID()},
      NOW(),
      NOW(),
      ${data.userId},
      CAST('CERTIFICATE' AS "CredentialType"),
      CAST('PINIT_CERTIFICATE' AS "CredentialSourceType"),
      ${data.sourceId},
      CAST('PINIT_VERIFIED' AS "CredentialTrustState"),
      CAST(${data.lifecycleStatus} AS "CredentialLifecycleStatus"),
      ${data.issuedAt},
      ${data.expiresAt},
      ${data.assetId}
    )
    ON CONFLICT ("sourceType", "sourceId") DO UPDATE SET
      "lifecycleStatus" = EXCLUDED."lifecycleStatus",
      "issuedAt" = EXCLUDED."issuedAt",
      "expiresAt" = EXCLUDED."expiresAt",
      "assetId" = EXCLUDED."assetId",
      "trustState" = EXCLUDED."trustState",
      "type" = EXCLUDED."type",
      "updatedAt" = NOW()
  `;
}

async function listCertificateProjectionRows(userId: string): Promise<RawCredentialRow[]> {
  const store = credentialStore();
  if (store) {
    return store.findMany({
      where: { userId, type: 'CERTIFICATE', sourceType: SOURCE_CERTIFICATE },
      orderBy: { issuedAt: 'desc' },
    });
  }
  return prisma.$queryRaw<RawCredentialRow[]>`
    SELECT id, "sourceId"
    FROM "credentials"
    WHERE "userId" = ${userId}
      AND type = CAST('CERTIFICATE' AS "CredentialType")
      AND "sourceType" = CAST('PINIT_CERTIFICATE' AS "CredentialSourceType")
    ORDER BY "issuedAt" DESC NULLS LAST
  `;
}

/**
 * Project this owner's Certificate rows into Credential rows.
 * Certificate remains authoritative. Unique (sourceType, sourceId) prevents duplicates.
 */
export async function syncCertificateProjections(userId: string): Promise<void> {
  const certs = await prisma.certificate.findMany({
    where: { ownerUserId: userId },
    select: {
      certificateId: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      assetId: true,
    },
  });

  for (const cert of certs) {
    try {
      await upsertCertificateProjection({
        userId,
        sourceId: cert.certificateId,
        lifecycleStatus: mapCertificateLifecycle(cert.status),
        issuedAt: cert.issuedAt,
        expiresAt: cert.expiresAt,
        assetId: cert.assetId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

/**
 * Hub Protect New stores a vault file and does not always issue a Certificate.
 * Credentials lists certificates, so issue a real Pinit cert for live owned vaults
 * that still have none. Existing Certificate rows are left as-is.
 */
async function ensureCertificatesForLiveVaults(userId: string): Promise<void> {
  const vaults = await prisma.vaultRecord.findMany({
    where: { dnaRecord: { ownerUserId: userId } },
    select: { id: true, dnaRecordId: true },
  });
  if (!vaults.length) return;

  const existing = await prisma.certificate.findMany({
    where: { ownerUserId: userId, vaultId: { in: vaults.map((v) => v.id) } },
    select: { vaultId: true },
  });
  /*
   * A vault is "already certified" if it has any certificate at all, not only an
   * active one.
   *
   * Gating on ACTIVE meant a revoked or expired certificate left the vault
   * looking uncertified, so opening Credentials minted a replacement — silently
   * undoing the revocation, and minting another on every load after that.
   * Re-issuing after a revocation is a deliberate act, not a side effect of
   * viewing a page.
   */
  const certified = new Set(existing.map((c) => c.vaultId));

  for (const vault of vaults) {
    if (certified.has(vault.id)) continue;
    try {
      await certificateService.issue({
        dnaRecordId: vault.dnaRecordId,
        vaultId: vault.id,
        ownerUserId: userId,
        issuedByUserId: userId,
      });
    } catch {
      /* leave listing honest if issue fails; do not invent a credential */
    }
  }
}

export async function listMyCredentials(userId: string): Promise<{
  credentials: CredentialDto[];
  counts: { total: number; pinitVerified: number };
}> {
  // Give older protected files their Asset identity first: a certificate can
  // only offer "View protected asset" once the Asset exists to point at.
  try {
    const { assetService } = await import('../assets/asset.service');
    await assetService.ensureAssetIdentityForOwner(userId);
  } catch {
    /* identity is additive — Credentials still lists from Certificate + Vault */
  }
  await ensureCertificatesForLiveVaults(userId);
  await syncCertificateProjections(userId);

  const rows = await listCertificateProjectionRows(userId);

  const certificateIds = rows.map((r) => r.sourceId);
  const certs = certificateIds.length
    ? await prisma.certificate.findMany({
        where: { ownerUserId: userId, certificateId: { in: certificateIds } },
        select: {
          certificateId: true,
          status: true,
          issuedAt: true,
          expiresAt: true,
          assetId: true,
          vaultId: true,
        },
      })
    : [];
  const certByPublicId = new Map(certs.map((c) => [c.certificateId, c]));

  const assetIds = [...new Set(certs.map((c) => c.assetId).filter((id): id is string => Boolean(id)))];
  const assets = assetIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: assetIds }, ownerUserId: userId },
        select: { id: true, originalFilename: true, vaultId: true },
      })
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const vaultIds = [...new Set([
    ...certs.map((c) => c.vaultId),
    ...assets.map((a) => a.vaultId).filter((id): id is string => Boolean(id)),
  ].filter(Boolean))];
  const vaults = vaultIds.length
    ? await prisma.vaultRecord.findMany({
        where: { id: { in: vaultIds }, dnaRecord: { ownerUserId: userId } },
        select: { id: true, originalFileName: true },
      })
    : [];
  const vaultById = new Map(vaults.map((v) => [v.id, v]));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true },
  });

  const credentials: CredentialDto[] = [];
  for (const row of rows) {
    const cert = certByPublicId.get(row.sourceId);
    if (!cert) continue;
    const asset = cert.assetId ? assetById.get(cert.assetId) ?? null : null;
    const vault =
      vaultById.get(cert.vaultId)
      ?? (asset?.vaultId ? vaultById.get(asset.vaultId) ?? null : null);
    // Certificate rows stay in the backend. Credentials only surfaces certificates with a live vault file.
    if (!vault) continue;
    const vaultFocusId = asset?.vaultId && vaultById.has(asset.vaultId)
      ? asset.vaultId
      : (vaultById.has(cert.vaultId) ? cert.vaultId : vault.id);
    credentials.push(toCertificateCredentialDto({
      credentialId: row.id,
      certificateId: cert.certificateId,
      status: cert.status,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
      recipientName: user?.fullName || null,
      assetId: cert.assetId,
      assetFileName: asset?.originalFilename ?? null,
      assetOwned: Boolean(asset),
      vaultFileName: vault?.originalFileName ?? null,
      vaultFocusId,
    }));
  }

  const pinitVerified = credentials.filter((c) => c.trustState === 'PINIT_VERIFIED').length;
  return {
    credentials,
    counts: { total: credentials.length, pinitVerified },
  };
}

export async function getMyCredential(userId: string, credentialId: string): Promise<CredentialDto> {
  const { credentials } = await listMyCredentials(userId);
  const match = credentials.find(
    (c) => c.id === credentialId || c.source.id === credentialId,
  );
  if (!match) throw new AppError(404, 'Credential not found');
  return match;
}
