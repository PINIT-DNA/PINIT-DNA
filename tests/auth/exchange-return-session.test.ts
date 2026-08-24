/**
 * Exchange return must not treat leftover Hub tokens as physical-presence proof.
 * Legitimate Hub→Exchange SSO is createExchangeSso / openHubExchange (authenticated Hub app).
 */
import { maySkipBiometricsForExchangeReturn } from '../../client/src/lib/exchange-return-session';

describe('maySkipBiometricsForExchangeReturn', () => {
  it('Test 1 — normal biometric path still required (no stored session shortcut)', () => {
    const decision = maySkipBiometricsForExchangeReturn({});
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('authentication_required');
  });

  it('Test 2 — same-user Hub→Exchange uses authenticated API, not login-page skip', () => {
    // Login-page auto-SSO remains denied; openHubExchange + requireAuth is the legitimate path.
    expect(maySkipBiometricsForExchangeReturn({
      hasAccessToken: true,
      authContextUserPresent: true,
    })).toEqual({ allow: false, reason: 'stored_session_insufficient' });
  });

  it('Test 3 — shared browser: leftover A JWT must not skip biometrics for B', () => {
    expect(maySkipBiometricsForExchangeReturn({
      hasAccessToken: true,
      authContextUserPresent: true,
    }).allow).toBe(false);
  });

  it('Test 4 — expired JWT → authentication required', () => {
    expect(maySkipBiometricsForExchangeReturn({
      hasAccessToken: true,
      accessTokenExpired: true,
    })).toEqual({ allow: false, reason: 'expired' });
  });

  it('Test 5 — revoked JWT → authentication required', () => {
    expect(maySkipBiometricsForExchangeReturn({
      hasAccessToken: true,
      accessTokenRevoked: true,
    })).toEqual({ allow: false, reason: 'revoked' });
  });

  it('Test 6 — refresh token only must not authenticate an unknown physical user', () => {
    expect(maySkipBiometricsForExchangeReturn({
      hasRefreshTokenOnly: true,
    })).toEqual({ allow: false, reason: 'refresh_only' });
  });

  it('Test 7 — after logout, Exchange return must not restore A', () => {
    expect(maySkipBiometricsForExchangeReturn({
      loggedOut: true,
      hasAccessToken: false,
    })).toEqual({ allow: false, reason: 'logged_out' });
  });
});
