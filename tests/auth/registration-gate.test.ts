import { REGISTRATION_CLOSED_MESSAGE, registrationIsOpen } from '../../src/services/auth/registration-gate';

describe('registration gate', () => {
  it('keeps new accounts open until registration is closed again', () => {
    expect(registrationIsOpen()).toBe(true);
    expect(REGISTRATION_CLOSED_MESSAGE).toMatch(/New registrations are closed/);
    expect(REGISTRATION_CLOSED_MESSAGE).toMatch(/Sign in/);
  });
});
