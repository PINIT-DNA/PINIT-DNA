import { createAdminBridgeSso } from '../services/dashboard.api';

/**
 * Open PinitHUB Master Admin — a fully separate app (own origin/port, mirrors
 * openHubExchange). Requires a live authenticated Hub API session; the admin
 * app itself decides whether this account's role grants any capability.
 */
export async function openMasterAdmin(): Promise<{ adminUrl: string }> {
  const result = await createAdminBridgeSso();
  window.open(result.adminUrl, 'pinit-master-admin', 'noopener,noreferrer');
  return { adminUrl: result.adminUrl };
}
