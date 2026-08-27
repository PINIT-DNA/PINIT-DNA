/**
 * Add an internal team member to a campaign.
 *
 * Three routes to the same end, because three different situations exist:
 *
 *   Existing colleague   already in the business — nothing to accept, just
 *                        staff them onto the work
 *   By Pinit ID          they have a Pinit account but are not in this business
 *                        — confirm who it is, then invite
 *   By link              you do not know their Pinit ID, or they have no account
 *                        yet — send a link they can accept with
 *
 * The rule underneath all three: a person is identified by their Pinit account,
 * never by the name typed here. The name is shown so a human can confirm they
 * have the right person; the account id is what creates the relationship.
 *
 * Nothing in this dialog grants access on its own. The two invite routes create
 * a pending invitation that the recipient must accept while signed in as the
 * right account — opening the link is not accepting it.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  X, UserPlus, Search, Link2, Loader2, Check, Copy, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganizationTeam } from '../../../hooks/useOrganizationTeam';
import type { LookedUpAccount, AssignableMember } from '../../../hooks/useOrganizationTeam';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** Mirrors the server's vocabulary. The server rejects anything not on it. */
const CAMPAIGN_ROLES = [
  { id: 'OWNER', label: 'Campaign owner', hint: 'Accountable for the work landing.' },
  { id: 'PROJECT_MANAGER', label: 'Project manager', hint: 'Runs the schedule and the client.' },
  { id: 'CONTRIBUTOR', label: 'Contributor', hint: 'Makes the work.' },
  { id: 'REVIEWER', label: 'Reviewer', hint: 'Checks it before it goes out.' },
  { id: 'DESIGNER', label: 'Designer', hint: 'Makes the work.' },
  { id: 'DEVELOPER', label: 'Developer', hint: 'Builds the work.' },
];

type Route = 'existing' | 'pinit' | 'link';

const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message
  ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
  ?? fallback;

