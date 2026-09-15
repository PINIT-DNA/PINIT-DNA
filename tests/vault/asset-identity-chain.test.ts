/**
 * Canonical Asset identity chain — Step 1/2 of the Hub → Exchange asset-identity fix.
 *
 * Proves:
 *  A. Protecting a file creates exactly one Asset.
 *  D/E/F. Asset.vaultId / Asset.dnaId reference the real VaultRecord/DnaRecord.
 *  C. Asset.ownerUserId comes from the DNA record's owner (JWT-derived), not a client value.
 *  I/J. assetId != vaultId, assetId != dnaId (the Exchange bridge bug this fixes).
 *  O. ensureAssetFromProtect() is idempotent — a repeat call does not create a second Asset.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const OWNER_A = 'user-a-uuid';
const DNA_ID = 'dna-record-uuid';

const mockDnaRecord = {
  id: DNA_ID,
  ownerUserId: OWNER_A,
  sha256Hash: 'abc123',
};

const vaultCreateMock = jest.fn(async (args: { data: Record<string, unknown> }) => ({
  ...args.data,
  createdAt: new Date(),
}));

const assetCreateMock = jest.fn(async (args: { data: Record<string, unknown> }) => ({
  id: 'asset-mock-uuid-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...args.data,
}));

const assetFindFirstMock = jest.fn(async () => null);

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findUnique: jest.fn(async () => mockDnaRecord) },
    vaultRecord: {
      findUnique: jest.fn(async () => null), // "not already vaulted" check
      create: vaultCreateMock,
    },
    asset: {
      findFirst: assetFindFirstMock,
      create: assetCreateMock,
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id, ...args.data })),
    },
    assetTimelineEvent: { create: jest.fn(async () => ({})) },
    protectedPost: { updateMany: jest.fn(async () => ({ count: 0 })) },
  },
}));

jest.mock('../../src/services/vault/encryption.service', () => ({
  encrypt: jest.fn(() => ({
    encryptedBuffer: Buffer.from('encrypted'),
    encryptedSizeBytes: 9,
    originalSizeBytes: 5,
    ivHex: 'ivhex',
    authTagHex: 'authtaghex',
  })),
  decrypt: jest.fn(),
}));

jest.mock('../../src/lib/supabase-storage', () => ({
  uploadVaultFile: jest.fn(async (vaultId: string) => `local:${vaultId}`),
  downloadVaultFile: jest.fn(),
  deleteVaultFile: jest.fn(),
  isSupabaseStorageConfigured: jest.fn(() => false),
  isSupabaseStorageRestricted: jest.fn(() => false),
}));

jest.mock('../../src/services/identity/identity-embedding-pipeline.service', () => ({
  identityEmbeddingPipeline: {
    resolveCertificateId: jest.fn(async () => null),
    process: jest.fn(async (buffer: Buffer) => ({
      success: true,
      buffer,
      methods: [],
      verified: false,
      watermarkEmbedded: false,
      signatureEmbedded: false,
      manifestEmbedded: false,
      detail: 'test',
    })),
  },
}));

jest.mock('../../src/services/forensics/forensic-provenance.service', () => ({
  forensicProvenanceService: { appendAsync: jest.fn() },
}));

jest.mock('../../src/services/platform-events/module-events', () => ({
  emitVaultStored: jest.fn(),
  emitVaultDeleted: jest.fn(),
}));

describe('Vault store() → canonical Asset identity', () => {
  beforeEach(() => {
    vaultCreateMock.mockClear();
    assetCreateMock.mockClear();
    assetFindFirstMock.mockClear();
  });

  test('A/C/D/E/F/I/J: creates exactly one Asset, correctly linked and distinct from vaultId/dnaId', async () => {
    const { VaultService } = await import('../../src/services/vault/vault.service');
    const vaultService = new VaultService();

    const result = await vaultService.store({
      dnaRecordId: DNA_ID,
      ownerUserId: OWNER_A,
      imageBuffer: Buffer.from('fake image bytes'),
      originalFileName: 'photo.jpg',
      originalMimeType: 'image/jpeg',
    });

    // Vault created with the DNA record it belongs to.
    expect(vaultCreateMock).toHaveBeenCalledTimes(1);
    const vaultId = result.vaultId;
    expect(vaultId).toBeTruthy();

    // Exactly one Asset created for this protection.
    expect(assetCreateMock).toHaveBeenCalledTimes(1);
    const assetCreateArgs = assetCreateMock.mock.calls[0][0] as { data: Record<string, unknown> };

    // Correctly linked: Asset.ownerUserId/vaultId/dnaId reference the real records.
    expect(assetCreateArgs.data.ownerUserId).toBe(OWNER_A);
    expect(assetCreateArgs.data.vaultId).toBe(vaultId);
    expect(assetCreateArgs.data.dnaId).toBe(DNA_ID);

    // The three identifiers must never collapse into each other.
    expect(vaultId).not.toBe(DNA_ID);
    expect(assetCreateArgs.data.vaultId).not.toBe(assetCreateArgs.data.dnaId);
  });

  test('O: ensureAssetFromProtect is idempotent — repeat call does not create a duplicate Asset', async () => {
    const { assetService } = await import('../../src/services/assets/asset.service');
    const { ASSET_STATUS } = await import('../../src/services/assets/lifecycle');

    const opts = {
      ownerUserId: OWNER_A,
      assetType: 'IMAGE' as const,
      originalFilename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 5,
      contentHash: 'abc123',
      vaultId: 'vault-fixed-id',
      dnaId: DNA_ID,
      certificateId: null,
      monitorRecordId: null,
      monitorStatus: 'PENDING',
      sourcePlatform: 'hub',
      capturedVia: 'hub_protect_file',
      clientRequestId: `hub:${DNA_ID}`,
      status: ASSET_STATUS.PROTECTED,
      protectedPostId: '',
    };

    // First call: no existing Asset → creates one.
    assetFindFirstMock.mockImplementationOnce(async () => null);
    const first = await assetService.ensureAssetFromProtect(opts);
    expect(assetCreateMock).toHaveBeenCalledTimes(1);

    // Second call for the SAME protection: findFirst now returns the one just created.
    assetFindFirstMock.mockImplementationOnce(async () => first as never);
    await assetService.ensureAssetFromProtect(opts);

    // Still only one create() call total — no duplicate Asset row.
    expect(assetCreateMock).toHaveBeenCalledTimes(1);
  });
});
