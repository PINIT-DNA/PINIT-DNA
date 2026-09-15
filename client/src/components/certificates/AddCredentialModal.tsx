import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { api, issueCertificate } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import type { VaultRecord } from '../../types/dashboard.types';
import { parseCredentialKind, type CredentialKind } from '../../lib/credential-registry';

const KINDS: Array<[CredentialKind, string]> = [
  ['certificate', 'Certificate'],
  ['award', 'Award'],
  ['license', 'License'],
  ['course', 'Course'],
  ['workshop', 'Workshop'],
  ['recognition', 'Recognition'],
];

export function AddCredentialModal({
  vaults,
  onClose,
  onAdded,
}: {
  vaults: VaultRecord[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<CredentialKind>('certificate');
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [description, setDescription] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => vaults.map((v) => ({ id: v.id, label: v.originalFileName })),
    [vaults],
  );

  const save = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const { data } = await api.get<Record<string, unknown>>(`${API_BASE_URL}/portfolio/me`);
      const root = (
        data?.portfolio && typeof data.portfolio === 'object'
          ? data.portfolio
          : data || {}
      ) as Record<string, unknown>;
      const id = `cred-${Date.now().toString(36)}`;
      const next = { ...root };

      if (kind === 'award') {
        const awards = Array.isArray(root.awards) ? [...root.awards] : [];
        awards.push({
          id,
          title: title.trim(),
          issuer: issuer.trim(),
          org: issuer.trim(),
          year: issuedOn.trim(),
          period: issuedOn.trim(),
          note: description.trim(),
          vault_id: vaultId || undefined,
        });
        next.awards = awards;
      } else {
        const certifications = Array.isArray(root.certifications) ? [...root.certifications] : [];
        certifications.push({
          id,
          title: title.trim(),
          issuer: issuer.trim(),
          org: issuer.trim(),
          vault_id: vaultId,
          kind,
          year: issuedOn.trim(),
          period: issuedOn.trim(),
          note: description.trim(),
        });
        next.certifications = certifications;
      }

      await api.put(`${API_BASE_URL}/portfolio/me`, next);

      if (vaultId) {
        const vault = vaults.find((v) => v.id === vaultId);
        if (vault) {
          await issueCertificate(vault.dnaRecordId, vault.id).catch(() => { /* already issued is fine */ });
        }
      }

      toast.success('Credential added');
      onAdded();
      onClose();
    } catch {
      toast.error('Could not save this credential. Try adding it from Portfolio.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Add credential" onClose={onClose} size="md">
      <div className="space-y-4 pb-2">
        <label className="block">
          <span className="text-xs text-gray-400">Credential type</span>
          <select
            className="input mt-1"
            value={kind}
            onChange={(e) => setKind(parseCredentialKind(e.target.value))}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Title</span>
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Issuer</span>
          <input className="input mt-1" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Organisation that issued it" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Issue date</span>
          <input className="input mt-1" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Description</span>
          <textarea className="input mt-1 resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Protected document</span>
          <select className="input mt-1" value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
            <option value="">None — record metadata only</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <p className="text-2xs text-gray-500 mt-1">
            Pick an existing protected file. Do not re-upload. PDF, JPG, PNG and DOCX already in My Assets can be linked.
          </p>
        </label>
        <p className="text-xs text-gray-500">
          Need to protect a new document first?{' '}
          <Link to="/generate" className="text-[#35D6A2] hover:underline">Protect New Asset</Link>
        </p>
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn btn-primary flex-1" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save credential'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