export function AddTeamMemberDialog({
  campaignId, campaignName, open, onClose, onAdded,
}: {
  campaignId: string;
  campaignName: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const team = useOrganizationTeam();
  const [route, setRoute] = useState<Route>('existing');
  const [role, setRole] = useState('CONTRIBUTOR');
  const [busy, setBusy] = useState(false);

  // Existing colleague
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [chosen, setChosen] = useState<string>('');

  // Pinit ID
  const [pinitId, setPinitId] = useState('');
  const [found, setFound] = useState<LookedUpAccount | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Link
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      setMembers(await team.assignableMembers(campaignId));
    } catch {
      setMembers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    if (!open) return;
    setRoute('existing'); setRole('CONTRIBUTOR'); setChosen('');
    setPinitId(''); setFound(null); setLookupError(null); setInviteLink(null);
    void loadMembers();
  }, [open, loadMembers]);

  if (!open) return null;

  const addExisting = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const m = await team.addToCampaign(campaignId, chosen, role);
      toast.success(`${m.name} added to ${campaignName}`);
      onAdded(); onClose();
    } catch (err) {
      toast.error(errText(err, 'Could not add them'));
    } finally { setBusy(false); }
  };

  const lookup = async () => {
    setLookupError(null); setFound(null);
    if (!pinitId.trim()) return;
    setBusy(true);
    try {
      setFound(await team.lookupPinitId(pinitId.trim()));
    } catch (err) {
      setLookupError(errText(err, 'No account with that Pinit ID'));
    } finally { setBusy(false); }
  };

  const inviteByPinitId = async () => {
    if (!found) return;
    setBusy(true);
    try {
      await team.invite({
        inviteeShortId: found.pinitId, role: 'MEMBER',
        campaignId, campaignRole: role,
      });
      toast.success(`Invitation sent to ${found.name}`);
      onAdded(); onClose();
    } catch (err) {
      toast.error(errText(err, 'Could not send the invitation'));
    } finally { setBusy(false); }
  };

  const generateLink = async () => {
    setBusy(true);
    try {
      const inv = await team.invite({ role: 'MEMBER', campaignId, campaignRole: role });
      setInviteLink(`${window.location.origin}/team/join/${inv.token}`);
    } catch (err) {
      toast.error(errText(err, 'Could not create the invitation'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog" aria-modal="true" aria-label="Add a team member">
      <div className="w-full max-w-lg rounded-xl border border-bg-border bg-bg-card shadow-2xl
                      max-h-[90vh] overflow-y-auto">

        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-bg-border">
          <div>
            <h2 className="text-base font-semibold text-white">Add a team member</h2>
            <p className="text-2xs text-gray-500 mt-0.5">
              Someone in your organization, on {campaignName}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-gray-500 hover:text-white p-1">
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* Route */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              ['existing', 'Existing team member'],
              ['pinit', 'Invite by Pinit ID'],
              ['link', 'Invite by link'],
            ] as [Route, string][]).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setRoute(id)}
                aria-pressed={route === id}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-2xs font-semibold border transition-colors',
                  route === id
                    ? 'bg-dna-500 text-white border-dna-600'
                    : 'text-gray-400 bg-bg-elevated border-bg-border hover:text-white',
                )}>
                {label}
              </button>
            ))}
          </div>

          {/* Role — applies to all three routes */}
          <div>
            <span className="block text-2xs font-semibold text-gray-400 mb-1.5">
              What are they doing on this campaign?
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {CAMPAIGN_ROLES.map((r) => (
                <button key={r.id} type="button" onClick={() => setRole(r.id)}
                  aria-pressed={role === r.id}
                  className={cn(
                    'text-left px-2.5 py-2 rounded-lg border transition-colors',
                    role === r.id
                      ? 'border-dna-500/50 bg-dna-500/10'
                      : 'border-bg-border bg-bg-elevated hover:border-dna-500/30',
                  )}>
                  <span className={cn('block text-2xs font-semibold',
                    role === r.id ? 'text-dna-300' : 'text-gray-300')}>{r.label}</span>
                  <span className="block text-2xs text-gray-500">{r.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-2xs text-gray-600 mt-1.5">
              This is their job on this campaign. What they're permitted to do still
              comes from their organization role.
            </p>
          </div>

          {/* ── Existing colleague ───────────────────────────────────── */}
          {route === 'existing' && (
            <div className="space-y-2">
              {members === null ? (
                <p className="text-xs text-gray-500">Loading your team…</p>
              ) : members.length === 0 ? (
                <div className="rounded-lg border border-dashed border-bg-border
                                bg-bg-elevated/40 px-3 py-5 text-center">
                  <p className="text-sm font-semibold text-white mb-0.5">
                    Everyone is already on this campaign
                  </p>
                  <p className="text-xs text-gray-400">
                    Invite someone new by Pinit ID or by link instead.
                  </p>
                </div>
              ) : (
                <>
                  <label htmlFor="member-pick"
                    className="block text-2xs font-semibold text-gray-400">
                    Who?
                  </label>
                  <select id="member-pick" value={chosen} onChange={(e) => setChosen(e.target.value)}
                    className="input w-full text-sm">
                    <option value="">Choose someone…</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} · {m.pinitId} · {m.orgRole.toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={busy || !chosen} onClick={() => void addExisting()}
                    className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                    Add to campaign
                  </button>
                  <p className="text-2xs text-gray-600">
                    They're already in your organization, so there's nothing to accept.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── By Pinit ID ──────────────────────────────────────────── */}
          {route === 'pinit' && (
            <div className="space-y-2">
              <label htmlFor="pinit-id" className="block text-2xs font-semibold text-gray-400">
                Their Pinit ID
              </label>
              <div className="flex items-center gap-2">
                <input id="pinit-id" value={pinitId}
                  onChange={(e) => { setPinitId(e.target.value); setFound(null); setLookupError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }}
                  placeholder="PINIT-XXXXXX"
                  className="input flex-1 text-sm font-mono" />
                <button type="button" disabled={busy || !pinitId.trim()} onClick={() => void lookup()}
                  className="btn btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  Find account
                </button>
              </div>

              {lookupError && (
                <p className="text-2xs text-danger inline-flex items-center gap-1.5">
                  <AlertTriangle size={11} /> {lookupError}
                </p>
              )}

              {found && (
                <div className="rounded-lg border border-bg-border bg-bg-elevated/40 px-3 py-2.5">
                  <p className="text-sm font-semibold text-white">{found.name}</p>
                  <p className="text-2xs text-gray-500 font-mono">{found.pinitId}</p>

                  {found.alreadyMember ? (
                    <p className="text-2xs text-amber-400 mt-1.5">
                      Already in your organization
                      {found.memberRole && ` as ${found.memberRole.toLowerCase()}`} —
                      use "Existing team member" instead.
                    </p>
                  ) : found.invitePending ? (
                    <p className="text-2xs text-amber-400 mt-1.5">
                      An invitation is already pending for this account.
                    </p>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void inviteByPinitId()}
                      className="btn btn-primary text-xs inline-flex items-center gap-1.5 mt-2 disabled:opacity-50">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Send invitation
                    </button>
                  )}
                </div>
              )}

              <p className="text-2xs text-gray-600">
                They'll be notified in Pinit and must accept while signed in to that account.
              </p>
            </div>
          )}

          {/* ── By link ──────────────────────────────────────────────── */}
          {route === 'link' && (
            <div className="space-y-2">
              {inviteLink ? (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
                  <p className="text-2xs font-semibold text-emerald-400 mb-1.5 inline-flex items-center gap-1.5">
                    <ShieldCheck size={11} /> Invitation created
                  </p>
                  <p className="text-2xs text-gray-300 font-mono break-all mb-2">{inviteLink}</p>
                  <button type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(inviteLink);
                      toast.success('Invitation link copied');
                    }}
                    className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
                    <Copy size={12} /> Copy link
                  </button>
                  <p className="text-2xs text-gray-500 mt-2">
                    Send this however you like. Whoever opens it must sign in to a Pinit
                    account and accept — opening it grants nothing on its own.
                  </p>
                </div>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => void generateLink()}
                    className="btn btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                    Generate invitation link
                  </button>
                  <p className="text-2xs text-gray-600">
                    Use this when you don't know their Pinit ID, or they don't have an
                    account yet. The link expires and can be revoked from Team.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-bg-border">
          <p className="text-2xs text-gray-600">
            Adding someone to a campaign doesn't give them every asset. Asset access
            and external sharing stay separate.
          </p>
        </footer>
      </div>
    </div>
  );
}
