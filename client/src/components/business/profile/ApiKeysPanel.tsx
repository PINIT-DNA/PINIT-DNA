import { useCallback, useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../../services/dashboard.api';
import { API_BASE_URL } from '../../../config/api.config';
import { EnterpriseCard, EnterpriseButton } from './shared';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState('');
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ keys?: ApiKeyRow[] }>(`${API_BASE_URL}/organization/api-keys`);
      setKeys(data.keys ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const { data } = await api.post<{ key?: ApiKeyRow & { secret?: string } }>(
        `${API_BASE_URL}/organization/api-keys`,
        { name: name.trim() },
      );
      setNewSecret(data.key?.secret ?? null);
      setCopied(false);
      setName('');
      toast.success('API key created — copy the secret now');
      await load();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Could not create key');
    }
  }

  async function revoke(id: string) {
    await api.delete(`${API_BASE_URL}/organization/api-keys/${id}`);
    toast.success('Key revoked');
    await load();
  }

  async function copySecret() {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
    toast.success('Copied to clipboard');
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {newSecret && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-4">
          <p className="text-sm text-amber-950 dark:text-amber-100 font-semibold mb-2">
            Copy your new API key now — it will not be shown again
          </p>
          <code className="block text-xs text-slate-900 dark:text-white break-all font-mono bg-white dark:bg-black/30 p-3 rounded-lg border border-amber-200 dark:border-amber-500/30">
            {newSecret}
          </code>
          <div className="mt-3">
            <EnterpriseButton onClick={() => void copySecret()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy key'}
            </EnterpriseButton>
          </div>
        </div>
      )}

      <EnterpriseCard title="Create API key" icon={<Plus size={16} />}>
        <form onSubmit={(e) => void createKey(e)} className="flex flex-col sm:flex-row gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. Production)"
            className="flex-1 px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border-2 border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          <EnterpriseButton type="submit">
            <Plus size={14} />
            Create key
          </EnterpriseButton>
        </form>
      </EnterpriseCard>

      <EnterpriseCard title="Active keys" icon={<Key size={16} />}>
        {keys.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-gray-400 text-center py-6 font-medium">
            No API keys yet. Create one above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-bg-border -mx-1">
            {keys.map((k) => (
              <li key={k.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{k.name}</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400 font-mono mt-0.5">{k.keyPrefix}…</p>
                </div>
                <EnterpriseButton variant="danger" onClick={() => void revoke(k.id)} className="!px-3 !py-2">
                  <Trash2 size={14} />
                  Revoke
                </EnterpriseButton>
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </div>
  );
}
