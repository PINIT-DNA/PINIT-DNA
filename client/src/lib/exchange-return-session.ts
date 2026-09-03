/**
 * Exchange return session policy — pure rules, no localStorage.
 *
 * A live Hub session (valid access JWT, not expired/revoked/logged out) may
 * mint Exchange SSO without repeating Face/PAD. Refresh-only is not enough.
 */

export function maySkipBiometricsForExchangeReturn(params: {
  hasAccessToken?: boolean;
  accessTokenExpired?: boolean;
  accessTokenRevoked?: boolean;
  hasRefreshTokenOnly?: boolean;
  loggedOut?: boolean;
  authContextUserPresent?: boolean;
}): { allow: boolean; reason: string } {
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
    return { allow: true, reason: 'hub_session' };
  }
  return { allow: false, reason: 'authentication_required' };
}
