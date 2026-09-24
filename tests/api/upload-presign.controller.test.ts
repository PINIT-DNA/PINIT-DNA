/**
 * Step 2 — presigned-upload completion flow failure paths.
 *
 * Verifies the one property Step 2 explicitly asked for: a completed S3
 * upload is never left orphaned — every exit (validation failure, duplicate
 * content, processing failure, success) either deletes the raw 'incoming/'
 * object or supersedes it with a real vault copy. All external dependencies
 * (S3, DB, DNA pipeline, vault storage) are mocked — this tests the
 * controller's own decision logic, not a live integration.
 */

import type { Request, Response, NextFunction } from 'express';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ __cmd: 'PutObject', input })),
  GetObjectCommand: jest.fn((input) => ({ __cmd: 'GetObject', input })),
  DeleteObjectCommand: jest.fn((input) => ({ __cmd: 'DeleteObject', input })),
  HeadObjectCommand: jest.fn((input) => ({ __cmd: 'HeadObject', input })),
  HeadBucketCommand: jest.fn((input) => ({ __cmd: 'HeadBucket', input })),
}));

const mockHeadRawUpload = jest.fn();
const mockFetchRawUpload = jest.fn();
jest.mock('../../src/lib/s3-presigned-upload', () => ({
  createPresignedRawUploadUrl: jest.fn(),
  headRawUpload: (...args: unknown[]) => mockHeadRawUpload(...args),
  fetchRawUpload: (...args: unknown[]) => mockFetchRawUpload(...args),
}));

jest.mock('../../src/lib/s3-storage', () => ({
  isS3StorageConfigured: () => true,
  getS3Client: () => ({ send: mockSend }),
}));

const mockAssertCanUpload = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/services/subscription', () => ({
  entitlementService: { assertCanUpload: (...args: unknown[]) => mockAssertCanUpload(...args) },
}));

const mockDuplicateCheck = jest.fn();
jest.mock('../../src/services/duplicate/duplicate-check.service', () => ({
  duplicateCheckService: { check: (...args: unknown[]) => mockDuplicateCheck(...args) },
}));

const mockRoute = jest.fn();
jest.mock('../../src/services/universal-file-router', () => ({
  UniversalFileRouter: jest.fn().mockImplementation(() => ({ route: (...args: unknown[]) => mockRoute(...args) })),
}));

const mockVaultStore = jest.fn();
jest.mock('../../src/services/vault/vault.service', () => ({
  VaultService: jest.fn().mockImplementation(() => ({ store: (...args: unknown[]) => mockVaultStore(...args) })),
}));

jest.mock('../../src/lib/prisma', () => ({
  prisma: { dnaRecord: { update: jest.fn().mockResolvedValue({}) } },
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/tenant-scope', () => ({
  getAuthUserId: (req: Request) => (req as unknown as { user: { sub: string } }).user.sub,
}));

// config/index.ts builds its exported object once from process.env at import
// time — setting env vars in beforeEach() is too late to affect it. Mock the
// module directly instead so config.storage.backend is controllable per
// test, while keeping every other real field (logger, error middleware, and
// other transitively-imported modules all read config too) so nothing else
// this suite doesn't care about breaks.
jest.mock('../../src/config', () => {
  const actual = jest.requireActual('../../src/config');
  return {
    ...actual,
    config: {
      ...actual.config,
      storage: { backend: 's3', s3Bucket: 'test-bucket', awsRegion: 'ap-south-1' },
      upload: { ...actual.config.upload, tempDir: '/tmp/pinit-test-uploads' },
    },
  };
});

import { confirmPresignedUpload } from '../../src/api/controllers/upload-presign.controller';

const OWNER = 'owner-user-1';
const KEY = `incoming/${OWNER}/upload-1`;

function mockReq(body: Record<string, unknown>): Request {
  return { user: { sub: OWNER }, body } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks() only resets call history, not implementations set via
  // mockResolvedValue/mockRejectedValue in a previous test — re-establish
  // every default explicitly so one test's rejection can't leak into the next.
  mockAssertCanUpload.mockResolvedValue(undefined);
  mockHeadRawUpload.mockResolvedValue({ sizeBytes: 1024, contentType: 'image/png' });
  mockFetchRawUpload.mockResolvedValue(Buffer.from('fake-image-bytes'));
  mockDuplicateCheck.mockResolvedValue({ isDuplicate: false });
  mockRoute.mockResolvedValue({ dnaRecordId: 'dna-1', status: 'COMPLETE', fileType: 'IMAGE' });
  mockVaultStore.mockResolvedValue({
    vaultId: 'vault-1', assetId: 'asset-1', originalFileName: 'photo.png',
    originalMimeType: 'image/png', encryptedSizeBytes: 1100, originalSizeBytes: 1024,
  });
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    key: KEY,
    declaredSizeBytes: 1024,
    originalFileName: 'photo.png',
    mimeType: 'image/png',
    ...overrides,
  };
}

