/**
 * One canonical Pinit certificate.
 *
 * The rules this pins down:
 *  A. Issuing twice for the same asset returns the SAME certificate — showing an
 *     asset in Portfolio or Exchange must never mint a second one.
 *  B. A certificate links to its asset in both directions, so every module resolves
 *     the same certificate for an asset instead of inventing an identity for it.
 *  C. The public view carries what a certificate says and none of the internals —
 *     no DNA id, no vault id, no signature.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const dnaFindUnique = jest.fn<AnyAsync>();
const vaultFindFirst = jest.fn<AnyAsync>();
const certFindFirst = jest.fn<AnyAsync>();
const certFindUnique = jest.fn<AnyAsync>();
const certCreate = jest.fn<AnyAsync>();
const certUpdate = jest.fn<AnyAsync>();
const assetFindFirst = jest.fn<AnyAsync>();
const assetUpdate = jest.fn<AnyAsync>();
const userFindUnique = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findUnique: dnaFindUnique },
    vaultRecord: { findFirst: vaultFindFirst },
    certificate: { findFirst: certFindFirst, findUnique: certFindUnique, create: certCreate, update: certUpdate },
    asset: { findFirst: assetFindFirst, update: assetUpdate },
    user: { findUnique: userFindUnique },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { certificateService } from '../../src/services/certificates/certificate.service';

const OWNER = 'owner-user';
const DNA = 'dna-1';
const VAULT = 'vault-1';
const ASSET = 'asset-1';
const EXISTING_ID = 'CERT-DNA-EXISTING';

const existingCert = {
  certificateId: EXISTING_ID,
  dnaRecordId: DNA,
  vaultId: VAULT,
  status: 'ACTIVE',
  signature: 'aa'.repeat(32),
  issuedAt: new Date('2026-09-01T10:00:00Z'),
  expiresAt: null,
  revokedAt: null,
  revocationReason: null,
  issuedByUserId: OWNER,
  ownerUserId: OWNER,
};

/** The async asset link runs after issue() returns. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  dnaFindUnique.mockReset().mockResolvedValue({ ownerUserId: OWNER });
  vaultFindFirst.mockReset().mockResolvedValue({ id: VAULT });
  certFindFirst.mockReset().mockResolvedValue(null);
  certFindUnique.mockReset().mockResolvedValue(null);
  certCreate.mockReset();
  certUpdate.mockReset().mockResolvedValue({});
  assetFindFirst.mockReset().mockResolvedValue({ id: ASSET, certificateId: null });
  assetUpdate.mockReset().mockResolvedValue({});
  userFindUnique.mockReset().mockResolvedValue({ shortId: 'PINIT-OWNER', fullName: 'Owner Name' });
});

describe('A. an asset never gets a second certificate', () => {
  test('issuing again returns the existing certificate and creates nothing', async () => {
    certFindFirst.mockResolvedValue(existingCert);

    const result = await certificateService.issue({
      dnaRecordId: DNA,
      vaultId: VAULT,
      ownerUserId: OWNER,
    });

    expect(result.certificateId).toBe(EXISTING_ID);
    expect(certCreate).not.toHaveBeenCalled();
  });

  test('the first issue creates exactly one certificate', async () => {
    certCreate.mockResolvedValue({ ...existingCert, certificateId: 'CERT-DNA-NEW' });

    const result = await certificateService.issue({
      dnaRecordId: DNA,
      vaultId: VAULT,
      ownerUserId: OWNER,
    });

    expect(certCreate).toHaveBeenCalledTimes(1);
    expect(result.certificateId).toBe('CERT-DNA-NEW');
  });
});

describe('B. certificate and asset point at each other', () => {
  test('a new certificate links to the asset both ways', async () => {
    certCreate.mockResolvedValue({ ...existingCert, certificateId: 'CERT-DNA-NEW' });

    await certificateService.issue({ dnaRecordId: DNA, vaultId: VAULT, ownerUserId: OWNER });
    await settle();

    // The service mints the id, so match its shape rather than a fixture value.
    const assetCall = assetUpdate.mock.calls[0]![0] as { where: { id: string }; data: { certificateId: string } };
    expect(assetCall.where).toEqual({ id: ASSET });
    expect(assetCall.data.certificateId).toMatch(/^CERT-DNA-/);

    const certCall = certUpdate.mock.calls[0]![0] as { where: { certificateId: string }; data: { assetId: string } };
    expect(certCall.where.certificateId).toBe(assetCall.data.certificateId);
    expect(certCall.data).toEqual({ assetId: ASSET });
  });

  test('an asset that already names a certificate is left alone', async () => {
    assetFindFirst.mockResolvedValue({ id: ASSET, certificateId: 'CERT-DNA-FIRST' });
    certCreate.mockResolvedValue({ ...existingCert, certificateId: 'CERT-DNA-SECOND' });

    await certificateService.issue({ dnaRecordId: DNA, vaultId: VAULT, ownerUserId: OWNER });
    await settle();

    expect(assetUpdate).not.toHaveBeenCalled();
  });

  test('a vault with no asset row links nothing and still issues', async () => {
    assetFindFirst.mockResolvedValue(null);
    certCreate.mockResolvedValue({ ...existingCert, certificateId: 'CERT-DNA-NEW' });

    const result = await certificateService.issue({ dnaRecordId: DNA, vaultId: VAULT, ownerUserId: OWNER });
    await settle();

    expect(result.certificateId).toBe('CERT-DNA-NEW');
    expect(assetUpdate).not.toHaveBeenCalled();
  });
});

describe('C. the public view shows the certificate, not the machinery', () => {
  test('carries status and holder, never internal ids or the signature', async () => {
    certFindUnique.mockImplementation(async (args: unknown) => {
      const select = (args as { select?: Record<string, boolean> }).select;
      // Second call asks only for the ids needed to look up display data.
      if (select?.['dnaRecordId']) return { dnaRecordId: DNA, ownerUserId: OWNER };
      return existingCert;
    });
    dnaFindUnique.mockResolvedValue({ imageFilename: 'clip.mp4', fileType: 'VIDEO', imageMimeType: 'video/mp4' });

    const view = await certificateService.verifyPublic(EXISTING_ID);

    expect(view.certificateId).toBe(EXISTING_ID);
    expect(view.subject).toEqual({ title: 'clip.mp4', fileType: 'VIDEO' });
    expect(view.holder).toEqual({ name: 'Owner Name', pinitId: 'PINIT-OWNER' });

    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(DNA);
    expect(serialised).not.toContain(VAULT);
    expect(serialised).not.toContain(existingCert.signature);
  });

  test('an unknown certificate is reported, not invented', async () => {
    certFindUnique.mockResolvedValue(null);

    const view = await certificateService.verifyPublic('CERT-DNA-NOPE');

    expect(view.valid).toBe(false);
    expect(view.status).toBe('NOT_FOUND');
    expect(view.certificate).toBeNull();
    expect(view.subject).toBeNull();
  });
});
