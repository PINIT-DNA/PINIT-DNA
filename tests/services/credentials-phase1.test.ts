import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    certificate: { findMany: jest.fn() },
    credential: { findMany: jest.fn(), upsert: jest.fn() },
    vaultRecord: { findMany: jest.fn() },
    asset: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../src/services/certificates/certificate.service', () => ({
  certificateService: { issue: jest.fn(async () => ({})) },
}));

import { prisma } from '../../src/lib/prisma';
import { certificateService } from '../../src/services/certificates/certificate.service';
import {
  certificateDisplayTitle,
  dtoOmitsSecrets,
  mapCertificateLifecycle,
  toCertificateCredentialDto,
} from '../../src/services/credentials/credential-projection';
import { getMyCredential, listMyCredentials, syncCertificateProjections } from '../../src/services/credentials/credential.service';
import { AppError } from '../../src/api/middleware/error.middleware';
import { getAuthUserId } from '../../src/lib/tenant-scope';

const certFindMany = prisma.certificate.findMany as unknown as jest.Mock<AnyAsync>;
const credFindMany = prisma.credential.findMany as unknown as jest.Mock<AnyAsync>;
const credUpsert = prisma.credential.upsert as unknown as jest.Mock<AnyAsync>;
const vaultFindMany = prisma.vaultRecord.findMany as unknown as jest.Mock<AnyAsync>;
const assetFindMany = prisma.asset.findMany as unknown as jest.Mock<AnyAsync>;
const userFindUnique = prisma.user.findUnique as unknown as jest.Mock<AnyAsync>;
const issueCert = certificateService.issue as unknown as jest.Mock<AnyAsync>;

const USER_A = 'user-a';
const USER_B = 'user-b';
const CERT_A = 'CERT-DNA-298D6232-AAAA-BBBB-CCCC-DDDDEEEEFFFF';

beforeEach(() => {
  certFindMany.mockReset();
  credFindMany.mockReset();
  credUpsert.mockReset();
  vaultFindMany.mockReset();
  assetFindMany.mockReset();
  userFindUnique.mockReset();
  issueCert.mockReset();
  credUpsert.mockResolvedValue({});
  vaultFindMany.mockResolvedValue([]);
  issueCert.mockResolvedValue({});
});

describe('credential projection mapping', () => {
  test('certificate trust state is Pinit Verified and lifecycle follows Certificate.status', () => {
    expect(mapCertificateLifecycle('ACTIVE')).toBe('ACTIVE');
    expect(mapCertificateLifecycle('REVOKED')).toBe('REVOKED');
    expect(mapCertificateLifecycle('EXPIRED')).toBe('EXPIRED');

    const dto = toCertificateCredentialDto({
      credentialId: 'cred-1',
      certificateId: CERT_A,
      status: 'ACTIVE',
      issuedAt: new Date('2026-09-03T00:00:00.000Z'),
      expiresAt: null,
      recipientName: 'Ashwithareddy',
      assetId: null,
      assetFileName: null,
      assetOwned: false,
      vaultFileName: 'Ocean.jpg',
      vaultFocusId: null,
    });
    expect(dto.trustState).toBe('PINIT_VERIFIED');
    expect(dto.lifecycleStatus).toBe('ACTIVE');
    expect(dto.title).toBe('Ocean');
    expect(dto.issuer).toBe('Pinit');
    expect(dto.relatedAsset).toBeNull();
    expect(dto.source).toEqual({ type: 'PINIT_CERTIFICATE', id: CERT_A });
    expect(dtoOmitsSecrets(dto)).toBe(true);
  });

  test('does not invent an asset relationship when Certificate.assetId is missing', () => {
    const dto = toCertificateCredentialDto({
      credentialId: 'cred-1',
      certificateId: CERT_A,
      status: 'ACTIVE',
      issuedAt: new Date(),
      expiresAt: null,
      recipientName: null,
      assetId: null,
      assetFileName: 'ShouldNotUse.jpg',
      assetOwned: false,
      vaultFileName: 'Ocean.jpg',
      vaultFocusId: null,
    });
    expect(dto.relatedAsset).toBeNull();
  });

  test('does not offer View protected asset without a real vault record to open', () => {
    const dto = toCertificateCredentialDto({
      credentialId: 'cred-1',
      certificateId: CERT_A,
      status: 'ACTIVE',
      issuedAt: new Date(),
      expiresAt: null,
      recipientName: null,
      assetId: 'asset-1',
      assetFileName: 'Ocean.jpg',
      assetOwned: true,
      vaultFileName: 'Ocean.jpg',
      vaultFocusId: null,
    });
    expect(dto.relatedAsset).toBeNull();
  });

  test('portfolio-style titles never become Pinit Verified through this mapper', () => {
    const dto = toCertificateCredentialDto({
      credentialId: 'cred-1',
      certificateId: CERT_A,
      status: 'REVOKED',
      issuedAt: new Date(),
      expiresAt: null,
      recipientName: null,
      assetId: 'asset-1',
      assetFileName: 'Summer Campaign.jpg',
      assetOwned: true,
      vaultFileName: 'Ocean.jpg',
      vaultFocusId: 'vault-owned-1',
    });
    expect(dto.trustState).toBe('PINIT_VERIFIED');
    expect(dto.lifecycleStatus).toBe('REVOKED');
    expect(dto.relatedAsset).toEqual({
      id: 'asset-1',
      title: 'Ocean',
      href: '/vault?id=vault-owned-1',
    });
    expect(JSON.stringify(dto.relatedAsset)).not.toMatch(/vaultId/);
  });

  test('title comes from a real filename, not a fabricated label when a file exists', () => {
    expect(certificateDisplayTitle({ vaultFileName: 'The_beach.png' })).toBe('The beach');
    expect(certificateDisplayTitle({
      assetFileName: 'Old_name.jpg',
      vaultFileName: 'Kochi.jpg',
    })).toBe('Kochi');
    expect(certificateDisplayTitle({})).toBe('Pinit Protected Asset Certificate');
  });
});

