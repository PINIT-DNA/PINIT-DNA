/**
 * PINIT-DNA — Duplicate File Prevention Tests
 *
 * Test A: Same user uploads same file twice       → ALLOW (same account)
 * Test B: Different user uploads same file        → BLOCK + HIGH_RISK
 * Test C: Same user, same file renamed            → ALLOW (same account)
 * Test D: Different file                          → ALLOW
 *
 * Run: npx jest duplicate-check.test --no-coverage
 */

import crypto from 'crypto';
import { describe, test, beforeEach, expect, jest } from '@jest/globals';
import { duplicateCheckService } from '../src/services/duplicate/duplicate-check.service';
import { prisma } from '../src/lib/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_A = 'user-a-uuid-001';
const USER_B = 'user-b-uuid-002';

/** Create a minimal fake Express request with optional authenticated user */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeReq(ip = '127.0.0.1', userId?: string): any {
  return {
    headers: { 'x-forwarded-for': ip, 'user-agent': 'jest-test/1.0' },
    ip,
    socket: { remoteAddress: ip },
    user: userId ? { sub: userId } : undefined,
  } as never;
}

/** Build a buffer with known content (deterministic sha256) */
function makeBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

// ─── Mock prisma to avoid real DB calls ───────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    cryptoLayer:     { findFirst: jest.fn() },
    perceptualLayer: { findMany:  jest.fn() },
    dnaRecord:       { findFirst: jest.fn(), findUnique: jest.fn() },
    auditEvent:      { create: jest.fn(), findFirst: jest.fn() },
    user:            { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../src/services/audit/audit.service', () => ({
  auditService: { log: jest.fn(async () => undefined) },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DuplicateCheckService', () => {

  const fileA = makeBuffer('This is the original file content — version A.');
  const fileB = makeBuffer('This is a COMPLETELY DIFFERENT file — version B!');
  const sha256A = crypto.createHash('sha256').update(fileA).digest('hex');

  const existingRecord = {
    id:            'existing-record-uuid-001',
    imageFilename: 'original-file.pdf',
    imageMimeType: 'application/pdf',
    createdAt:     new Date('2026-01-01T10:00:00Z'),
    ownerUserId:   USER_A,
    ownerUser:     { shortId: 'PINIT-A001' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.create as jest.Mock<any>).mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.findFirst as jest.Mock<any>).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.dnaRecord.findFirst as jest.Mock<any>).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.cryptoLayer.findFirst as jest.Mock<any>).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.perceptualLayer.findMany as jest.Mock<any>).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user.findUnique as jest.Mock<any>).mockResolvedValue({ shortId: 'PINIT-B002' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user.findMany as jest.Mock<any>).mockResolvedValue([]);
  });

  // ── Test A: Same user uploads same file twice ──────────────────────────────

  test('Test A — same user uploads same file twice → ALLOW (same account)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.dnaRecord.findFirst as jest.Mock<any>).mockResolvedValue(existingRecord);

    const result = await duplicateCheckService.check(
      fileA,
      'application/pdf',
      'my-file.pdf',
      fakeReq('127.0.0.1', USER_A),
    );

    expect(result.isDuplicate).toBe(false);
    expect(result.isHighRisk).toBe(false);
  });

  // ── Test B: Different user uploads same file ───────────────────────────────

  test('Test B — different user uploads same file → BLOCK + HIGH RISK', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.dnaRecord.findFirst as jest.Mock<any>).mockResolvedValue(existingRecord);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.findFirst as jest.Mock<any>).mockResolvedValue({ ipAddress: '192.168.1.1' });

    const result = await duplicateCheckService.check(
      fileA,
      'application/pdf',
      'my-file.pdf',
      fakeReq('203.0.113.55', USER_B),
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('EXACT_HASH');
    expect(result.existingRecordId).toBe(existingRecord.id);
    expect(result.isHighRisk).toBe(true);
  });

  // ── Test C: Same user, same file renamed ───────────────────────────────────

  test('Test C — same user, same file renamed → ALLOW (same account)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.dnaRecord.findFirst as jest.Mock<any>).mockResolvedValue(existingRecord);

    const result = await duplicateCheckService.check(
      fileA,
      'application/pdf',
      'totally-different-name.pdf',
      fakeReq('127.0.0.1', USER_A),
    );

    expect(result.isDuplicate).toBe(false);
    const hashOfRenamed = duplicateCheckService.computeSha256(fileA);
    expect(hashOfRenamed).toBe(sha256A);
  });

  // ── Test D: Different file ─────────────────────────────────────────────────

  test('Test D — different file → ALLOW', async () => {
    const result = await duplicateCheckService.check(
      fileB,
      'application/pdf',
      'different-file.pdf',
      fakeReq('127.0.0.1', USER_A),
    );

    expect(result.isDuplicate).toBe(false);
    expect(result.matchType).toBeUndefined();
  });

  // ── SHA-256 determinism test ───────────────────────────────────────────────

  test('SHA-256 is deterministic — same content always produces same hash', () => {
    const h1 = duplicateCheckService.computeSha256(fileA);
    const h2 = duplicateCheckService.computeSha256(fileA);
    const h3 = duplicateCheckService.computeSha256(Buffer.from(fileA));

    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h1).toHaveLength(64);
  });

  test('Different files produce different SHA-256 hashes', () => {
    const hashA = duplicateCheckService.computeSha256(fileA);
    const hashB = duplicateCheckService.computeSha256(fileB);

    expect(hashA).not.toBe(hashB);
  });

});
