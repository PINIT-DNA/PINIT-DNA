/**
 * Phase 3 — identity token + watermark status tests
 */

describe('Phase 3 identity token', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.DNA_PHASE3_ENABLED = 'true';
    process.env.DNA_P3_PROTECTED_DOWNLOAD_TOKEN = 'true';
  });

  it('issues and verifies a round-trip token', () => {
    const { issueIdentityToken, verifyIdentityToken } = require('../../src/services/evidence/identity-token.service');
    const token = issueIdentityToken({
      vaultId: 'vault-1',
      dnaRecordId: 'dna-1',
      certificateId: 'cert-1',
      ownerUserId: 'user-1',
    });
    expect(token).not.toBeNull();
    const result = verifyIdentityToken(token!);
    expect(result.valid).toBe(true);
    expect(result.inner?.vaultId).toBe('vault-1');
  });
});

describe('Phase 3 watermark proof', () => {
  it('returns NOT_EMBEDDED when embedding disabled', () => {
    const { resolveWatermarkProof } = require('../../src/services/forensics/watermark-status.service');
    process.env.INVISIBLE_WATERMARK_EMBEDDING_ENABLED = 'false';
    const proof = resolveWatermarkProof(
      { found: false, message: 'none' },
      {},
    );
    expect(proof.status).toBe('NOT_EMBEDDED');
  });

  it('returns DETECTED when watermark code present', () => {
    const { resolveWatermarkProof } = require('../../src/services/forensics/watermark-status.service');
    const proof = resolveWatermarkProof(
      { found: true, message: 'ok', watermark: { code: 'WM-ABCD-EFGH' } },
      { vaultId: 'v1', ownerPinitId: 'PINIT-1' },
    );
    expect(proof.status).toBe('DETECTED');
    expect(proof.code).toBe('WM-ABCD-EFGH');
  });
});
