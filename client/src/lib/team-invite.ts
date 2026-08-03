const PENDING_TEAM_INVITE_KEY = 'pinit_pending_team_invite';

export function rememberPendingTeamInvite(token: string) {
  try {
    sessionStorage.setItem(PENDING_TEAM_INVITE_KEY, token.trim());
  } catch {
    /* ignore */
  }
}

export function takePendingTeamInvite(): string | null {
  try {
    const token = sessionStorage.getItem(PENDING_TEAM_INVITE_KEY);
    if (token) sessionStorage.removeItem(PENDING_TEAM_INVITE_KEY);
    return token?.trim() || null;
  } catch {
    return null;
  }
}

export function clearPendingTeamInvite() {
  try {
    sessionStorage.removeItem(PENDING_TEAM_INVITE_KEY);
  } catch {
    /* ignore */
  }
}

export function teamInviteUrl(token: string): string {
  return `${window.location.origin}/team/join/${encodeURIComponent(token)}`;
}
