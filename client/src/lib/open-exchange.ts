import { createExchangeSso } from '../services/dashboard.api';

/** Open Exchange with Hub SSO. Reuses the Exchange tab when possible. */
export async function openHubExchange(): Promise<{ exchangeUrl: string; pinitId: string }> {
  const result = await createExchangeSso();
  window.open(result.exchangeUrl, 'pinit-exchange', 'noopener,noreferrer');
  return { exchangeUrl: result.exchangeUrl, pinitId: result.pinitId };
}
