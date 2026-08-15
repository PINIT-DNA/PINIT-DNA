import { createExchangeSso } from '../services/dashboard.api';

/**
 * Open Exchange with Hub SSO. Reuses the Exchange tab when possible.
 * Requires a live authenticated Hub API session (Authorization JWT via requireAuth).
 * Does not use login-page token presence — Exchange return always re-verifies biometrics.
 */
export async function openHubExchange(): Promise<{ exchangeUrl: string; pinitId: string }> {
  const result = await createExchangeSso();
  window.open(result.exchangeUrl, 'pinit-exchange', 'noopener,noreferrer');
  return { exchangeUrl: result.exchangeUrl, pinitId: result.pinitId };
}
