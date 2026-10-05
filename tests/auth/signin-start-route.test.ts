import { loginNeedsPasskeyFactor, resolveSignInEntryStep } from '../../client/src/lib/signin-preference';

describe('sign-in start routing', () => {
  it('Face Scan without a remembered Pinit ID opens the camera', () => {
    expect(resolveSignInEntryStep('face', '')).toBe('face');
  });

  it('Face Scan with a remembered Pinit ID opens the camera', () => {
    expect(resolveSignInEntryStep('face', 'PINIT-AB12CD')).toBe('face');
  });

  it('Pinit ID preference starts at the ID screen', () => {
    expect(resolveSignInEntryStep('pinit_id', '')).toBe('claim');
    expect(resolveSignInEntryStep('pinit_id', 'PINIT-AB12CD')).toBe('claim');
  });
});

describe('passkey is not implied by Face Scan errors', () => {
  it('detects a server request for passkey after face succeeded', () => {
    expect(loginNeedsPasskeyFactor('Verify this device with the passkey registered to this Pinit account.')).toBe(true);
    expect(loginNeedsPasskeyFactor("Couldn't verify you. Please try again.")).toBe(false);
  });
});
