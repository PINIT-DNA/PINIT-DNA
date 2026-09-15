/**
 * Campaign Versions — open/download file bytes after org scope is proven.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const requireOrgRole = jest.fn<AnyAsync>();
const assetVersionFindFirst = jest.fn<AnyAsync>();
const vaultFindUnique = jest.fn<AnyAsync>();
const vaultRetrieve = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    assetVersion: { findFirst: assetVersionFindFirst },
    vaultRecord: { findUnique: vaultFindUnique },
  },
}));

jest.mock('../../src/services/organization/org-access.service', () => ({
  requireOrgRole,
}));

jest.mock('../../src/services/organization/audit-log.service', () => ({
  logOrgAudit: jest.fn<AnyAsync>().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/platform-events/notification-policy', () => ({
  emitBusinessEvent: jest.fn<AnyAsync>().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/vault/vault.service', () => ({
  VaultService: class {
    retrieve = vaultRetrieve;
  },
}));

import { assetVersionService } from '../../src/services/organization/asset-version.service';

describe('assetVersionService.getFile', () => {
  beforeEach(() => {
    requireOrgRole.mockReset().mockResolvedValue({ role: 'VIEWER' });
    assetVersionFindFirst.mockReset();
    vaultFindUnique.mockReset();
    vaultRetrieve.mockReset();
  });

  test('404 when the version has no vault file', async () => {
    assetVersionFindFirst.mockResolvedValue({
      id: 'v1', organizationId: 'org1', vaultId: null, mimeType: 'image/png', originalFilename: 'a.png',
    });
    await expect(assetVersionService.getFile('org1', 'u1', 'v1')).rejects.toEqual(
      expect.objectContaining({ statusCode: 404 }),
    );
    expect(vaultRetrieve).not.toHaveBeenCalled();
  });

  test('retrieves using the vault owner after org authorization', async () => {
    assetVersionFindFirst.mockResolvedValue({
      id: 'v1',
      organizationId: 'org1',
      vaultId: 'vault1',
      mimeType: 'image/jpeg',
      originalFilename: 'shot.jpg',
    });
    vaultFindUnique.mockResolvedValue({
      id: 'vault1',
      dnaRecord: { ownerUserId: 'owner-9' },
    });
    vaultRetrieve.mockResolvedValue({
      originalBuffer: Buffer.from('jpeg-bytes'),
      originalMimeType: 'image/jpeg',
      originalFileName: 'shot.jpg',
    });

    const file = await assetVersionService.getFile('org1', 'reviewer-2', 'v1');

    expect(requireOrgRole).toHaveBeenCalledWith('reviewer-2', 'org1', 'VIEWER');
    expect(vaultRetrieve).toHaveBeenCalledWith('vault1', 'owner-9');
    expect(file.filename).toBe('shot.jpg');
    expect(file.mimeType).toBe('image/jpeg');
    expect(file.buffer.toString()).toBe('jpeg-bytes');
  });
});
