import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { createCampaign, updateCampaign, type Campaign, type CampaignInput } from '../../../services/business.api';
import { formatApiError } from '../../../services/dashboard.api';

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  onSaved: (campaign: Campaign) => void;
  existing?: Campaign | null;
}

interface FormState {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  budget: string;
}

const EMPTY: FormState = { name: '', description: '', startDate: '', endDate: '', budget: '' };

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function CampaignFormModal({ open, onClose, clientId, clientName, onSaved, existing }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(existing
      ? {
          name: existing.name,
          description: existing.description ?? '',
          startDate: toDateInput(existing.startDate),
          endDate: toDateInput(existing.endDate),
          budget: existing.budgetCents != null ? String(existing.budgetCents / 100) : '',
        }
      : EMPTY);
    setError(null);
  }, [open, existing]);

  const dateOrderInvalid =
    !!form.startDate && !!form.endDate && new Date(form.endDate) < new Date(form.startDate);
  const canSave = form.name.trim().length >= 2 && !dateOrderInvalid && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const payload: CampaignInput = {
      name: form.name,
      description: form.description || undefined,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      budgetCents: form.budget ? Math.round(Number(form.budget) * 100) : undefined,
    };
    try {
      const saved = existing
        ? await updateCampaign(existing.id, payload)
        : await createCampaign(clientId, payload);
      onSaved(saved);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={existing ? 'Edit campaign' : 'New campaign'}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button type="submit" form="campaign-form" disabled={!canSave} className="btn btn-primary btn-sm">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create campaign'}
          </button>
        </div>
      }
    >
      <form id="campaign-form" onSubmit={submit} className="space-y-3.5">
        {!existing && (
          <p className="text-xs text-gray-500">
            For <span className="text-dna-400 font-semibold">{clientName}</span>
          </p>
        )}
        <Field label="Campaign name" required>
          <input
            autoFocus
            value={form.name}
            onChange={set('name')}
            disabled={saving}
            placeholder="e.g. Monsoon Glow 2026"
            className="input w-full"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Start date">
            <input type="date" value={form.startDate} onChange={set('startDate')} disabled={saving} className="input w-full" />
          </Field>
          <Field label="End date">
            <input type="date" value={form.endDate} onChange={set('endDate')} disabled={saving} className="input w-full" />
          </Field>
        </div>
        {dateOrderInvalid && (
          <p className="text-xs text-warning">End date cannot be before the start date.</p>
        )}
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={set('description')}
            disabled={saving}
            rows={3}
            placeholder="What this campaign covers"
            className="input w-full resize-none"
          />
        </Field>
        <Field label="Budget (₹)">
          <input
            type="number"
            min="0"
            step="1"
            value={form.budget}
            onChange={set('budget')}
            disabled={saving}
            placeholder="Optional"
            className="input w-full"
          />
        </Field>
        {error && (
          <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{error}</p>
        )}
        <p className="text-2xs text-gray-500">
          Only the campaign name is required. Team and creators are added from the campaign&apos;s People tab.
        </p>
      </form>
    </Modal>
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
