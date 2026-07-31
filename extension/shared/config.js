/**
 * PinIT extension shared config defaults.
 */
import { defaultPlatformFlags } from './platforms.js';

export const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://pinit-dna-uf5y.onrender.com/api/v1',
  hubBaseUrl: 'https://www.pinithub.com',
  publishGuardianEnabled: true,
  platforms: defaultPlatformFlags(true),
};

/** Old personal-backend host — migrate stored options to live Hub API. */
const LEGACY_API_HOSTS = [
  'pinit-dna-backend.onrender.com',
];

function migrateConfig(raw) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(raw || {}),
    platforms: {
      ...DEFAULT_CONFIG.platforms,
      ...((raw && raw.platforms) || {}),
    },
  };
  const api = String(merged.apiBaseUrl || '');
  if (LEGACY_API_HOSTS.some((h) => api.includes(h))) {
    merged.apiBaseUrl = DEFAULT_CONFIG.apiBaseUrl;
  }
  if (!merged.hubBaseUrl || merged.hubBaseUrl.includes('dna-pinit-web.vercel.app')) {
    merged.hubBaseUrl = DEFAULT_CONFIG.hubBaseUrl;
  }
  return merged;
}

export async function getConfig() {
  const stored = await chrome.storage.local.get(['config', 'accessToken', 'refreshToken', 'user']);
  const config = migrateConfig(stored.config);
  // Persist migration so Options UI and future loads stay on the live host
  if (stored.config && stored.config.apiBaseUrl !== config.apiBaseUrl) {
    await chrome.storage.local.set({ config: { ...stored.config, apiBaseUrl: config.apiBaseUrl, hubBaseUrl: config.hubBaseUrl } });
  }
  return {
    config,
    accessToken: stored.accessToken || null,
    refreshToken: stored.refreshToken || null,
    user: stored.user || null,
  };
}

export async function setTokens(tokens) {
  await chrome.storage.local.set({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: tokens.user || null,
    lastAuthAt: Date.now(),
  });
}

export async function clearTokens() {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'user', 'lastAuthAt']);
}
