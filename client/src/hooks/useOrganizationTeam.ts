import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';

export interface TeamMember {
  id: string;
  userId: string;
  shortId: string;
  fullName: string;
  email: string | null;
  role: string;
  department: { id: string; name: string } | null;
  joinedAt: string;
}

export interface TeamInvite {
  id: string;
  email: string | null;
  inviteeShortId: string | null;
  role: string;
  status: string;
  token?: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedTeamInvite {
  id: string;
  token: string;
  expiresAt: string;
  role: string;
}

export function useOrganizationTeam() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamRes, invitesRes] = await Promise.all([
        api.get<{ members?: TeamMember[]; pendingInvites?: number }>(`${API_BASE_URL}/organization/team`),
        api.get<{ invites?: TeamInvite[] }>(`${API_BASE_URL}/organization/team/invites`),
      ]);
      setMembers(teamRes.data.members ?? []);
      setPendingInvites(teamRes.data.pendingInvites ?? 0);
      setInvites(invitesRes.data.invites ?? []);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error as string | undefined;
      setError(msg ?? 'Could not load team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite(payload: { email?: string; inviteeShortId?: string; role?: string }): Promise<CreatedTeamInvite> {
    const { data } = await api.post<{ invite?: CreatedTeamInvite }>(`${API_BASE_URL}/organization/team/invite`, payload);
    await refresh();
    if (!data.invite?.token) {
      throw new Error('Invite created but link was missing');
    }
    return data.invite;
  }

  async function revokeInvite(inviteId: string) {
    await api.delete(`${API_BASE_URL}/organization/team/invites/${inviteId}`);
    await refresh();
  }

  async function updateRole(memberId: string, role: string) {
    await api.patch(`${API_BASE_URL}/organization/team/members/${memberId}/role`, { role });
    await refresh();
  }

  async function removeMember(memberId: string) {
    await api.delete(`${API_BASE_URL}/organization/team/members/${memberId}`);
    await refresh();
  }

  return {
    members,
    invites,
    pendingInvites,
    loading,
    error,
    refresh,
    invite,
    revokeInvite,
    updateRole,
    removeMember,
  };
}
