/**
 * PINIT-DNA — Tenant Isolation Security Tests
 *
 * Server-side ownership: JWT sub is the only authorization source.
 */

import {
  assertRecordOwner,
  getAuthUserId,
  dnaOwnerWhere,
  vaultOwnerWhere,
  shareLinkOwnerWhere,
  monitorOwnerWhere,
  certificateOwnerWhere,
  assetOwnerWhere,
  stripClientOwnerIdentity,
  filterByOwnedDna,
  isPrivilegedAdminRole,
} from '../src/lib/tenant-scope';
import { AppError } from '../src/api/middleware/error.middleware';
import type { Request } from 'express';

function mockReq(sub?: string, extra?: Partial<Request> & { user?: { sub?: string; role?: string } }): Request {
  return { user: sub ? { sub, ...extra?.user } : extra?.user, ...extra } as unknown as Request;
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
    expect(assetOwnerWhere(uid)).toEqual({ ownerUserId: uid });
  });
});

describe('client-supplied owner identity is ignored', () => {
  it('strips userId / ownerId / tenantId from body and query for normal users', () => {
    const req = mockReq('user-a', {
      body: { userId: 'user-b', ownerId: 'user-b', asset: 'file' },
      query: { ownerUserId: 'user-b', tenantId: 'org-b' },
      params: { id: 'asset-a', userId: 'user-b' },
    } as unknown as Partial<Request>);
    stripClientOwnerIdentity(req);
    expect(req.body.userId).toBeUndefined();
    expect(req.body.ownerId).toBeUndefined();
    expect(req.body.asset).toBe('file');
    expect((req.query as Record<string, unknown>).ownerUserId).toBeUndefined();
    expect((req.query as Record<string, unknown>).tenantId).toBeUndefined();
    expect(req.params.userId).toBeUndefined();
    expect(req.params.id).toBe('asset-a');
  });

  it('does not strip owner fields for ADMIN / SUPER_ADMIN', () => {
    const req = mockReq('admin-1', {
      user: { sub: 'admin-1', role: 'ADMIN' },
      body: { userId: 'user-b' },
    } as unknown as Partial<Request>);
    stripClientOwnerIdentity(req);
    expect(req.body.userId).toBe('user-b');
    expect(isPrivilegedAdminRole('SUPER_ADMIN')).toBe(true);
    expect(isPrivilegedAdminRole('USER')).toBe(false);
  });
});

describe('User A vs User B isolation (logic)', () => {
  const userA = 'user-a';
  const userB = 'user-b';
  const assetA = { id: 'asset-a', ownerUserId: userA, dnaRecordId: 'dna-a' };
  const assetB = { id: 'asset-b', ownerUserId: userB, dnaRecordId: 'dna-b' };
  const allAssets = [assetA, assetB];

  it('A creates/sees only A assets — list is WHERE ownerUserId = A', () => {
    const visibleToA = allAssets.filter((r) => r.ownerUserId === dnaOwnerWhere(userA).ownerUserId);
    expect(visibleToA).toEqual([assetA]);
  });

  it('B cannot see A assets in list or search', () => {
    const visibleToB = allAssets.filter((r) => r.ownerUserId === dnaOwnerWhere(userB).ownerUserId);
    expect(visibleToB).toEqual([assetB]);
    const searchHits = filterByOwnedDna(
      [{ dnaRecordId: 'dna-a' }, { dnaRecordId: 'dna-b' }, { dnaRecordId: 'dna-a' }],
      new Set(['dna-b']),
    );
    expect(searchHits).toEqual([{ dnaRecordId: 'dna-b' }]);
  });

  it('B cannot load A asset by ID (id + owner composite — no row)', () => {
    const requestedId = assetA.id;
    const match = allAssets.find((r) => r.id === requestedId && r.ownerUserId === userB);
    expect(match).toBeUndefined();
  });

  it('A session + B asset ID is denied', () => {
    expect(() => assertRecordOwner(assetA.ownerUserId, userB, 'Asset')).toThrow(AppError);
    const download = allAssets.find((r) => r.id === assetA.id && r.ownerUserId === userB);
    expect(download).toBeUndefined();
  });

  it('A session + userId=B in body is ignored — JWT sub remains A', () => {
    const req = mockReq(userA, { body: { userId: userB, ownerId: userB } } as unknown as Partial<Request>);
    stripClientOwnerIdentity(req);
    expect(getAuthUserId(req)).toBe(userA);
    expect(req.body.userId).toBeUndefined();
    expect(req.body.ownerId).toBeUndefined();
  });

  it('A session + ownerId=B in query does not return B data', () => {
    const req = mockReq(userA, { query: { ownerId: userB, userId: userB } } as unknown as Partial<Request>);
    stripClientOwnerIdentity(req);
    const owner = getAuthUserId(req);
    const listed = allAssets.filter((r) => r.ownerUserId === owner);
    expect(listed.every((r) => r.ownerUserId === userA)).toBe(true);
    expect(listed.some((r) => r.ownerUserId === userB)).toBe(false);
  });

  it('null ownerUserId is not shared legacy data — denied to everyone', () => {
    expect(() => assertRecordOwner(null, 'user-a', 'Legacy record')).toThrow(AppError);
    expect(() => assertRecordOwner(null, 'user-b', 'Legacy record')).toThrow(AppError);
  });
});

describe('single-resource lookup pattern', () => {
  it('finds by id AND ownerUserId — missing or foreign id is the same empty result', () => {
    const rows = [
      { id: 'v1', ownerUserId: 'user-a' },
      { id: 'v2', ownerUserId: 'user-b' },
    ];
    const getOwned = (id: string, userId: string) =>
      rows.find((r) => r.id === id && r.ownerUserId === userId) ?? null;

    expect(getOwned('v1', 'user-a')).toEqual(rows[0]);
    expect(getOwned('v1', 'user-b')).toBeNull();
    expect(getOwned('missing', 'user-a')).toBeNull();
  });
});
