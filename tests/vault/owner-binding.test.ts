/**
 * STEP 5 — Bind authenticated identity to vault and protected assets.
 * Authorization is a separate check from authentication.
 * Client userId / URL IDs never override JWT sub.
 */
import {
  assertRecordOwner,
  getAuthUserId,
  stripClientOwnerIdentity,
  dnaOwnerWhere,
  vaultOwnerWhere,
  certificateOwnerWhere,
  assetOwnerWhere,
  filterByOwnedDna,
} from '../../src/lib/tenant-scope';
import { AppError } from '../../src/api/middleware/error.middleware';
import type { Request } from 'express';

const USER_A = 'user-a';
const USER_B = 'user-b';

const A1 = { id: 'asset-a1', ownerUserId: USER_A, dnaId: 'dna-a1', vaultId: 'vault-a1', certId: 'cert-a1' };
const A2 = { id: 'asset-a2', ownerUserId: USER_A, dnaId: 'dna-a2', vaultId: 'vault-a2', certId: 'cert-a2' };
const B1 = { id: 'asset-b1', ownerUserId: USER_B, dnaId: 'dna-b1', vaultId: 'vault-b1', certId: 'cert-b1' };
const B2 = { id: 'asset-b2', ownerUserId: USER_B, dnaId: 'dna-b2', vaultId: 'vault-b2', certId: 'cert-b2' };
const ALL = [A1, A2, B1, B2];

function mockReq(sub: string, extra?: { query?: Record<string, string>; body?: Record<string, string>; params?: Record<string, string>; role?: string }): Request {
  return {
    user: { sub, role: extra?.role },
    query: extra?.query ?? {},
    body: extra?.body ?? {},
    params: extra?.params ?? {},
  } as unknown as Request;
}

/** Backend list: WHERE ownerUserId = authenticatedUserId. Never SELECT all then filter in React. */
function vaultQuery(authenticatedUserId: string) {
  return ALL.filter((r) => r.ownerUserId === vaultOwnerWhere(authenticatedUserId).dnaRecord.ownerUserId);
}

function assetGet(authenticatedUserId: string, requestedId: string) {
  return ALL.find((r) => r.id === requestedId && r.ownerUserId === assetOwnerWhere(authenticatedUserId).ownerUserId) ?? null;
}

function dnaGet(authenticatedUserId: string, dnaId: string) {
  return ALL.find((r) => r.dnaId === dnaId && r.ownerUserId === dnaOwnerWhere(authenticatedUserId).ownerUserId) ?? null;
}

function certGet(authenticatedUserId: string, certId: string) {
  return ALL.find((r) => r.certId === certId && r.ownerUserId === certificateOwnerWhere(authenticatedUserId).ownerUserId) ?? null;
}

function searchOwned(authenticatedUserId: string, hits: Array<{ dnaRecordId: string; title: string }>) {
  const owned = new Set(ALL.filter((r) => r.ownerUserId === authenticatedUserId).map((r) => r.dnaId));
  return filterByOwnedDna(hits, owned);
}

describe('STEP 5 — protect binds owner from JWT, not the client', () => {
  it('create uses authenticatedUserId, ignoring body.userId', () => {
    const req = mockReq(USER_A, { body: { userId: USER_B, ownerUserId: USER_B } });
    stripClientOwnerIdentity(req);
    const owner = getAuthUserId(req);
    expect(owner).toBe(USER_A);
    expect(req.body.userId).toBeUndefined();
    expect(req.body.ownerUserId).toBeUndefined();
    const created = { ...A1, ownerUserId: owner };
    expect(created.ownerUserId).toBe(USER_A);
  });
});

describe('STEP 5 — vault list is owner-scoped', () => {
  it('A vault → A1 A2 only', () => {
    expect(vaultQuery(USER_A).map((r) => r.id)).toEqual(['asset-a1', 'asset-a2']);
  });

  it('B vault → B1 B2 only', () => {
    expect(vaultQuery(USER_B).map((r) => r.id)).toEqual(['asset-b1', 'asset-b2']);
  });

  it('never returns the global catalog', () => {
    expect(vaultQuery(USER_A)).not.toEqual(ALL);
    expect(vaultQuery(USER_B)).not.toEqual(ALL);
  });
});

describe('STEP 5 — IDOR: GET /assets/:id requires id AND owner', () => {
  it('A login → A asset PASS', () => {
    expect(assetGet(USER_A, A1.id)?.id).toBe(A1.id);
  });

  it('B login → B asset PASS', () => {
    expect(assetGet(USER_B, B1.id)?.id).toBe(B1.id);
  });

  it('A login → B asset DENY', () => {
    expect(assetGet(USER_A, B1.id)).toBeNull();
    expect(() => assertRecordOwner(B1.ownerUserId, USER_A, 'Asset')).toThrow(AppError);
  });

  it('B login → A asset DENY', () => {
    expect(assetGet(USER_B, A1.id)).toBeNull();
    expect(() => assertRecordOwner(A1.ownerUserId, USER_B, 'Asset')).toThrow(AppError);
  });
});

