/**
 * PINIT-DNA — Tenant Isolation Security Tests
 *
 * Unit tests for tenant-scope helpers and isolation query patterns.
 * Full User A / User B integration tests require a test database + JWT fixtures.
 */

import {
  assertRecordOwner,
  getAuthUserId,
  dnaOwnerWhere,
  vaultOwnerWhere,
  shareLinkOwnerWhere,
  monitorOwnerWhere,
  certificateOwnerWhere,
} from '../src/lib/tenant-scope';
import { AppError } from '../src/api/middleware/error.middleware';
import type { Request } from 'express';

function mockReq(sub?: string): Request {
  return { user: sub ? { sub } : undefined } as unknown as Request;
}

describe('tenant-scope helpers', () => {
  it('denies access when ownerUserId is null or undefined', () => {
    expect(() => assertRecordOwner(null, 'user-a', 'Vault')).toThrow(AppError);
    expect(() => assertRecordOwner(undefined, 'user-a', 'Vault')).toThrow(AppError);
  });

  it('denies cross-tenant access', () => {
    expect(() => assertRecordOwner('user-a', 'user-b', 'DNA record')).toThrow(AppError);
    try {
      assertRecordOwner('user-a', 'user-b', 'DNA record');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(403);
    }
  });

  it('allows matching owner', () => {
    expect(() => assertRecordOwner('user-a', 'user-a', 'Vault')).not.toThrow();
  });

  it('getAuthUserId rejects missing JWT user', () => {
    expect(() => getAuthUserId(mockReq())).toThrow(AppError);
  });

  it('getAuthUserId returns JWT sub', () => {
    expect(getAuthUserId(mockReq('user-a'))).toBe('user-a');
  });

  it('owner where helpers always bind to authenticated user — never global', () => {
    const uid = 'tenant-user-42';
    expect(dnaOwnerWhere(uid)).toEqual({ ownerUserId: uid });
    expect(vaultOwnerWhere(uid)).toEqual({ dnaRecord: { ownerUserId: uid } });
    expect(shareLinkOwnerWhere(uid)).toEqual({ ownerUserId: uid });
    expect(monitorOwnerWhere(uid)).toEqual({ ownerUserId: uid });
    expect(certificateOwnerWhere(uid)).toEqual({ ownerUserId: uid });
  });
});

describe('tenant isolation scenario (logic)', () => {
  /**
   * Simulates the User A / User B scenario from the security spec:
   * list filters must never return undefined (global) scope.
   */
  it('User A vault filter excludes User B records', () => {
    const userA = 'user-a';
    const userB = 'user-b';
    const allRecords = [
      { id: '1', ownerUserId: userA },
      { id: '2', ownerUserId: userA },
      { id: '3', ownerUserId: userB },
    ];
    const filterA = dnaOwnerWhere(userA);
    const visibleToA = allRecords.filter((r) => r.ownerUserId === filterA.ownerUserId);
    expect(visibleToA).toHaveLength(2);
    expect(visibleToA.every((r) => r.ownerUserId === userA)).toBe(true);
  });

  it('User B cannot pass ownership check on User A resource', () => {
    const userA = 'user-a';
    const userB = 'user-b';
    expect(() => assertRecordOwner(userA, userB, 'Vault file')).toThrow(AppError);
  });

  it('null ownerUserId is not shared legacy data — denied to everyone', () => {
    expect(() => assertRecordOwner(null, 'user-a', 'Legacy record')).toThrow(AppError);
    expect(() => assertRecordOwner(null, 'user-b', 'Legacy record')).toThrow(AppError);
  });
});