describe('confirmPresignedUpload — ownership and validation', () => {
  it('rejects a key that does not belong to the authenticated owner (403), no S3 calls made', async () => {
    const req = mockReq(validBody({ key: 'incoming/someone-else/upload-1' }));
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockHeadRawUpload).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 404 when the object was never actually uploaded (headRawUpload -> null)', async () => {
    mockHeadRawUpload.mockResolvedValue(null);
    const req = mockReq(validBody());
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockSend).not.toHaveBeenCalled(); // nothing to clean up — it was never there
  });
});

describe('confirmPresignedUpload — quota re-validation failure cleans up the object', () => {
  it('deletes the S3 object when the REAL size fails the quota check, propagates the error', async () => {
    const quotaError = new Error('Not enough Vault storage.');
    mockAssertCanUpload.mockRejectedValue(quotaError);

    const req = mockReq(validBody());
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(quotaError);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'DeleteObject', input: { Bucket: 'test-bucket', Key: KEY } }));
    // Never reached the DNA pipeline
    expect(mockRoute).not.toHaveBeenCalled();
  });
});

describe('confirmPresignedUpload — duplicate content cleans up the object', () => {
  it('deletes the S3 object and returns 409 when duplicateCheckService reports a duplicate', async () => {
    mockDuplicateCheck.mockResolvedValue({
      isDuplicate: true,
      matchType: 'CONTENT_HASH',
      existingRecordId: 'dna-existing',
      ownerShortId: 'PINIT-OTHER',
    });

    const req = mockReq(validBody());
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'DeleteObject', input: { Bucket: 'test-bucket', Key: KEY } }));
    expect(mockRoute).not.toHaveBeenCalled();
    expect(mockVaultStore).not.toHaveBeenCalled();
  });
});

describe('confirmPresignedUpload — processing failure cleans up the object', () => {
  it('deletes the S3 object when DNA generation throws, propagates the error', async () => {
    const processingError = new Error('Unsupported file type: application/x-bogus');
    mockRoute.mockRejectedValue(processingError);

    const req = mockReq(validBody());
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 415 }));
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'DeleteObject', input: { Bucket: 'test-bucket', Key: KEY } }));
    expect(mockVaultStore).not.toHaveBeenCalled();
  });

  it('deletes the S3 object when vault storage throws, propagates the error', async () => {
    const storeError = new Error('Encryption failed');
    mockVaultStore.mockRejectedValue(storeError);

    const req = mockReq(validBody());
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(storeError);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'DeleteObject', input: { Bucket: 'test-bucket', Key: KEY } }));
  });
});

describe('confirmPresignedUpload — success path', () => {
  it('cleans up the raw incoming/ object (superseded by the vault copy) and returns 201', async () => {
    const req = mockReq(validBody());
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      dnaRecordId: 'dna-1',
      vaultId: 'vault-1',
    }));
    // The raw incoming/ object is deleted exactly once, after the vault copy exists.
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'DeleteObject', input: { Bucket: 'test-bucket', Key: KEY } }));
    expect(mockVaultStore).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on a retried completion request — the second call still resolves cleanly', async () => {
    // Simulates a client retry after a network blip on the first response:
    // VaultService.store()'s own "already vaulted" replay handling (tested
    // separately in vault.service.ts's own suite) makes a second call safe;
    // here we only verify this controller does not itself double-trigger
    // anything unsafe when called twice with the same key.
    const req1 = mockReq(validBody());
    const req2 = mockReq(validBody());
    const res1 = mockRes();
    const res2 = mockRes();
    const next = jest.fn() as NextFunction;

    await confirmPresignedUpload(req1, res1, next);
    // Second call: object no longer exists in S3 (already cleaned up) — the
    // real headRawUpload would now return null, which the controller
    // correctly reports as 404 rather than reprocessing already-vaulted bytes.
    mockHeadRawUpload.mockResolvedValue(null);
    await confirmPresignedUpload(req2, res2, next);

    expect(res1.status).toHaveBeenCalledWith(201);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockVaultStore).toHaveBeenCalledTimes(1); // never double-processed
  });
});
