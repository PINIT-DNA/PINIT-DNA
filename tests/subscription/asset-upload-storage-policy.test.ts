/**
 * Asset upload policy: there is no fixed per-file size limit.
 * Whether an asset can be protected is decided by the owner's Vault storage.
 */
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import {
  entitlementService,
  storageUsageService,
  StorageLimitError,
  PlanCode,
} from '../../src/services/subscription';
import { errorMiddleware } from '../../src/api/middleware/error.middleware';
import { uploadAsset, uploadSingle } from '../../src/api/middleware/upload.middleware';
import { config } from '../../src/config';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const NOT_ENOUGH = 'Not enough Vault storage. Upgrade your storage to protect this asset.';

describe('Vault storage decides whether an asset can be protected', () => {
  afterEach(() => jest.restoreAllMocks());

  function stubPlan(limitBytes: number | null, usedBytes: number, enforcement = true) {
    jest.spyOn(entitlementService, 'isEnforcementEnabled').mockReturnValue(enforcement);
    jest.spyOn(entitlementService, 'getStorageLimitBytes').mockResolvedValue(limitBytes);
    jest.spyOn(entitlementService, 'getEffectivePlanCode').mockResolvedValue(PlanCode.FREE);
    return jest.spyOn(storageUsageService, 'getUsedBytes').mockResolvedValue(usedBytes);
  }

  it('allows a large file that fits in the remaining storage', async () => {
    stubPlan(2 * GB, 1 * GB);
    await expect(entitlementService.assertStorageAvailable('u1', 85 * MB)).resolves.toBeUndefined();
  });

  it('allows a file that exactly fills the remaining storage', async () => {
    stubPlan(2 * GB, 2 * GB - 85 * MB);
    await expect(entitlementService.assertStorageAvailable('u1', 85 * MB)).resolves.toBeUndefined();
  });

  it('refuses a file that does not fit, reporting its size and the remaining storage', async () => {
    stubPlan(2 * GB, 2 * GB - 10 * MB);
    const err = await entitlementService.assertStorageAvailable('u1', 85 * MB).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StorageLimitError);
    const e = err as StorageLimitError;
    expect(e.message).toBe(NOT_ENOUGH);
    expect(e.incomingBytes).toBe(85 * MB);
    expect(e.remainingBytes).toBe(10 * MB);
    expect(e.usedBytes).toBe(2 * GB - 10 * MB);
    expect(e.limitBytes).toBe(2 * GB);
    expect(e.requiredPlan).toBe(PlanCode.PRO);
  });

  it('never limits an unlimited plan by file size', async () => {
    const usage = stubPlan(null, 0);
    await expect(entitlementService.assertStorageAvailable('u1', 50 * GB)).resolves.toBeUndefined();
    expect(usage).not.toHaveBeenCalled();
  });

  it('does not check storage when enforcement is off', async () => {
    const usage = stubPlan(1 * MB, 1 * MB, false);
    await expect(entitlementService.assertStorageAvailable('u1', 10 * GB)).resolves.toBeUndefined();
    expect(usage).not.toHaveBeenCalled();
  });

  it('assertCanUpload still checks the asset count, then storage', async () => {
    stubPlan(2 * GB, 0);
    const count = jest.spyOn(entitlementService, 'assertCanProtectAsset').mockResolvedValue();
    const storage = jest.spyOn(entitlementService, 'assertStorageAvailable');

    await entitlementService.assertCanUpload('u1', 85 * MB);

    expect(count).toHaveBeenCalledWith('u1');
    expect(storage).toHaveBeenCalledWith('u1', 85 * MB);
  });

  it('answers 403 with a code, the file size and the remaining storage', () => {
    const err = new StorageLimitError(2 * GB - 10 * MB, 2 * GB, PlanCode.PRO, 85 * MB);
    const json = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = { headersSent: false, status: jest.fn(() => ({ json })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req: any = { method: 'POST', path: '/api/v1/dna/generate', originalUrl: '/api/v1/dna/generate', headers: {} };

    errorMiddleware(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'STORAGE_LIMIT_EXCEEDED',
      error: NOT_ENOUGH,
      fileBytes: 85 * MB,
      remainingBytes: 10 * MB,
      limitBytes: 2 * GB,
    }));
  });
});

describe('asset protection upload parser has no fixed size limit', () => {
  const limit = config.upload.maxFileSizeBytes;
  // Proving "larger than the limit" means sending more than it; keep the test cheap.
  const provable = limit <= 64 * MB;
  const maybe = provable ? it : it.skip;

  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const done = (req: any, res: any) => {
      if (req.file?.path) void fs.promises.unlink(req.file.path).catch(() => {});
      res.json({ size: req.file?.size ?? null });
    };
    app.post('/asset', uploadAsset, done);
    app.post('/limited', uploadSingle, done);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(413).json({ code: err?.code ?? 'ERROR' });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function post(route: string, bytes: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const form = new g.FormData();
    form.append('image', new g.Blob([Buffer.alloc(bytes)], { type: 'video/mp4' }), 'large-video.mp4');
    const response = await g.fetch(`${base}${route}`, { method: 'POST', body: form });
    return { status: response.status as number, body: await response.json() };
  }

  maybe('accepts an asset larger than the configured MAX_FILE_SIZE', async () => {
    const bytes = limit + 1 * MB;
    const result = await post('/asset', bytes);
    expect(result.status).toBe(200);
    expect(result.body.size).toBe(bytes);
  });

  maybe('leaves the limit in place on non-asset upload routes', async () => {
    const result = await post('/limited', limit + 1 * MB);
    expect(result.status).toBe(413);
    expect(result.body.code).toBe('LIMIT_FILE_SIZE');
  });
});