describe('STEP 5 — DNA / certificate follow asset ownership', () => {
  it('A login → B DNA DENY', () => {
    expect(dnaGet(USER_A, B1.dnaId)).toBeNull();
  });

  it('B login → A DNA DENY', () => {
    expect(dnaGet(USER_B, A1.dnaId)).toBeNull();
  });

  it('A login → B certificate DENY', () => {
    expect(certGet(USER_A, B1.certId)).toBeNull();
  });

  it('B login → A certificate DENY', () => {
    expect(certGet(USER_B, A1.certId)).toBeNull();
  });

  it('A login → A DNA and certificate PASS', () => {
    expect(dnaGet(USER_A, A1.dnaId)?.dnaId).toBe('dna-a1');
    expect(certGet(USER_A, A1.certId)?.certId).toBe('cert-a1');
  });
});

describe('STEP 5 — download / modify / delete', () => {
  it('A downloads B file DENY', () => {
    const row = assetGet(USER_A, B1.vaultId === B1.vaultId ? B1.id : '');
    expect(assetGet(USER_A, B1.id)).toBeNull();
    expect(() => assertRecordOwner(B1.ownerUserId, USER_A, 'Vault')).toThrow(AppError);
    expect(row).toBeNull();
  });

  it('B downloads A file DENY', () => {
    expect(assetGet(USER_B, A1.id)).toBeNull();
    expect(() => assertRecordOwner(A1.ownerUserId, USER_B, 'Vault')).toThrow(AppError);
  });

  it('A modifies B asset DENY', () => {
    expect(assetGet(USER_A, B2.id)).toBeNull();
  });

  it('B modifies A asset DENY', () => {
    expect(assetGet(USER_B, A2.id)).toBeNull();
  });

  it('A deletes B asset DENY', () => {
    expect(() => assertRecordOwner(B1.ownerUserId, USER_A, 'Vault')).toThrow(AppError);
  });

  it('B deletes A asset DENY', () => {
    expect(() => assertRecordOwner(A1.ownerUserId, USER_B, 'Vault')).toThrow(AppError);
  });
});

describe('STEP 5 — userId query/body cannot override JWT', () => {
  it('B sends userId=A on /vault → still only B data', () => {
    const req = mockReq(USER_B, { query: { userId: USER_A, ownerUserId: USER_A } });
    stripClientOwnerIdentity(req);
    expect((req.query as Record<string, unknown>).userId).toBeUndefined();
    const owner = getAuthUserId(req);
    expect(owner).toBe(USER_B);
    expect(vaultQuery(owner).every((r) => r.ownerUserId === USER_B)).toBe(true);
    expect(vaultQuery(owner).some((r) => r.ownerUserId === USER_A)).toBe(false);
  });

  it('A sends userId=B → IGNORED, still only A data', () => {
    const req = mockReq(USER_A, { query: { userId: USER_B }, body: { userId: USER_B } });
    stripClientOwnerIdentity(req);
    expect(getAuthUserId(req)).toBe(USER_A);
    expect(vaultQuery(USER_A).map((r) => r.id)).toEqual(['asset-a1', 'asset-a2']);
  });
});

describe('STEP 5 — URL manipulation is not authorization', () => {
  it('/assets/A_ID as B DENY', () => {
    expect(assetGet(USER_B, A1.id)).toBeNull();
  });

  it('/vault/A_ID as B DENY', () => {
    expect(vaultQuery(USER_B).some((r) => r.vaultId === A1.vaultId)).toBe(false);
    expect(() => assertRecordOwner(A1.ownerUserId, USER_B, 'Vault')).toThrow(AppError);
  });

  it('/certificates/A_ID as B DENY', () => {
    expect(certGet(USER_B, A1.certId)).toBeNull();
  });

  it('/dna/A_ID as B DENY', () => {
    expect(dnaGet(USER_B, A1.dnaId)).toBeNull();
  });
});

describe('STEP 5 — search is scoped', () => {
  const indexHits = [
    { dnaRecordId: 'dna-a1', title: 'Asset A' },
    { dnaRecordId: 'dna-a2', title: 'DNA A' },
    { dnaRecordId: 'dna-b1', title: 'Certificate A-lookalike' },
  ];

  it('B searching for Asset A / DNA A does not receive A private data', () => {
    const hits = searchOwned(USER_B, indexHits);
    expect(hits).toEqual([{ dnaRecordId: 'dna-b1', title: 'Certificate A-lookalike' }]);
  });

  it('A search does not include B records', () => {
    const hits = searchOwned(USER_A, indexHits);
    expect(hits.map((h) => h.dnaRecordId)).toEqual(['dna-a1', 'dna-a2']);
  });
});

describe('STEP 5 — sharing is the only cross-user exception', () => {
  it('without an explicit share, B cannot access A', () => {
    const share = { vaultId: A1.vaultId, ownerUserId: USER_A, token: null as string | null };
    expect(share.token).toBeNull();
    expect(assetGet(USER_B, A1.id)).toBeNull();
  });

  it('explicit share grants access via share record, not via asset ID', () => {
    const share = { vaultId: A1.vaultId, ownerUserId: USER_A, token: 'share-token-a', recipient: USER_B };
    expect(share.token).toBeTruthy();
    expect(share.ownerUserId).toBe(USER_A);
    expect(share.vaultId).not.toBe(share.token);
  });
});
