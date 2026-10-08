import { issueGovernmentIdSeal, readGovernmentIdSeal } from '../../src/services/profile/government-id-seal';
import {
  effectiveFaceBinding,
  publicGovernmentIdLabel,
  sniffGovernmentDocument,
  FACE_BINDING_FRESH_MS,
} from '../../src/services/profile/government-id-status';

describe('government id seal', () => {
  it('accepts a fresh seal for the same account', () => {
    const token = issueGovernmentIdSeal('user-1', 'bio-1', 1_000);
    const seal = readGovernmentIdSeal(token, 1_000 + 1000);
    expect(seal).toEqual({
      userId: 'user-1',
      biometricIdentityId: 'bio-1',
      purpose: 'government_id_seal',
      exp: 1_000 + 10 * 60 * 1000,
    });
  });

  it('rejects a tampered or expired seal', () => {
    const token = issueGovernmentIdSeal('user-1', 'bio-1', 1_000);
    expect(readGovernmentIdSeal(`${token}x`, 1_000)).toBeNull();
    expect(readGovernmentIdSeal(token, 1_000 + 11 * 60 * 1000)).toBeNull();
  });
});

describe('government id status', () => {
  const now = 10_000_000;

  it('keeps a fresh match and asks for a recheck after it ages', () => {
    expect(effectiveFaceBinding({
      stored: 'MATCHED',
      checkedAt: new Date(now - 60_000),
      now,
    })).toBe('MATCHED');
    expect(effectiveFaceBinding({
      stored: 'MATCHED',
      checkedAt: new Date(now - FACE_BINDING_FRESH_MS - 1),
      now,
    })).toBe('REQUIRES_RECHECK');
  });

  it('does not treat a failed face check as a document decision', () => {
    expect(effectiveFaceBinding({
      stored: 'NOT_MATCHED',
      checkedAt: new Date(now - 1000),
      now,
    })).toBe('NOT_MATCHED');
    expect(publicGovernmentIdLabel(true)).toBe('Government ID on file');
    expect(publicGovernmentIdLabel(false)).toBeNull();
  });

  it('accepts a jpeg and rejects a mislabeled file', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffGovernmentDocument('image/jpeg', jpeg)).toBe('image/jpeg');
    expect(sniffGovernmentDocument('application/pdf', jpeg)).toBeNull();
  });
});
