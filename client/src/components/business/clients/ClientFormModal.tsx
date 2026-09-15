import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { createClient, updateClient, type BusinessClient, type ClientInput } from '../../../services/business.api';
import { formatApiError } from '../../../services/dashboard.api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (client: BusinessClient) => void;
  /** Present when editing an existing client. */
  existing?: BusinessClient | null;
}

const EMPTY: ClientInput = {
  name: '', companyName: '', website: '', contactName: '', contactEmail: '', notes: '',
};

export function ClientFormModal({ open, onClose, onSaved, existing }: Props) {
  const [form, setForm] = useState<ClientInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(existing
      ? {
          name: existing.name,
          companyName: existing.companyName ?? '',
          website: existing.website ?? '',
          contactName: existing.contactName ?? '',
          contactEmail: existing.contactEmail ?? '',
          notes: existing.notes ?? '',
        }
      : EMPTY);
    setError(null);
  }, [open, existing]);

  const canSave = form.name.trim().length >= 2 && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = existing
        ? await updateClient(existing.id, form)
        : await createClient(form);
      onSaved(saved);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof ClientInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={existing ? 'Edit client' : 'Add client'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button type="submit" form="client-form" disabled={!canSave} className="btn btn-primary btn-sm">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create client'}
          </button>
        </div>
      }
    >
      <form id="client-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Client name" required>
          <input
            autoFocus
            value={form.name}
            onChange={set('name')}
            disabled={saving}
            placeholder="e.g. Aurelia Naturals"
            className="input w-full"
          />
        </Field>
        <Field label="Company / brand">
          <input value={form.companyName} onChange={set('companyName')} disabled={saving} placeholder="Optional" className="input w-full" />
        </Field>
        <Field label="Website">
          <input value={form.website} onChange={set('website')} disabled={saving} placeholder="aurelianaturals.example" className="input w-full" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Contact name">
            <input value={form.contactName} onChange={set('contactName')} disabled={saving} placeholder="Optional" className="input w-full" />
          </Field>
          <Field label="Contact email">
            <input type="email" value={form.contactEmail} onChange={set('contactEmail')} disabled={saving} placeholder="Optional" className="input w-full" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={set('notes')}
            disabled={saving}
            rows={3}
            placeholder="Anything worth remembering about this client"
            className="input w-full resize-none"
          />
        </Field>
        {error && (
          <p className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{error}</p>
        )}
        <p className="text-2xs text-gray-500">Only the client name is required — everything else can be added later.</p>
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
