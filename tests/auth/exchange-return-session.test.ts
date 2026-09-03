/**
 * Exchange return: a live Hub session may mint SSO without repeating biometrics.
 * Expired / revoked / logged-out / refresh-only still require Face/PAD.
 */
import { maySkipBiometricsForExchangeReturn } from '../../client/src/lib/exchange-return-session';

describe('maySkipBiometricsForExchangeReturn', () => {
  it('Test 1 — no stored session still requires authentication', () => {
    const decision = maySkipBiometricsForExchangeReturn({});
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('authentication_required');
  });

  it('Test 2 — authenticated Hub session may skip a second login on Exchange return', () => {
    expect(maySkipBiometricsForExchangeReturn({
      hasAccessToken: true,
      authContextUserPresent: true,
    })).toEqual({ allow: true, reason: 'hub_session' });
  });

  it('Test 3 — leftover valid Hub JWT is treated as the same Pinit identity', () => {
    expect(maySkipBiometricsForExchangeReturn({
      hasAccessToken: true,
      authContextUserPresent: true,
    }).allow).toBe(true);
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
