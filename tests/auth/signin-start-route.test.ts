import { loginNeedsPasskeyFactor, resolveSignInEntryStep } from '../../client/src/lib/signin-preference';

describe('sign-in start routing', () => {
  it('Face Scan without a remembered Pinit ID opens the camera', () => {
    expect(resolveSignInEntryStep('face', '')).toBe('face');
  });

  it('Face Scan with a remembered Pinit ID opens the camera', () => {
    expect(resolveSignInEntryStep('face', 'PINIT-AB12CD')).toBe('face');
  });

  it('a saved Pinit ID preference still opens the camera', () => {
    expect(resolveSignInEntryStep('pinit_id', '')).toBe('face');
    expect(resolveSignInEntryStep('pinit_id', 'PINIT-AB12CD')).toBe('face');
  });
});

describe('passkey is not implied by Face Scan errors', () => {
  it('detects a server request for passkey after face succeeded', () => {
    expect(loginNeedsPasskeyFactor('Verify this device with the passkey registered to this Pinit account.')).toBe(true);
    expect(loginNeedsPasskeyFactor("Couldn't verify you. Please try again.")).toBe(false);
  });
});
