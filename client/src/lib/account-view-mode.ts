import type { AccountType } from './account-type';

/** Last view for this browser tab/session only — survives refresh, not logout or a new login. */
const SESSION_PREFIX = 'pinit_account_view_session:';
/** Legacy key — must not drive login landing. */
const LEGACY_PREFIX = 'pinit_account_view:';

export type AccountViewMode = AccountType;

function sessionKey(userId: string): string {
  return `${SESSION_PREFIX}${userId}`;
}

function legacyKey(userId: string): string {
  return `${LEGACY_PREFIX}${userId}`;
}

/**
 * Login / new-session default:
 * Personal if it exists; Business only when there is no Personal workspace.
 * Last-used workspace and JWT accountType must not override this.
 */
export function resolveLoginWorkspaceMode(opts: {
  hasPersonalWorkspace: boolean;
  hasBusinessWorkspace: boolean;
}): AccountViewMode {
  if (opts.hasPersonalWorkspace) return 'INDIVIDUAL';
  if (opts.hasBusinessWorkspace) return 'BUSINESS';
  return 'INDIVIDUAL';
}

export function peekSessionAccountViewMode(userId: string | null | undefined): AccountViewMode | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(sessionKey(userId));
    if (raw === 'INDIVIDUAL' || raw === 'BUSINESS') return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function getAccountViewMode(
  userId: string | null | undefined,
  accountType: AccountType | null | undefined,
  workspaces?: { hasPersonalWorkspace?: boolean; hasBusinessWorkspace?: boolean },
): AccountViewMode {
  const session = peekSessionAccountViewMode(userId);
  if (session) return session;

  const hasPersonalWorkspace = workspaces?.hasPersonalWorkspace ?? true;
  const hasBusinessWorkspace =
    workspaces?.hasBusinessWorkspace ?? accountType === 'BUSINESS';
  return resolveLoginWorkspaceMode({ hasPersonalWorkspace, hasBusinessWorkspace });
}

export function setAccountViewMode(userId: string, mode: AccountViewMode): void {
  try {
    sessionStorage.setItem(sessionKey(userId), mode);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(legacyKey(userId));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pinit-account-view', { detail: { userId, mode } }));
  }
}

/** Call after a successful login so yesterday's Business view cannot restore. */
export function applyLoginWorkspaceDefault(
  userId: string,
  workspaces: { hasPersonalWorkspace: boolean; hasBusinessWorkspace: boolean },
): AccountViewMode {
  const mode = resolveLoginWorkspaceMode(workspaces);
  setAccountViewMode(userId, mode);
  return mode;
}

export function clearAccountViewSession(userId?: string | null): void {
  try {
    if (userId) {
      sessionStorage.removeItem(sessionKey(userId));
      localStorage.removeItem(legacyKey(userId));
    }
    const sessionKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_PREFIX)) sessionKeys.push(k);
    }
    for (const k of sessionKeys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
