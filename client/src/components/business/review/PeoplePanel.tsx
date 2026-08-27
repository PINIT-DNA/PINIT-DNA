/**
 * Campaign → People.
 *
 * The distinction this screen has to make obvious: internal staff reach the
 * campaign through their organization role, and external creators reach only
 * the assets someone deliberately assigned them. Showing both in one
 * undifferentiated list would hide exactly the thing a manager needs to check.
 *
 * So internal and external are separate groups, an external person with no
 * assignment says so plainly, and every access control states what the person
 * will be able to do rather than naming a flag.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Users, UserPlus, ExternalLink, ShieldCheck, ShieldOff, Link2, Copy, Trash2,
  AlertTriangle, RefreshCw, Loader2, Check, Archive,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listCampaignPeople, grantCampaignAccess, updateCampaignAccess,
  revokeCampaignAccess, listCampaignAccessLinks,
} from '../../../services/business.api';
import type {
  CampaignPeople, CampaignPerson, CampaignAsset, AccessLink,
} from '../../../services/business.api';
import { SectionCard, SkeletonRows } from '../clients/BusinessKit';
import { AddTeamMemberDialog } from './AddTeamMemberDialog';
import { timeAgo, initialsOf } from './ReviewPrimitives';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const ACCESS_BADGE: Record<string, { label: string; cls: string }> = {
  NONE:    { label: 'No access',  cls: 'text-gray-400 bg-bg-elevated border-bg-border' },
  INVITED: { label: 'Invited',    cls: 'text-dna-400 bg-dna-500/10 border-dna-500/25' },
  ACTIVE:  { label: 'Has access', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  REVOKED: { label: 'Revoked',    cls: 'text-gray-500 bg-bg-elevated/60 border-bg-border' },
};

export function PeoplePanel({
  campaignId, assets, onAddPerson, onRemovePerson, onChanged,
}: {
  campaignId: string;
  assets: CampaignAsset[] | null;
  onAddPerson?: () => void;
  /** Removing someone from the campaign entirely — distinct from revoking
   *  their access, which keeps the record of involvement. */
  onRemovePerson?: (memberId: string, name: string) => void | Promise<void>;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<CampaignPeople | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listCampaignPeople(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load people');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <SkeletonRows rows={4} />;

  if (error) {
    return (
      <SectionCard title="People" icon={Users}>
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-5 text-center">
          <AlertTriangle size={18} className="text-danger mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">Couldn't load people</p>
          <p className="text-xs text-gray-400 mb-3">{error}</p>
          <button type="button" onClick={load} className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      </SectionCard>
    );
  }

  const internal = data?.people.filter((p) => p.kind === 'internal') ?? [];
  const external = data?.people.filter((p) => p.kind === 'external') ?? [];
  const [addTeamOpen, setAddTeamOpen] = useState(false);

  return (
    <div className="space-y-4">
      <AddTeamMemberDialog
        campaignId={campaignId}
        campaignName={data?.client?.name ?? 'this campaign'}
        open={addTeamOpen}
        onClose={() => setAddTeamOpen(false)}
        onAdded={() => { void load(); onChanged?.(); }}
      />

      {data?.client && (
        <SectionCard title="Client" icon={Users}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/15 border border-amber-500/25
                            flex items-center justify-center text-2xs font-bold text-amber-400 shrink-0">
              {initialsOf(data.client.name)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{data.client.name}</p>
              <p className="text-2xs text-gray-500 truncate">
                {data.client.contactName ?? 'No contact named'}
                {data.client.contactEmail ? ` · ${data.client.contactEmail}` : ''}
              </p>
            </div>
          </div>
          <p className="text-2xs text-gray-500 mt-2.5">
            The client reviews through the secure links you share. They never see the Business Account.
          </p>
        </SectionCard>
      )}

      <SectionCard
        title={`Team · ${internal.length}`}
        icon={Users}
        action={
          <a href="/business/team" className="text-2xs font-semibold text-dna-400 hover:text-dna-300">
            Manage team
          </a>
        }
      >
        {internal.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-white mb-0.5">No team members on this campaign</p>
            <p className="text-xs text-gray-400 mb-3">
              Add someone from your organization to show who is working on it.
            </p>
            <button type="button" onClick={() => setAddTeamOpen(true)}
              className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
              <UserPlus size={13} /> Add team member
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {internal.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-bg-border
                                        bg-bg-elevated/40 px-3 py-2.5">
                <Avatar name={p.name} tone="dna" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                  <p className="text-2xs text-gray-500 truncate">
                    {p.roleLabel ?? 'Team member'}
                    {p.shortId ? ` · ${p.shortId}` : ''}
                  </p>
                </div>
                {p.orgRole && (
                  <span className="text-2xs font-semibold text-gray-400 border border-bg-border
                                   rounded-full px-2 py-0.5 whitespace-nowrap">
                    {p.orgRole.toLowerCase()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {internal.length > 0 && (
          <button type="button" onClick={() => setAddTeamOpen(true)}
            className="btn btn-secondary text-xs inline-flex items-center gap-1.5 mt-3">
            <UserPlus size={13} /> Add team member
          </button>
        )}
        <p className="text-2xs text-gray-500 mt-2.5">
          Team members reach campaign assets through their organization role. Change it in Team.
        </p>
      </SectionCard>

      <SectionCard
        title={`External creators · ${external.length}`}
        icon={ExternalLink}
        action={onAddPerson && (
          <button type="button" onClick={onAddPerson}
            className="btn btn-secondary text-2xs inline-flex items-center gap-1.5">
            <UserPlus size={12} /> Add
          </button>
        )}
      >
        {external.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
            <ExternalLink size={20} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white mb-0.5">No external creators yet</p>
            <p className="text-xs text-gray-400">
              Add a freelancer or agency partner, then give them access to specific assets.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {external.map((p) => (
              <ExternalPersonRow
                key={p.id}
                person={p}
                campaignId={campaignId}
                assets={assets ?? []}
                expanded={openId === p.id}
                onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                onRemovePerson={onRemovePerson}
                onChanged={() => { void load(); onChanged?.(); }}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function ExternalPersonRow({
  person: p, campaignId, assets, expanded, onToggle, onRemovePerson, onChanged,
}: {
  person: CampaignPerson;
  campaignId: string;
  assets: CampaignAsset[];
  expanded: boolean;
  onToggle: () => void;
  onRemovePerson?: (memberId: string, name: string) => void | Promise<void>;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [perms, setPerms] = useState({
    canComment: p.permissions?.canComment ?? true,
    canRequestChanges: p.permissions?.canRequestChanges ?? false,
    canApprove: p.permissions?.canApprove ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<AccessLink[] | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const badge = ACCESS_BADGE[p.accessStatus] ?? ACCESS_BADGE.NONE;
  const assigned = new Set(p.assets.map((a) => a.assetId));
  const unassigned = assets.filter((a) => !assigned.has(a.id));

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setRowError(null);
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err instanceof Error ? err.message : 'Something went wrong');
      setRowError(msg);
    } finally {
      setBusy(false);
    }
  };

  const loadLinks = async () => {
    try { setLinks(await listCampaignAccessLinks(campaignId, p.id)); }
    catch { setLinks([]); }
  };

  return (
    <li className={cn('rounded-xl border bg-bg-card',
      expanded ? 'border-dna-500/40' : 'border-bg-border')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <Avatar name={p.name} tone="amber" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{p.name}</p>
          <p className="text-2xs text-gray-500 truncate">
            {p.roleLabel ?? 'External creator'}
            {p.platform ? ` · ${p.platform}` : ''}
            {p.assets.length > 0 && ` · ${p.assets.length} asset${p.assets.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <span className={cn('text-2xs font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap', badge.cls)}>
          {badge.label}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-bg-border/70 pt-3">
          {/* What they currently reach */}
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Can reach
            </p>
            {p.assets.length === 0 ? (
              <p className="text-xs text-gray-400 rounded-lg border border-dashed border-bg-border
                            bg-bg-elevated/40 px-3 py-2.5">
                Nothing yet — being on the campaign is not access. Assign an asset below.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {p.assets.map((a) => (
                  <li key={a.assetId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-bg-border
                               bg-bg-elevated/40 px-2.5 py-2">
                    <span className="text-xs text-gray-300 truncate flex items-center gap-1.5 min-w-0">
                      <Archive size={11} className="shrink-0 text-gray-500" />
                      <span className="truncate">{a.filename}</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(
                        () => revokeCampaignAccess(campaignId, p.id, a.assetId),
                        'Access removed')}
                      className="text-2xs font-semibold text-gray-400 hover:text-danger inline-flex
                                 items-center gap-1 shrink-0 disabled:opacity-50"
                    >
                      <Trash2 size={11} /> Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Assign more */}
          {unassigned.length > 0 && (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Give access to
              </p>
              <ul className="space-y-1">
                {unassigned.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 rounded-lg border border-bg-border
                                      bg-bg-elevated/40 px-2.5 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.includes(a.id)}
                        onChange={(e) => setSelected(e.target.checked
                          ? [...selected, a.id]
                          : selected.filter((x) => x !== a.id))}
                        className="accent-dna-500 w-3.5 h-3.5"
                      />
                      <span className="text-xs text-gray-300 truncate">{a.originalFilename}</span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-2.5 space-y-1.5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-gray-500">
                  They will be able to
                </p>
                <PermToggle label="Comment on the asset"
                  checked={perms.canComment}
                  onChange={(v) => setPerms({ ...perms, canComment: v })} />
                <PermToggle label="Request changes"
                  checked={perms.canRequestChanges}
                  onChange={(v) => setPerms({ ...perms, canRequestChanges: v })} />
                <PermToggle label="Approve versions"
                  detail="Sign-off is usually the client's decision, not a creator's."
                  checked={perms.canApprove}
                  onChange={(v) => setPerms({ ...perms, canApprove: v })} />
              </div>

              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => void act(async () => {
                  await grantCampaignAccess(campaignId, p.id, { assetIds: selected, ...perms });
                  setSelected([]);
                }, 'Access granted')}
                className="btn btn-primary text-xs mt-2.5 inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                Give access to {selected.length || 'no'} asset{selected.length === 1 ? '' : 's'}
              </button>
            </div>
          )}

          {/* Existing permissions + links */}
          {p.accessStatus === 'ACTIVE' && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button type="button" disabled={busy}
                onClick={() => void act(
                  () => updateCampaignAccess(campaignId, p.id, perms), 'Permissions updated')}
                className="text-2xs font-semibold text-dna-400 hover:text-dna-300 disabled:opacity-50">
                Save permissions
              </button>
              <button type="button" onClick={() => void loadLinks()}
                className="text-2xs font-semibold text-gray-400 hover:text-white inline-flex items-center gap-1">
                <Link2 size={11} /> Show links
              </button>
              <button type="button" disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Remove all access for ${p.name}? Their links stop working immediately.`)) return;
                  void act(() => revokeCampaignAccess(campaignId, p.id), 'All access revoked');
                }}
                className="text-2xs font-semibold text-danger hover:text-red-400 inline-flex items-center gap-1 disabled:opacity-50">
                <ShieldOff size={11} /> Revoke all
              </button>
            </div>
          )}

          {links && (
            <ul className="space-y-1.5">
              {links.length === 0 ? (
                <li className="text-2xs text-gray-500">No links issued yet.</li>
              ) : links.map((l) => (
                <li key={l.token}
                  className="flex items-center justify-between gap-2 rounded-lg border border-bg-border
                             bg-bg-elevated/40 px-2.5 py-2">
                  <span className="text-2xs text-gray-400 truncate min-w-0">
                    {l.filename} · {l.active ? 'active' : 'revoked'} · {l.viewCount} view{l.viewCount === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}/s/${l.token}`)
                        .then(() => toast.success('Link copied'))
                        .catch(() => toast.error('Could not copy'));
                    }}
                    className="text-2xs font-semibold text-dna-400 hover:text-dna-300 inline-flex items-center gap-1 shrink-0"
                  >
                    <Copy size={11} /> Copy
                  </button>
                </li>
              ))}
            </ul>
          )}

          {onRemovePerson && (
            <div className="pt-1 border-t border-bg-border/70">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRemovePerson(p.id, p.name)}
                className="text-2xs font-semibold text-gray-500 hover:text-danger inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 size={11} /> Remove from campaign
              </button>
              <p className="text-2xs text-gray-600 mt-1">
                Removes them from the record entirely. To keep the history and only stop their
                access, use Revoke all.
              </p>
            </div>
          )}

          {p.lastAccessAt && (
            <p className="text-2xs text-gray-500">Last opened {timeAgo(p.lastAccessAt)}</p>
          )}

          {rowError && (
            <p role="alert" className="text-2xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-px" /> {rowError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function PermToggle({
  label, detail, checked, onChange,
}: {
  label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <span className={cn('mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
        checked ? 'bg-dna-500 border-dna-600' : 'border-bg-border bg-bg-card')}>
        {checked && <Check size={9} className="text-white" strokeWidth={3.5} />}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className="min-w-0">
        <span className="block text-2xs text-gray-300">{label}</span>
        {detail && <span className="block text-2xs text-gray-500">{detail}</span>}
      </span>
    </label>
  );
}

function Avatar({ name, tone }: { name: string; tone: 'dna' | 'amber' }) {
  return (
    <div className={cn(
      'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-2xs font-bold border',
      tone === 'amber'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
        : 'bg-dna-500/15 text-dna-400 border-dna-500/25',
    )}>
      {initialsOf(name)}
    </div>
  );
}
