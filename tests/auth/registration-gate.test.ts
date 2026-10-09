import { REGISTRATION_CLOSED_MESSAGE, registrationIsOpen } from '../../src/services/auth/registration-gate';

describe('registration gate', () => {
  it('keeps new accounts closed until registration is opened again', () => {
    expect(registrationIsOpen()).toBe(false);
    expect(REGISTRATION_CLOSED_MESSAGE).toMatch(/New registrations are closed/);
    expect(REGISTRATION_CLOSED_MESSAGE).toMatch(/Sign in/);
  });
});
