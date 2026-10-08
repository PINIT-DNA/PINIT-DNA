import { issueEnrollmentClaim, readEnrollmentClaim } from '../../src/services/auth/enrollment-claim';

describe('enrollment claim', () => {
  it('reserves a Pinit ID and rejects a tampered token', () => {
    const token = issueEnrollmentClaim('PINIT-AB12CD34');
    expect(readEnrollmentClaim(token)?.shortId).toBe('PINIT-AB12CD34');
    expect(readEnrollmentClaim(`${token}x`)).toBeNull();
  });

  it('rejects an expired claim', () => {
    const token = issueEnrollmentClaim('PINIT-AB12CD34', Date.now() - 60 * 60 * 1000);
    expect(readEnrollmentClaim(token)).toBeNull();
  });
});
