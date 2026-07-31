/**
 * Backend platform-owner allowlist (PinIT short IDs).
 * Must stay aligned with client/src/lib/platform-owner.ts defaults.
 */
const DEFAULT_OWNER_SHORT_IDS = ['PINIT-324BMMSL'];

export function getPlatformOwnerShortIds(): string[] {
  const fromEnv = process.env['PLATFORM_OWNER_SHORT_IDS']?.trim()
    || process.env['VITE_PLATFORM_OWNER_SHORT_IDS']?.trim();
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return DEFAULT_OWNER_SHORT_IDS.map((s) => s.toUpperCase());
}

export function isPlatformOwnerShortId(shortId: string | null | undefined): boolean {
  if (!shortId) return false;
  return getPlatformOwnerShortIds().includes(shortId.trim().toUpperCase());
}
