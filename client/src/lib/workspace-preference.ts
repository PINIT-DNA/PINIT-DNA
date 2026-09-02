const STORAGE_PREFIX = 'pinit_active_workspace:';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function getActiveWorkspaceId(userId: string | null | undefined): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function setActiveWorkspaceId(userId: string, workspaceId: string | null): void {
  try {
    if (workspaceId) localStorage.setItem(storageKey(userId), workspaceId);
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pinit-active-workspace', { detail: { userId, workspaceId } }),
    );
  }
}
