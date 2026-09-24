/**
 * Step 3 — PDF/video background-job dispatch branching in VaultService.store().
 *
 * Verifies the two properties Step 3 explicitly requires:
 *   1. Default behavior (config.jobs.useQueue=false) is completely unchanged
 *      — the existing in-process fire-and-forget calls still fire.
 *   2. With config.jobs.useQueue=true, a job REFERENCE is published instead
 *      (dnaRecordId/vaultId/ownerUserId only) — never the raw file buffer —
 *      and the in-process call is skipped entirely.
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const OWNER = 'user-a-uuid';
const DNA_ID = 'dna-record-uuid';

const mockDnaRecord = { id: DNA_ID, ownerUserId: OWNER, sha256Hash: 'abc123' };

const vaultCreateMock = jest.fn(async (args: { data: Record<string, unknown> }) => ({
  ...args.data,
  createdAt: new Date(),
}));

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findUnique: jest.fn(async () => mockDnaRecord) },
    vaultRecord: { findUnique: jest.fn(async () => null), create: vaultCreateMock },
    asset: { findFirst: jest.fn(async () => null) },
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
  findVaultFileInSupabase: jest.fn(),
  isSupabaseStorageConfigured: jest.fn(() => false),
  isSupabaseStorageRestricted: jest.fn(() => false),
}));

jest.mock('../../src/services/identity/identity-embedding-pipeline.service', () => ({
  identityEmbeddingPipeline: {
    resolveCertificateId: jest.fn(async () => null),
    process: jest.fn(async (buffer: Buffer) => ({
      success: true, buffer, methods: [], verified: false,
      watermarkEmbedded: false, signatureEmbedded: false, manifestEmbedded: false, detail: 'test',
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

// Real ensureAssetFromProtect() does real network-adjacent work (AI/monitoring
// calls) beyond the DB write — leaving it unmocked here made the first two
// tests hang for ~35s waiting on a call with nothing listening, well past
// Jest's default 5000ms timeout. Mocked the same way asset-identity-chain.
// test.ts already does for the same reason.
jest.mock('../../src/services/assets/asset.service', () => ({
  assetService: {
    ensureAssetFromProtect: jest.fn(async () => ({ id: 'asset-mock-1' })),
    attachMediaFingerprints: jest.fn(async () => undefined),
  },
}));
jest.mock('../../src/services/assets/lifecycle', () => ({
  inferAssetType: jest.fn(() => 'IMAGE'),
  ASSET_STATUS: { PROTECTED: 'PROTECTED' },
}));

const mockUpgradePdf = jest.fn(async () => undefined);
jest.mock('../../src/services/documents/document-page-protection.service', () => ({
  documentPageProtectionService: { protectAndAssembleForVault: mockUpgradePdf },
}));

const mockProtectVideoFrames = jest.fn(async (_params: Record<string, unknown>) => undefined);
jest.mock('../../src/services/videos/video-page-protection.service', () => ({
  videoPageProtectionService: { protectVideoFrames: mockProtectVideoFrames },
}));

const mockPublish = jest.fn(async (_jobType: string, _payload: Record<string, unknown>) => undefined);
jest.mock('../../src/lib/job-queue', () => ({
  getJobQueue: () => ({ publish: mockPublish }),
}));

let queueEnabled = false;
jest.mock('../../src/config', () => {
  const actual = jest.requireActual('../../src/config') as { config: Record<string, unknown> };
  return {
    ...actual,
    get config() {
      return { ...actual.config, jobs: { get useQueue() { return queueEnabled; } } };
    },
  };
});

// Flush the microtask queue so the fire-and-forget `void x().catch()` calls
// inside store() actually run before assertions — store() itself resolves
// before these settle, by design (that's the whole point of fire-and-forget).
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  queueEnabled = false;
});

describe('VaultService.store() — PDF background dispatch', () => {
  test('default (useQueue=false): runs the in-process upgrade, does not publish to the queue', async () => {
    const { VaultService } = await import('../../src/services/vault/vault.service');
    const vaultService = new VaultService();

    await vaultService.store({
      dnaRecordId: DNA_ID,
      ownerUserId: OWNER,
      imageBuffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
      originalFileName: 'doc.pdf',
      originalMimeType: 'application/pdf',
    });
    await flushMicrotasks();

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpgradePdf).toHaveBeenCalledTimes(1);
  });

  test('useQueue=true: publishes a reference (no buffer), skips the in-process upgrade', async () => {
    queueEnabled = true;
    const { VaultService } = await import('../../src/services/vault/vault.service');
    const vaultService = new VaultService();

    await vaultService.store({
      dnaRecordId: DNA_ID,
      ownerUserId: OWNER,
      imageBuffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
      originalFileName: 'doc.pdf',
      originalMimeType: 'application/pdf',
    });
    await flushMicrotasks();

    expect(mockUpgradePdf).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [jobType, payload] = mockPublish.mock.calls[0];
    expect(jobType).toBe('pdf_protect');
    expect(payload).toMatchObject({ dnaRecordId: DNA_ID, ownerUserId: OWNER });
    expect(payload.vaultId).toBeTruthy();
    // The whole point of Step 3: never send file bytes through the queue.
    expect(JSON.stringify(payload)).not.toContain('fake pdf bytes');
    expect(Object.values(payload).some((v) => Buffer.isBuffer(v))).toBe(false);
  });
});

describe('VaultService.store() — video background dispatch', () => {
  test('default (useQueue=false): runs the in-process frame protection, does not publish to the queue', async () => {
    const { VaultService } = await import('../../src/services/vault/vault.service');
    const vaultService = new VaultService();

    await vaultService.store({
      dnaRecordId: DNA_ID,
      ownerUserId: OWNER,
      imageBuffer: Buffer.from('fake video bytes'),
      originalFileName: 'clip.mp4',
      originalMimeType: 'video/mp4',
    });
    await flushMicrotasks();

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockProtectVideoFrames).toHaveBeenCalledTimes(1);
  });

  test('useQueue=true: publishes a reference (no buffer), skips in-process frame protection', async () => {
    queueEnabled = true;
    const { VaultService } = await import('../../src/services/vault/vault.service');
    const vaultService = new VaultService();

    await vaultService.store({
      dnaRecordId: DNA_ID,
      ownerUserId: OWNER,
      imageBuffer: Buffer.from('fake video bytes'),
      originalFileName: 'clip.mp4',
      originalMimeType: 'video/mp4',
    });
    await flushMicrotasks();

    expect(mockProtectVideoFrames).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [jobType, payload] = mockPublish.mock.calls[0];
    expect(jobType).toBe('video_protect');
    expect(payload).toMatchObject({ videoDnaRecordId: DNA_ID, ownerUserId: OWNER });
    expect(payload.vaultId).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain('fake video bytes');
    expect(Object.values(payload).some((v) => Buffer.isBuffer(v))).toBe(false);
  });
});
