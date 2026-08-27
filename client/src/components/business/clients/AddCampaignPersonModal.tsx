import { useMemo, useState, useEffect } from 'react';
import { Loader2, Users, ExternalLink, Search, UserPlus, Link2, Check, Copy } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { addCampaignMember } from '../../../services/business.api';
import { formatApiError } from '../../../services/dashboard.api';
import { useOrganizationTeam, type LookedUpAccount } from '../../../hooks/useOrganizationTeam';
import { CAMPAIGN_ROLES, type CampaignRoleId } from '../../../lib/campaign-roles';
import { cn } from '../../ui/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  /** User IDs already on this campaign — hide from the existing-member picker. */
  existingUserIds?: string[];
  /** Pinit IDs already on this campaign or pending invite. */
  existingShortIds?: string[];
  /** Called after a successful add, or after invite is created (may keep modal open for the link). */
  onAdded: (opts?: { keepOpen?: boolean }) => void;
}

type Mode = 'team' | 'external';
type TeamPath = 'existing' | 'invite';

export function AddCampaignPersonModal({
  open, onClose, campaignId, existingUserIds = [], existingShortIds = [], onAdded,
}: Props) {
  const [mode, setMode] = useState<Mode>('team');
  const [teamPath, setTeamPath] = useState<TeamPath>('existing');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [campaignRole, setCampaignRole] = useState<CampaignRoleId>('CONTRIBUTOR');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [invitePinitId, setInvitePinitId] = useState('');
  const [lookup, setLookup] = useState<LookedUpAccount | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { members: teamMembers, loading: teamLoading, lookupPinitId, invite } = useOrganizationTeam();

  useEffect(() => {
    if (!open) return;
    setMode('team');
    setTeamPath('existing');
    setSearch('');
    setUserId('');
    setCampaignRole('CONTRIBUTOR');
    setName('');
    setPlatform('');
    setProfileUrl('');
    setInvitePinitId('');
    setLookup(null);
    setLookupError(null);
    setInviteLink(null);
    setCopied(false);
    setError(null);
  }, [open]);

  const availableMembers = useMemo(() => {
    const taken = new Set(existingUserIds);
    return teamMembers.filter((m) => !taken.has(m.userId));
  }, [teamMembers, existingUserIds]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableMembers;
    return availableMembers.filter((m) => {
      const nameHit = (m.fullName || '').toLowerCase().includes(q);
      const idHit = (m.shortId || '').toLowerCase().includes(q);
      return nameHit || idHit;
    });
  }, [availableMembers, search]);

  const selectedMember = availableMembers.find((m) => m.userId === userId) ?? null;

  const canSaveTeamExisting = !!userId && !saving;
  const canSaveInvite = !!lookup && !lookup.alreadyOnCampaign && !saving;
  const canSaveExternal = name.trim().length > 0 && !saving;

  const findAccount = async () => {
    setLookup(null);
    setLookupError(null);
    setInviteLink(null);
    const raw = invitePinitId.trim();
    if (!raw) {
      setLookupError('Enter a Pinit ID');
      return;
    }
    setLookingUp(true);
    try {
      const account = await lookupPinitId(raw, { campaignId });
      if (existingShortIds.includes(account.pinitId) || account.alreadyOnCampaign) {
        setLookup({ ...account, alreadyOnCampaign: true });
      } else {
        setLookup(account);
      }
    } catch (err) {
      setLookupError(formatApiError(err));
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === 'external') {
        if (!canSaveExternal) return;
        await addCampaignMember(campaignId, {
          name: name.trim(),
          platform: platform || undefined,
          profileUrl: profileUrl || undefined,
          roleLabel: campaignRole,
        });
        onAdded();
        return;
      }

      if (teamPath === 'existing') {
        if (!canSaveTeamExisting) return;
        await addCampaignMember(campaignId, {
          memberUserId: userId,
          roleLabel: campaignRole,
        });
        onAdded();
        return;
      }

      // Invite by Pinit ID
      if (!lookup || lookup.alreadyOnCampaign) return;

      if (lookup.alreadyMember) {
        // Already in the organization — attach to this campaign immediately.
        await addCampaignMember(campaignId, {
          memberShortId: lookup.pinitId,
          roleLabel: campaignRole,
        });
        onAdded();
        return;
      }

      const created = await invite({
        inviteeShortId: lookup.pinitId,
        role: 'MEMBER',
        campaignId,
        campaignRole,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setInviteLink(`${origin}/team/join/${created.token}`);
      // Refresh People (pending invite) without closing — user still needs the link.
      onAdded({ keepOpen: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  const footerPrimaryLabel = (() => {
    if (saving) {
      if (mode === 'team' && teamPath === 'invite' && lookup && !lookup.alreadyMember) return 'Sending…';
      return 'Adding…';
    }
    if (mode === 'team' && teamPath === 'invite') {
      if (lookup?.alreadyMember) return 'Add to campaign';
      return 'Send invitation';
    }
    return 'Add to campaign';
  })();

  const canSubmit = mode === 'external'
    ? canSaveExternal
    : teamPath === 'existing'
      ? canSaveTeamExisting
      : canSaveInvite;

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Add person to campaign"
      size="md"
      footer={
        inviteLink ? (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { onAdded(); }} className="btn btn-primary btn-sm">Done</button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary btn-sm">Cancel</button>
            <button type="submit" form="add-person-form" disabled={!canSubmit} className="btn btn-primary btn-sm">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {footerPrimaryLabel}
            </button>
          </div>
        )
      }
    >
      <form id="add-person-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <ModeButton active={mode === 'team'} onClick={() => { setMode('team'); setError(null); }} icon={Users}
            title="Team member" detail="Someone in your organization" />
          <ModeButton active={mode === 'external'} onClick={() => { setMode('external'); setError(null); }} icon={ExternalLink}
            title="External creator" detail="Freelancer or influencer" />
        </div>

        {mode === 'team' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <PathChip
                active={teamPath === 'existing'}
                onClick={() => { setTeamPath('existing'); setError(null); setInviteLink(null); }}
                label="Existing organization member"
              />
              <PathChip
                active={teamPath === 'invite'}
                onClick={() => { setTeamPath('invite'); setError(null); setInviteLink(null); }}
                label="Invite by Pinit ID"
              />
            </div>

            {teamPath === 'existing' ? (
              <>
                <Field label="Search by name or Pinit ID">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      disabled={saving || teamLoading}
                      placeholder="Name or PINIT-…"
                      className="input w-full pl-9"
                    />
                  </div>
                </Field>

                {teamLoading ? (
                  <div className="h-24 rounded-lg bg-bg-elevated animate-pulse" />
                ) : availableMembers.length === 0 ? (
                  <p className="text-xs text-gray-500 rounded-lg border border-dashed border-bg-border px-3 py-3">
                    Everyone in your organization is already on this campaign — or invite someone new by Pinit ID.
                  </p>
                ) : filteredMembers.length === 0 ? (
                  <p className="text-xs text-gray-500 rounded-lg border border-dashed border-bg-border px-3 py-3">
                    No matching team members.
                  </p>
                ) : (
                  <ul className="max-h-44 overflow-y-auto rounded-lg border border-bg-border divide-y divide-bg-border">
                    {filteredMembers.map((m) => {
                      const active = userId === m.userId;
                      return (
                        <li key={m.userId}>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setUserId(m.userId)}
                            className={cn(
                              'w-full text-left px-3 py-2.5 transition-colors',
                              active ? 'bg-dna-500/15' : 'hover:bg-bg-elevated/60',
                            )}
                          >
                            <p className={cn('text-sm font-semibold', active ? 'text-dna-300' : 'text-white')}>
                              {m.fullName || 'Team member'}
                            </p>
                            <p className="text-2xs text-gray-500 mono">{m.shortId}</p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {selectedMember && (
                  <PersonCard name={selectedMember.fullName || 'Team member'} pinitId={selectedMember.shortId} />
                )}
              </>
            ) : inviteLink ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Check size={16} />
                  <p className="text-sm font-semibold">Invitation sent</p>
                </div>
                <p className="text-xs text-gray-400">
                  Bound to <span className="text-white font-medium">{lookup?.name}</span>
                  {' '}(<span className="mono text-2xs">{lookup?.pinitId}</span>).
                  Opening the link does not grant access — they must sign in as this Pinit account and accept.
                </p>
                <div className="flex gap-2">
                  <input readOnly value={inviteLink} className="input w-full text-2xs mono" />
                  <button type="button" onClick={copyLink} className="btn btn-secondary btn-sm shrink-0">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Field label="Pinit ID" required>
                  <div className="flex gap-2">
                    <input
                      value={invitePinitId}
                      onChange={(e) => { setInvitePinitId(e.target.value); setLookup(null); setLookupError(null); }}
                      disabled={saving || lookingUp}
                      placeholder="PINIT-XXXXXX"
                      className="input w-full mono"
                    />
                    <button
                      type="button"
                      onClick={findAccount}
                      disabled={lookingUp || saving || !invitePinitId.trim()}
                      className="btn btn-secondary btn-sm shrink-0 inline-flex items-center gap-1.5"
                    >
                      {lookingUp ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Find account
                    </button>
                  </div>
                </Field>

                {lookupError && (
                  <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{lookupError}</p>
                )}

                {lookup && (
                  <div className="space-y-2">
                    <p className="text-2xs font-bold uppercase tracking-wide text-gray-500">Verified account</p>
                    <PersonCard name={lookup.name} pinitId={lookup.pinitId} />
                    {lookup.alreadyOnCampaign && (
                      <p className="text-xs text-amber-400">Already on this campaign.</p>
                    )}
                    {!lookup.alreadyOnCampaign && lookup.alreadyMember && (
                      <p className="text-xs text-gray-500">
                        Already in your organization — they will be added to this campaign now.
                      </p>
                    )}
                    {!lookup.alreadyOnCampaign && !lookup.alreadyMember && lookup.invitePending && (
                      <p className="text-xs text-amber-400">An invitation is already pending for this account.</p>
                    )}
                    {!lookup.alreadyOnCampaign && !lookup.alreadyMember && (
                      <p className="text-2xs text-gray-500 flex items-start gap-1.5">
                        <Link2 size={12} className="mt-0.5 shrink-0" />
                        Sends an organization invitation bound to this campaign. Acceptance requires their Pinit account.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {!(teamPath === 'invite' && inviteLink) && (
              <Field label="Campaign role" required>
                <select
                  value={campaignRole}
                  onChange={(e) => setCampaignRole(e.target.value as CampaignRoleId)}
                  disabled={saving}
                  className="input w-full"
                >
                  {CAMPAIGN_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <p className="text-2xs text-gray-500 mt-1.5">
                  Campaign role is not the same as business role — it does not change organization permissions.
                </p>
              </Field>
            )}
          </>
        )}

        {mode === 'external' && (
          <>
            <Field label="Name" required>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={saving}
                placeholder="e.g. Isha Kulkarni" className="input w-full" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Platform">
                <input value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={saving}
                  placeholder="Instagram" className="input w-full" />
              </Field>
              <Field label="Profile URL">
                <input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} disabled={saving}
                  placeholder="Optional" className="input w-full" />
              </Field>
            </div>
            <Field label="Campaign role">
              <select
                value={campaignRole}
                onChange={(e) => setCampaignRole(e.target.value as CampaignRoleId)}
                disabled={saving}
                className="input w-full"
              >
                {CAMPAIGN_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </Field>
            <p className="text-2xs text-gray-500">
              External creators do not become organization members. Share specific assets with tracked links.
            </p>
          </>
        )}

        {error && (
          <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{error}</p>
        )}
      </form>
    </Modal>
  );
}

function PersonCard({ name, pinitId }: { name: string; pinitId: string }) {
  return (
    <div className="rounded-xl border border-bg-border bg-bg-elevated/50 px-3 py-2.5 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-dna-500/15 border border-dna-500/25
                      flex items-center justify-center text-2xs font-bold text-dna-400 shrink-0">
        {(name || '?').trim().charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white truncate">{name}</p>
        <p className="text-2xs text-gray-500 mono truncate">{pinitId}</p>
      </div>
      <UserPlus size={14} className="text-dna-400 ml-auto shrink-0" />
    </div>
  );
}

function PathChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-2 text-left text-2xs font-semibold transition-all',
        active ? 'bg-dna-500/10 border-dna-500/40 text-dna-300' : 'bg-bg-card border-bg-border text-gray-400 hover:border-dna-500/25',
      )}
    >
      {label}
    </button>
  );
}

function ModeButton({
  active, onClick, icon: Icon, title, detail,
}: {
  active: boolean; onClick: () => void; icon: typeof Users; title: string; detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border p-3 text-left transition-all',
        active ? 'bg-dna-500/10 border-dna-500/40' : 'bg-bg-card border-bg-border hover:border-dna-500/25',
      )}
    >
      <Icon size={15} className={active ? 'text-dna-400' : 'text-gray-500'} />
      <p className={cn('text-sm font-semibold mt-1.5', active ? 'text-dna-400' : 'text-white')}>{title}</p>
      <p className="text-2xs text-gray-500 mt-0.5">{detail}</p>
    </button>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-2xs font-bold uppercase tracking-wide text-gray-500 mb-1.5 block">
        {label}{required && <span className="text-dna-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
