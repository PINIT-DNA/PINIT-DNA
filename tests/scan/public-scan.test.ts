import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { createPublicScanRouter } from '../../src/api/routes/public-scan.routes';
import type { PublicScanDetail } from '../../src/services/scan/public-scan.service';
import { issueScanChallenge, resetScanAttempts } from '../../src/services/scan/scan-guard';
import { toPublicScanBody, type PublicScanDraft } from '../../src/services/scan/public-scan-decision';

const PRIVATE = ['email', 'ownerEmail', 'address', 'ownerUserId', 'dnaRecordId', 'vaultId', 'phone', 'aadhaar'];

function multipart(token: string, name: string, honeypot = ''): { body: Buffer; type: string } {
  const boundary = '----pinit-scan';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="challenge"\r\n\r\n${token}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="company"\r\n\r\n${honeypot}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`,
  ];
  const body = Buffer.concat([
    Buffer.from(parts[0] + parts[1] + parts[2]),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

async function listen(
  queue: PublicScanDraft[],
  loadPublicDetails?: (id: string) => Promise<PublicScanDetail | null>,
): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/scan', createPublicScanRouter({
    scanImage: async () => queue.shift() ?? { verdict: 'not_found' },
    loadPublicDetails,
  }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function post(base: string, name: string, honeypot = ''): Promise<{ status: number; json: Record<string, unknown> }> {
  const { token } = issueScanChallenge(Date.now() - 2000);
  const { body, type } = multipart(token, name, honeypot);
  const res = await fetch(`${base}/api/v1/scan`, { method: 'POST', headers: { 'content-type': type }, body });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

function assertNoPrivate(json: Record<string, unknown>): void {
  const text = JSON.stringify(json);
  for (const key of Object.keys(json)) {
    expect(PRIVATE).not.toContain(key);
  }
  expect(text).not.toMatch(/@/);
  expect(text).not.toMatch(/ownerUserId|dnaRecordId|vaultId|aadhaar/i);
}

describe('public scan endpoint', () => {
  let base = '';
  let close: () => Promise<void> = async () => {};
  const queue: PublicScanDraft[] = [];

  beforeAll(async () => {
    const server = await listen(queue);
    base = server.base;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    resetScanAttempts();
    queue.length = 0;
  });

  test('found returns only the public card', async () => {
    queue.push({
      verdict: 'protected',
      ownerName: 'Asha Rao',
      protectedAt: '2026-01-02T03:04:00.000Z',
      matchStrength: 96,
      title: null,
      email: 'asha@example.com',
      ownerUserId: 'user-1',
      dnaRecordId: 'dna-1',
      vaultId: 'vault-1',
      address: '12 Market Road',
    });
    const { status, json } = await post(base, 'found.jpg');
    expect(status).toBe(200);
    expect(json.verdict).toBe('protected');
    expect(json.message).toContain('Protected by PINIT.');
    expect(json.message).toContain('does not by itself prove legal ownership');
    expect(json.detailsToken).toBeUndefined();
    expect(json.ownerName).toBe('Asha Rao');
    expect(json.protectedAt).toBe('2026-01-02T03:04:00.000Z');
    expect(json.matchStrength).toBe(96);
    expect(json.title).toBeUndefined();
    assertNoPrivate(json);
  });

  test('possible is labelled possible and still hides private fields', async () => {
    queue.push({
      verdict: 'possible',
      ownerName: 'Ravi',
      protectedAt: '2026-02-02T03:04:00.000Z',
      matchStrength: 91,
      email: 'ravi@example.com',
    });
    const { status, json } = await post(base, 'possible.jpg');
    expect(status).toBe(200);
    expect(json.verdict).toBe('possible');
    expect(json.message).toContain('Possible match.');
    expect(json.message).toContain('not a confirmed result');
    assertNoPrivate(json);
  });

  test('not found does not claim the image is free to use', async () => {
    queue.push({ verdict: 'not_found', email: 'hidden@example.com', ownerName: 'Should Not Show' });
    const { status, json } = await post(base, 'none.jpg');
    expect(status).toBe(200);
    expect(json.verdict).toBe('not_found');
    expect(json.message).toContain('No matching protected asset found');
    expect(json.message).toContain('does not mean the image is free to use');
    expect(json.message).toContain('unprotected everywhere');
    expect(json.ownerName).toBeUndefined();
    assertNoPrivate(json);
  });

  test('a filled honeypot is rejected', async () => {
    const { status } = await post(base, 'bot.jpg', 'http://spam.example');
    expect(status).toBe(400);
  });

  test('the ninth scan in the window is refused', async () => {
    for (let i = 0; i < 8; i++) queue.push({ verdict: 'not_found' });
    for (let i = 0; i < 8; i++) {
      const res = await post(base, 'ok.jpg');
      expect(res.status).toBe(200);
    }
    queue.push({ verdict: 'not_found' });
    const blocked = await post(base, 'again.jpg');
    expect(blocked.status).toBe(429);
    assertNoPrivate(blocked.json);
  });

  test('the serializer cannot be talked into returning a private field', () => {
    const body = toPublicScanBody({
      verdict: 'protected',
      ownerName: 'Asha Rao',
      email: 'asha@example.com',
      address: 'secret',
      ownerUserId: 'u',
      dnaRecordId: 'd',
      vaultId: 'v',
    });
    expect(Object.keys(body).sort()).toEqual(['message', 'ownerName', 'success', 'verdict']);
  });

  test('a non-image is rejected and is not reported as a match', async () => {
    queue.push({ verdict: 'protected', ownerName: 'Should Not Run' });
    const boundary = '----pinit-scan';
    const { token } = issueScanChallenge(Date.now() - 2000);
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="challenge"\r\n\r\n${token}\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="company"\r\n\r\n\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n`
      + `--${boundary}--\r\n`,
    );
    const res = await fetch(`${base}/api/v1/scan`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const json = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(json.verdict).toBeUndefined();
    expect(queue).toHaveLength(1);
    assertNoPrivate(json);
  });

  test('owner-approved details use a token and do not reveal the record id', async () => {
    const server = await listen(queue, async (id) => {
      if (id !== 'dna-secret') return null;
      return {
        optOut: false,
        ownerName: 'Asha Rao',
        protectedAt: '2026-01-02T03:04:00.000Z',
        title: 'Sunset study',
        recipientLabel: null,
      };
    });
    queue.push({
      verdict: 'protected',
      ownerName: 'Asha Rao',
      protectedAt: '2026-01-02T03:04:00.000Z',
      title: 'Sunset study',
      dnaRecordId: 'dna-secret',
      email: 'asha@example.com',
      vaultId: 'vault-secret',
    });
    const posted = await post(server.base, 'found.jpg');
    expect(posted.status).toBe(200);
    expect(typeof posted.json.detailsToken).toBe('string');
    expect(JSON.stringify(posted.json)).not.toContain('dna-secret');
    assertNoPrivate(posted.json);
    const details = await fetch(`${server.base}/api/v1/scan/details/${posted.json.detailsToken}`);
    const detailJson = await details.json() as Record<string, unknown>;
    expect(details.status).toBe(200);
    expect(detailJson.title).toBe('Sunset study');
    expect(detailJson.ownerName).toBe('Asha Rao');
    expect(JSON.stringify(detailJson)).not.toContain('dna-secret');
    assertNoPrivate(detailJson);
    const missing = await fetch(`${server.base}/api/v1/scan/details/not-a-real-token`);
    expect(missing.status).toBe(404);
    await server.close();
  });
});
