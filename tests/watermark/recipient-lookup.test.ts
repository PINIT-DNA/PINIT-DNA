import crypto from 'crypto';
import { watermarkLookupId, watermarkRecipientLookupId } from '../../src/services/dna-vnext/crypto';
import { openOwnershipSecret, ownershipCommitmentHash } from '../../src/services/layers/ownership-commitment';

describe('per-recipient mark id', () => {
  test('a recipient id is stable, distinct from the owner id, and distinct per recipient', () => {
    const owner = watermarkLookupId('vault-1', 'dna-1');
    const a = watermarkRecipientLookupId('vault-1', 'dna-1', 'person-a');
    const b = watermarkRecipientLookupId('vault-1', 'dna-1', 'person-b');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(owner);
    expect(a).not.toBe(b);
    expect(a).toBe(watermarkRecipientLookupId('vault-1', 'dna-1', 'person-a'));
  });
});

describe('stored ownership commitment', () => {
  test('a sealed secret opens and matches the commitment', () => {
    const ownerUserId = 'owner-1';
    const fileHash = 'a'.repeat(64);
    const secret = crypto.randomBytes(32).toString('hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      crypto.createHash('sha256').update(ownerUserId).digest(),
      iv,
    );
    const proofData = `${iv.toString('hex')}:${Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]).toString('hex')}:${cipher.getAuthTag().toString('hex')}`;

    expect(openOwnershipSecret(proofData, ownerUserId)).toBe(secret);
    expect(openOwnershipSecret(proofData, 'someone-else')).toBeNull();
    expect(ownershipCommitmentHash(secret, fileHash, ownerUserId)).toBe(
      crypto.createHash('sha256').update(`${secret}${fileHash}${ownerUserId}`).digest('hex'),
    );
  });
});
