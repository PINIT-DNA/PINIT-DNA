/**
 * Exchange return session policy — pure rules, no localStorage.
 *
 * Leftover Hub JWT/refresh must never skip Face/PAD/Passkey on /login?exchange_return=.
 * Legitimate Hub→Exchange SSO is createExchangeSso while already inside Hub (openHubExchange).
 */

export function maySkipBiometricsForExchangeReturn(params: {
  hasAccessToken?: boolean;
  accessTokenExpired?: boolean;
  accessTokenRevoked?: boolean;
  hasRefreshTokenOnly?: boolean;
  loggedOut?: boolean;
  authContextUserPresent?: boolean;
}): { allow: false; reason: string } {
  if (params.loggedOut) {
    return { allow: false, reason: 'logged_out' };
  }
  if (params.accessTokenRevoked) {
    return { allow: false, reason: 'revoked' };
  }
  if (params.accessTokenExpired) {
    return { allow: false, reason: 'expired' };
  }
  if (params.hasRefreshTokenOnly) {
    return { allow: false, reason: 'refresh_only' };
  }
  if (params.hasAccessToken || params.authContextUserPresent) {
    // Stored JWT / hydrated AuthContext ≠ proof of current physical user.
    return { allow: false, reason: 'stored_session_insufficient' };
  }
  return { allow: false, reason: 'authentication_required' };
}
