import { useState } from 'react';
import { Users, UserPlus, Mail, Crown, Briefcase, Search, Shield, Eye, Trash2, Link2, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganizationTeam } from '../../../hooks/useOrganizationTeam';
import { useSubscription } from '../../../hooks/useSubscription';
import { teamInviteUrl } from '../../../lib/team-invite';
import { EnterpriseCard, EnterpriseButton } from './shared';

const ROLES = ['MANAGER', 'INVESTIGATOR', 'MEMBER', 'VIEWER'] as const;

function roleIcon(role: string) {
  if (role === 'OWNER') return Crown;
  if (role === 'MANAGER') return Briefcase;
  if (role === 'INVESTIGATOR') return Search;
  if (role === 'VIEWER') return Eye;
  return Shield;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function TeamPanel() {
  const { subscription } = useSubscription();
  const { members, invites, pendingInvites, loading, invite, revokeInvite, updateRole, removeMember } =
    useOrganizationTeam();
  const [inviteeShortId, setInviteeShortId] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function showCopied(key: string, url: string) {
    await copyText(url);
    setCopiedKey(key);
    toast.success('Invite link copied');
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
  }

  async function createInvite(mode: 'targeted' | 'link') {
    if (mode === 'targeted' && !inviteeShortId.trim() && !email.trim()) {
      toast.error('Enter a PINIT ID or email, or use Create invite link');
      return;
    }
    setBusy(true);
    try {
      const created = await invite({
        inviteeShortId: mode === 'targeted' ? (inviteeShortId.trim() || undefined) : undefined,
        email: mode === 'targeted' ? (email.trim() || undefined) : undefined,
        role,
      });
      const url = teamInviteUrl(created.token);
      setLastInviteUrl(url);
      await showCopied('last', url);
      setInviteeShortId('');
      setEmail('');
      toast.success(
        mode === 'link'
          ? 'Invite link ready — share it. When they open it, they join automatically.'
          : 'Invitation created — share the link so they can join',
        { duration: 4500 },
      );
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
        <p className="text-xs text-gray-500 mb-3">
          Best option: create an invite link and share it. When they open the link and sign in, they are added to your team automatically.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createInvite('targeted');
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={inviteeShortId}
              onChange={(e) => setInviteeShortId(e.target.value)}
              placeholder="PINIT ID (optional)"
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
          <div className="flex flex-wrap gap-2">
            <EnterpriseButton
              type="button"
              disabled={busy}
              onClick={() => void createInvite('link')}
            >
              <Link2 size={14} /> Create invite link
            </EnterpriseButton>
            <EnterpriseButton type="submit" disabled={busy} variant="secondary">
              Invite by PINIT ID
            </EnterpriseButton>
          </div>
        </form>

        {lastInviteUrl && (
          <div className="mt-4 rounded-xl border border-dna-500/30 bg-dna-500/10 p-3 space-y-2">
            <p className="text-xs font-semibold text-dna-300">Share this link</p>
            <p className="text-2xs text-gray-400">
              Anyone with a Pinit account who opens it joins as <span className="text-white font-medium">{role}</span> (one use).
            </p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-dna-400 mono flex-1 truncate">{lastInviteUrl}</p>
              <button
                type="button"
                onClick={() => void showCopied('last', lastInviteUrl)}
                className="btn btn-sm btn-secondary shrink-0 gap-1"
              >
                {copiedKey === 'last' ? <Check size={12} /> : <Copy size={12} />}
                Copy
              </button>
            </div>
          </div>
        )}
      </EnterpriseCard>

      <EnterpriseCard title="Team members" icon={<Users size={16} />}>
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
                      onClick={() => void removeMember(m.id).then(() => toast.success('Removed from team'))}
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
            {invites.map((i) => {
              const url = i.token ? teamInviteUrl(i.token) : null;
              return (
                <li key={i.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      {i.inviteeShortId ?? i.email ?? 'Invite link'}
                    </p>
                    <p className="text-2xs text-gray-500">
                      {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {url && (
                      <button
                        type="button"
                        onClick={() => void showCopied(i.id, url)}
                        className="text-2xs text-dna-400 hover:underline inline-flex items-center gap-1"
                      >
                        {copiedKey === i.id ? <Check size={11} /> : <Copy size={11} />}
                        Copy link
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void revokeInvite(i.id).then(() => toast.success('Invite revoked'))}
                      className="text-2xs text-red-400 hover:underline"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </EnterpriseCard>
      )}
    </div>
  );
}
