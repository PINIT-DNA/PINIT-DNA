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

export async function getConfig() {
  const stored = await chrome.storage.local.get(['config', 'accessToken', 'refreshToken', 'user']);
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...(stored.config || {}),
      platforms: {
        ...DEFAULT_CONFIG.platforms,
        ...((stored.config && stored.config.platforms) || {}),
      },
    },
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
  });
}

export async function clearTokens() {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'user']);
}
