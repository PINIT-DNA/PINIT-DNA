import { useState } from 'react';
import { Users, UserPlus, Mail, Crown, Briefcase, Search, Shield, Eye, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganizationTeam } from '../../../hooks/useOrganizationTeam';
import { useSubscription } from '../../../hooks/useSubscription';
import { EnterpriseCard, EnterpriseButton } from './shared';

const ROLES = ['MANAGER', 'INVESTIGATOR', 'MEMBER', 'VIEWER'] as const;

function roleIcon(role: string) {
  if (role === 'OWNER') return Crown;
  if (role === 'MANAGER') return Briefcase;
  if (role === 'INVESTIGATOR') return Search;
  if (role === 'VIEWER') return Eye;
  return Shield;
}

export function TeamPanel() {
  const { subscription } = useSubscription();
  const { members, invites, pendingInvites, loading, invite, revokeInvite, updateRole, removeMember } =
    useOrganizationTeam();
  const [inviteeShortId, setInviteeShortId] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('MEMBER');
  const [busy, setBusy] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteeShortId.trim() && !email.trim()) {
      toast.error('Enter a PINIT ID or email');
      return;
    }
    setBusy(true);
    try {
      await invite({ inviteeShortId: inviteeShortId.trim() || undefined, email: email.trim() || undefined, role });
      toast.success('Invitation sent');
      setInviteeShortId('');
      setEmail('');
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const limit = subscription?.teamMemberLimit;
  const count = subscription?.teamMemberCount ?? members.length;

  return (
    <div className="space-y-4">
      <EnterpriseCard title="Team overview" icon={<Users size={16} />}>
        <p className="text-sm text-gray-400">
          {count}{limit != null ? ` / ${limit}` : ''} members · {pendingInvites} pending invites
        </p>
      </EnterpriseCard>

      <EnterpriseCard title="Invite member" icon={<UserPlus size={16} />}>
        <form onSubmit={(e) => void handleInvite(e)} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={inviteeShortId}
              onChange={(e) => setInviteeShortId(e.target.value)}
              placeholder="PINIT ID (e.g. PINIT-ABC123)"
              className="px-3 py-2.5 bg-bg-elevated/80 border border-bg-border rounded-xl text-sm text-white"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="px-3 py-2.5 bg-bg-elevated/80 border border-bg-border rounded-xl text-sm text-white"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="px-3 py-2.5 bg-bg-elevated/80 border border-bg-border rounded-xl text-sm text-white"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <EnterpriseButton type="submit" disabled={busy}>
            Send invitation
          </EnterpriseButton>
        </form>
      </EnterpriseCard>

      <EnterpriseCard title="Members" icon={<Users size={16} />}>
        <ul className="divide-y divide-bg-border -mx-1">
          {members.map((m) => {
            const Icon = roleIcon(m.role);
            return (
              <li key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={16} className="text-purple-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{m.fullName}</p>
                    <p className="text-2xs text-gray-500 font-mono">{m.shortId} · {m.role}</p>
                  </div>
                </div>
                {m.role !== 'OWNER' && (
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) => void updateRole(m.id, e.target.value).then(() => toast.success('Role updated'))}
                      className="text-2xs px-2 py-1 bg-bg-elevated border border-bg-border rounded-lg text-white"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeMember(m.id).then(() => toast.success('Member removed'))}
                      className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg"
                      aria-label="Remove member"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </EnterpriseCard>

      {invites.length > 0 && (
        <EnterpriseCard title="Pending invitations" icon={<Mail size={16} />}>
          <ul className="divide-y divide-bg-border -mx-1">
            {invites.map((i) => (
              <li key={i.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white">{i.inviteeShortId ?? i.email ?? 'Invite'}</p>
                  <p className="text-2xs text-gray-500">{i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void revokeInvite(i.id).then(() => toast.success('Invite revoked'))}
                  className="text-2xs text-red-400 hover:underline"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </EnterpriseCard>
      )}
    </div>
  );
}
