import { useState, useEffect } from 'react';
import { Loader2, Users, ExternalLink } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { addCampaignMember } from '../../../services/business.api';
import { formatApiError } from '../../../services/dashboard.api';
import { useOrganizationTeam } from '../../../hooks/useOrganizationTeam';
import { cn } from '../../ui/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onAdded: () => void;
}

type Mode = 'team' | 'external';

export function AddCampaignPersonModal({ open, onClose, campaignId, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>('team');
  const [userId, setUserId] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { members: teamMembers, loading: teamLoading } = useOrganizationTeam();

  useEffect(() => {
    if (!open) return;
    setMode('team');
    setUserId('');
    setRoleLabel('');
    setName('');
    setPlatform('');
    setProfileUrl('');
    setError(null);
  }, [open]);

  const canSave = !saving && (mode === 'team' ? !!userId : name.trim().length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await addCampaignMember(campaignId, mode === 'team'
        ? { memberUserId: userId, roleLabel: roleLabel || undefined }
        : { name, platform: platform || undefined, profileUrl: profileUrl || undefined, roleLabel: roleLabel || undefined });
      onAdded();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Add person to campaign"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary btn-sm">Cancel</button>
          <button type="submit" form="add-person-form" disabled={!canSave} className="btn btn-primary btn-sm">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Adding…' : 'Add to campaign'}
          </button>
        </div>
      }
    >
      <form id="add-person-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <ModeButton active={mode === 'team'} onClick={() => setMode('team')} icon={Users}
            title="Team member" detail="Someone in your organization" />
          <ModeButton active={mode === 'external'} onClick={() => setMode('external')} icon={ExternalLink}
            title="External creator" detail="Freelancer or influencer" />
        </div>

        {mode === 'team' ? (
          <Field label="Team member" required>
            {teamLoading ? (
              <div className="h-10 rounded-lg bg-bg-elevated animate-pulse" />
            ) : teamMembers.length === 0 ? (
              <p className="text-xs text-gray-500 rounded-lg border border-dashed border-bg-border px-3 py-3">
                No team members yet — invite people from Team first.
              </p>
            ) : (
              <select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={saving} className="input w-full">
                <option value="">Select a team member…</option>
                {teamMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName} — {m.role}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
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
          </>
        )}

        <Field label="Role on this campaign">
          <input value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} disabled={saving}
            placeholder={mode === 'team' ? 'e.g. Creative Director' : 'e.g. Reel creator'} className="input w-full" />
        </Field>

        {error && (
          <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{error}</p>
        )}
        {mode === 'external' && (
          <p className="text-2xs text-gray-500">
            External creators don&apos;t get an account. Share individual assets with them using Pinit&apos;s tracked share links.
          </p>
        )}
      </form>
    </Modal>
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