describe('certificate → credential projection', () => {
  test('projects an owned Certificate into a Credential upsert keyed by public certificateId', async () => {
    certFindMany.mockResolvedValueOnce([{
      certificateId: CERT_A,
      status: 'ACTIVE',
      issuedAt: new Date('2026-09-03'),
      expiresAt: null,
      assetId: null,
    }]);

    await syncCertificateProjections(USER_A);

    expect(credUpsert).toHaveBeenCalledTimes(1);
    const arg = credUpsert.mock.calls[0][0] as {
      where: { sourceType_sourceId: { sourceType: string; sourceId: string } };
      create: { userId: string; trustState: string; type: string };
    };
    expect(arg.where.sourceType_sourceId).toEqual({
      sourceType: 'PINIT_CERTIFICATE',
      sourceId: CERT_A,
    });
    expect(arg.create.userId).toBe(USER_A);
    expect(arg.create.trustState).toBe('PINIT_VERIFIED');
    expect(arg.create.type).toBe('CERTIFICATE');
  });

  test('duplicate source upsert is idempotent — unique (sourceType, sourceId)', async () => {
    certFindMany.mockResolvedValue([
      { certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date(), expiresAt: null, assetId: null },
    ]);
    await syncCertificateProjections(USER_A);
    await syncCertificateProjections(USER_A);
    expect(credUpsert).toHaveBeenCalledTimes(2);
    const first = credUpsert.mock.calls[0][0] as { where: { sourceType_sourceId: unknown } };
    const second = credUpsert.mock.calls[1][0] as { where: { sourceType_sourceId: unknown } };
    expect(first.where.sourceType_sourceId).toEqual(second.where.sourceType_sourceId);
  });

  test('unique violation on create is swallowed so a retry does not throw', async () => {
    certFindMany.mockResolvedValueOnce([
      { certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date(), expiresAt: null, assetId: null },
    ]);
    credUpsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.14.0',
      }),
    );
    await expect(syncCertificateProjections(USER_A)).resolves.toBeUndefined();
  });

  test('list returns only projected certificates — no portfolio rows', async () => {
    // listMyCredentials now gives older files their Asset identity first;
    // an owner with no vaults makes that a no-op.
    vaultFindMany.mockResolvedValueOnce([]);
    certFindMany
      .mockResolvedValueOnce([{
        certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date('2026-09-03'), expiresAt: null, assetId: null,
      }])
      .mockResolvedValueOnce([{
        certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date('2026-09-03'), expiresAt: null, assetId: null, vaultId: 'vault-1',
      }]);
    credFindMany.mockResolvedValueOnce([{
      id: 'cred-1', sourceId: CERT_A, userId: USER_A, type: 'CERTIFICATE',
    }]);
    vaultFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vault-1', originalFileName: 'Ocean.jpg' }]);
    assetFindMany.mockResolvedValueOnce([]);
    userFindUnique.mockResolvedValueOnce({ fullName: 'Ashwithareddy' });

    const result = await listMyCredentials(USER_A);
    expect(result.counts.total).toBe(1);
    expect(result.counts.pinitVerified).toBe(1);
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].title).toBe('Ocean');
    expect(result.credentials[0].source.id).toBe(CERT_A);
    expect(JSON.stringify(result)).not.toMatch(/portfolio/i);
    expect(dtoOmitsSecrets(result.credentials[0])).toBe(true);
  });

  test('does not list certificates whose vault file is gone — records stay in Certificate store', async () => {
    certFindMany
      .mockResolvedValueOnce([{
        certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date('2026-08-25'), expiresAt: null, assetId: null,
      }])
      .mockResolvedValueOnce([{
        certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date('2026-08-25'), expiresAt: null, assetId: null, vaultId: 'deleted-vault',
      }]);
    credFindMany.mockResolvedValueOnce([{
      id: 'cred-1', sourceId: CERT_A, userId: USER_A, type: 'CERTIFICATE',
    }]);
    vaultFindMany.mockResolvedValueOnce([]);
    assetFindMany.mockResolvedValueOnce([]);
    userFindUnique.mockResolvedValueOnce({ fullName: 'Ashwithareddy' });

    const result = await listMyCredentials(USER_A);
    expect(credUpsert).toHaveBeenCalled();
    expect(result.credentials).toHaveLength(0);
    expect(result.counts.total).toBe(0);
  });

  test('issues a real Pinit certificate for a live vault that does not have one yet', async () => {
    // listMyCredentials now gives older files their Asset identity first;
    // an owner with no vaults makes that a no-op.
    vaultFindMany.mockResolvedValueOnce([]);
    vaultFindMany
      .mockResolvedValueOnce([{ id: 'vault-new', dnaRecordId: 'dna-new' }])
      .mockResolvedValueOnce([{ id: 'vault-new', originalFileName: 'Fourth.jpg' }]);
    certFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date('2026-09-09'), expiresAt: null, assetId: null,
      }])
      .mockResolvedValueOnce([{
        certificateId: CERT_A, status: 'ACTIVE', issuedAt: new Date('2026-09-09'), expiresAt: null, assetId: null, vaultId: 'vault-new',
      }]);
    credFindMany.mockResolvedValueOnce([{
      id: 'cred-new', sourceId: CERT_A, userId: USER_A, type: 'CERTIFICATE',
    }]);
    assetFindMany.mockResolvedValueOnce([]);
    userFindUnique.mockResolvedValueOnce({ fullName: 'Ashwithareddy' });

    const result = await listMyCredentials(USER_A);
    expect(issueCert).toHaveBeenCalledWith(expect.objectContaining({
      dnaRecordId: 'dna-new',
      vaultId: 'vault-new',
      ownerUserId: USER_A,
    }));
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].title).toBe('Fourth');
  });

  test('does not re-issue when the vault already has a revoked certificate', async () => {
    // keep this test about re-issue only — the identity backfill is a no-op here
    vaultFindMany.mockResolvedValueOnce([]);
    // A revoked certificate is a deliberate act. Auto-issuing a fresh one on the
    // next page load would silently undo it, and would mint another on every
    // load after that.
    vaultFindMany
      .mockResolvedValueOnce([{ id: 'vault-rev', dnaRecordId: 'dna-rev' }])
      .mockResolvedValueOnce([{ id: 'vault-rev', originalFileName: 'Revoked.jpg' }]);
    certFindMany
      .mockResolvedValueOnce([{ vaultId: 'vault-rev', status: 'REVOKED' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    credFindMany.mockResolvedValueOnce([]);
    assetFindMany.mockResolvedValueOnce([]);
    userFindUnique.mockResolvedValueOnce({ fullName: 'Ashwithareddy' });

    await listMyCredentials(USER_A);

    expect(issueCert).not.toHaveBeenCalled();
  });

  test('user B cannot read user A credential by id', async () => {
    certFindMany.mockResolvedValue([]);
    credFindMany.mockResolvedValue([]);
    userFindUnique.mockResolvedValue({ fullName: 'B' });

    await expect(getMyCredential(USER_B, 'cred-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Credential not found',
    });
    expect(certFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: USER_B }),
    }));
  });

  test('unauthenticated identity is rejected by getAuthUserId', () => {
    expect(() => getAuthUserId({} as Request)).toThrow(AppError);
    try {
      getAuthUserId({} as Request);
    } catch (err) {
      expect((err as AppError).statusCode).toBe(401);
    }
  });
});
