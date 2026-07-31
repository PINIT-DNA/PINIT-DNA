/**
 * Platform owner — only these PinIT IDs see / open Admin Console.
 * Others (even SUPER_ADMIN role) are blocked from the console UI/route.
 *
 * Override via VITE_PLATFORM_OWNER_SHORT_IDS=PINIT-xxx,PINIT-yyy (comma-separated).
 */
const DEFAULT_OWNER_SHORT_IDS = ['PINIT-324BMMSL'] as const;

function parseOwnerIds(): string[] {
  const fromEnv = (import.meta.env.VITE_PLATFORM_OWNER_SHORT_IDS as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return [...DEFAULT_OWNER_SHORT_IDS];
}

const OWNER_IDS = new Set(parseOwnerIds().map((s) => s.toUpperCase()));

export function isPlatformOwnerShortId(shortId: string | null | undefined): boolean {
  if (!shortId) return false;
  return OWNER_IDS.has(shortId.trim().toUpperCase());
}
