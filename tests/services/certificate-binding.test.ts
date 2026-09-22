/**
 * What an issued Pinit certificate is bound to, and what it claims.
 *
 * The rules this pins down:
 *  A. A new certificate is signed over the asset AND the SHA-256 of its bytes, so
 *     pointing it at a different asset, or altering the file, fails verification.
 *  B. Certificates issued before that binding keep verifying under the old payload,
 *     and are reported as LEGACY rather than silently presented as sealed. Their
 *     signed string is never rewritten.
 *  C. The public view carries the asset reference, the integrity record and the
 *     evidence notice — and still none of the internals.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'crypto';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const dnaFindUnique = jest.fn<AnyAsync>();
const vaultFindFirst = jest.fn<AnyAsync>();
const certFindFirst = jest.fn<AnyAsync>();
const certFindUnique = jest.fn<AnyAsync>();
const certCreate = jest.fn<AnyAsync>();
const certUpdate = jest.fn<AnyAsync>();
const assetFindFirst = jest.fn<AnyAsync>();
const assetFindUnique = jest.fn<AnyAsync>();
const assetUpdate = jest.fn<AnyAsync>();
const userFindUnique = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findUnique: dnaFindUnique },
    vaultRecord: { findFirst: vaultFindFirst },
    certificate: { findFirst: certFindFirst, findUnique: certFindUnique, create: certCreate, update: certUpdate },
    asset: { findFirst: assetFindFirst, findUnique: assetFindUnique, update: assetUpdate },
    user: { findUnique: userFindUnique },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  certificateService,
  publicAssetRecord,
  CERTIFICATE_EVIDENCE_NOTICE,
} from '../../src/services/certificates/certificate.service';
import { config } from '../../src/config';

const OWNER = 'owner-user';
const DNA = 'dna-1';
const VAULT = 'vault-1';
const ASSET = 'asset-1111-2222-3333';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const ISSUED_AT = new Date('2026-09-16T10:24:38.123Z');

const sign = (payload: string): string =>
  crypto.createHmac('sha256', `CERT_SIGN::${config.vault.masterSecret}`).update(payload).digest('hex');

// issue() stamps its own issuedAt, so the payload helpers take the one that was
// actually signed rather than assuming the fixture's.
const v1Payload = (certId: string, issuedAt: Date = ISSUED_AT) =>
  `PINIT-DNA-CERT|${certId}|${DNA}|${VAULT}|${issuedAt.toISOString()}`;

const v2Payload = (certId: string, assetId = ASSET, contentHash = HASH, issuedAt: Date = ISSUED_AT) =>
  ['PINIT-CERT-V2', certId, DNA, VAULT, assetId, contentHash, issuedAt.toISOString()].join('|');

function certRow(overrides: Record<string, unknown> = {}) {
  return {
    certificateId: 'CERT-DNA-TEST',
    dnaRecordId: DNA,
    vaultId: VAULT,
    assetId: ASSET,
    status: 'ACTIVE',
    signature: sign(v2Payload('CERT-DNA-TEST')),
    issuedAt: ISSUED_AT,
    expiresAt: null,
    revokedAt: null,
    revocationReason: null,
    issuedByUserId: OWNER,
    ownerUserId: OWNER,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // One mock serves both reads of the DNA row: the ownership check on issue and
  // the subject lookup on public verification.
  dnaFindUnique.mockResolvedValue({
    ownerUserId: OWNER,
    imageFilename: 'Ocean.jpg',
    fileType: 'IMAGE',
    imageMimeType: 'image/jpeg',
  });
  vaultFindFirst.mockResolvedValue({ id: VAULT });
  certFindFirst.mockResolvedValue(null);
  assetFindFirst.mockResolvedValue({ id: ASSET, contentHash: HASH });
  assetFindUnique.mockResolvedValue({ id: ASSET, contentHash: HASH });
  assetUpdate.mockResolvedValue({});
  certUpdate.mockResolvedValue({});
  userFindUnique.mockResolvedValue({ shortId: 'PINIT-TEST', fullName: 'Test Holder' });
  certCreate.mockImplementation(async (args) => (args as { data: Record<string, unknown> }).data);
});

describe('A. a new certificate is bound to the exact file', () => {
  test('the signature covers the asset id and the SHA-256 of its bytes', async () => {
    await certificateService.issue({ dnaRecordId: DNA, vaultId: VAULT, ownerUserId: OWNER });

    const created = certCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    const { certificateId, signature, assetId, issuedAt } = created.data as {
      certificateId: string; signature: string; assetId: string | null; issuedAt: Date;
    };

    expect(assetId).toBe(ASSET);
    expect(signature).toBe(sign(v2Payload(certificateId, ASSET, HASH, issuedAt)));
    // and NOT the payload that leaves the file unbound
    expect(signature).not.toBe(sign(v1Payload(certificateId, issuedAt)));
  });

  test('a certificate pointed at a different asset stops verifying', async () => {
    certFindUnique.mockResolvedValue(certRow());
    assetFindUnique.mockResolvedValue({ id: 'some-other-asset', contentHash: HASH });

    const outcome = await certificateService.verify('CERT-DNA-TEST');

    expect(outcome.valid).toBe(false);
    expect(outcome.signatureValid).toBe(false);
  });

  test('altering the certified file stops verifying', async () => {
    certFindUnique.mockResolvedValue(certRow());
    assetFindUnique.mockResolvedValue({ id: ASSET, contentHash: OTHER_HASH });

    const outcome = await certificateService.verify('CERT-DNA-TEST');

    expect(outcome.valid).toBe(false);
    expect(outcome.signatureValid).toBe(false);
  });

  test('the unaltered asset verifies and reports the binding as sealed', async () => {
    certFindUnique.mockResolvedValue(certRow());

    const outcome = await certificateService.verify('CERT-DNA-TEST');

    expect(outcome.valid).toBe(true);
    expect(outcome.assetBinding).toBe('SEALED');
    expect(outcome.contentHash).toBe(HASH);
  });

  test('a vault with no asset row still issues, under the older payload', async () => {
    assetFindFirst.mockResolvedValue(null);

    await certificateService.issue({ dnaRecordId: DNA, vaultId: VAULT, ownerUserId: OWNER });

    const created = certCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    const { certificateId, signature, assetId, issuedAt } = created.data as {
      certificateId: string; signature: string; assetId: string | null; issuedAt: Date;
    };
    expect(assetId).toBeNull();
    expect(signature).toBe(sign(v1Payload(certificateId, issuedAt)));
  });
});

describe('B. certificates issued before the binding keep working', () => {
  test('a v1 certificate still verifies, and says it is not file-bound', async () => {
    certFindUnique.mockResolvedValue(certRow({
      assetId: null,
      signature: sign(v1Payload('CERT-DNA-TEST')),
    }));

    const outcome = await certificateService.verify('CERT-DNA-TEST');

    expect(outcome.valid).toBe(true);
    expect(outcome.assetBinding).toBe('LEGACY');
    expect(outcome.contentHash).toBeNull();
  });

  test('a v1 certificate linked to an asset afterwards still verifies', async () => {
    // linkToAsset writes assetId after issuance for older certificates; that must
    // not invalidate a signature made before the asset was known.
    certFindUnique.mockResolvedValue(certRow({
      signature: sign(v1Payload('CERT-DNA-TEST')),
    }));

    const outcome = await certificateService.verify('CERT-DNA-TEST');

    expect(outcome.valid).toBe(true);
    expect(outcome.assetBinding).toBe('LEGACY');
  });

  test('the v1 signed string is exactly what it always was', () => {
    // Pinned deliberately: change this string and every certificate ever issued
    // stops verifying.
    expect(v1Payload('CERT-DNA-TEST'))
      .toBe('PINIT-DNA-CERT|CERT-DNA-TEST|dna-1|vault-1|2026-09-16T10:24:38.123Z');
  });
});

describe('C. what the public verification says', () => {
  test('carries the asset reference, the integrity record and the notice', async () => {
    certFindUnique.mockResolvedValue(certRow());

    const view = await certificateService.verifyPublic('CERT-DNA-TEST');

    expect(view.assetRecord).toBe('PH-ASSET-ASSET111');
    expect(view.contentHash).toBe(HASH);
    expect(view.assetBinding).toBe('SEALED');
    expect(view.notice).toBe(CERTIFICATE_EVIDENCE_NOTICE);
    expect(view.notice).toMatch(/not a government-issued copyright registration/i);
  });

  test('still never exposes the DNA id, the vault id or the signature', async () => {
    certFindUnique.mockResolvedValue(certRow());

    const view = await certificateService.verifyPublic('CERT-DNA-TEST');

    const blob = JSON.stringify(view);
    expect(blob).not.toContain(DNA);
    expect(blob).not.toContain(VAULT);
    expect(blob).not.toContain(certRow().signature);
  });

  test('a revoked certificate never reads as verified', async () => {
    certFindUnique.mockResolvedValue(certRow({
      status: 'REVOKED',
      revokedAt: new Date('2026-09-17T09:00:00Z'),
      revocationReason: 'superseded',
    }));

    const view = await certificateService.verifyPublic('CERT-DNA-TEST');

    expect(view.valid).toBe(false);
    expect(view.status).toBe('REVOKED');
    expect(view.signatureValid).toBe(false);
  });

  test('the asset reference is short and never the raw Asset.id', () => {
    expect(publicAssetRecord(ASSET)).toBe('PH-ASSET-ASSET111');
    expect(publicAssetRecord(ASSET)).not.toContain(ASSET);
    expect(publicAssetRecord(null)).toBeNull();
  });
});
