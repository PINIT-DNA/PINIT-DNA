import { useCallback, useEffect, useState } from 'react';
import {
  Plug, Webhook, Plus, Trash2, Send, Link2, Unplug, CheckCircle2, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../../services/dashboard.api';
import { API_BASE_URL } from '../../../config/api.config';
import { EnterpriseCard, EnterpriseButton } from './shared';

interface ConnectedItem {
  id: string;
  provider: string;
  displayName: string | null;
  status: string;
  lastUsedAt: string | null;
}

interface WebhookRow {
  id: string;
  name: string;
  targetUrl: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  secretHint: string;
}

const EVENT_OPTIONS = [
  'dna.generated',
  'vault.integrity',
  'share.accessed',
  'share.expired',
  'monitoring.match',
  'integration.test',
];

type BridgeKey = 'SLACK' | 'MICROSOFT_TEAMS' | 'ZAPIER';

const BRIDGE_META: Record<
  BridgeKey,
  { title: string; path: string; hint: string; placeholder: string; namePlaceholder: string }
> = {
  SLACK: {
    title: 'Slack',
    path: 'slack',
    hint: 'In Slack: create an app → Incoming Webhooks → add to channel → paste the URL below. Free.',
    placeholder: 'https://hooks.slack.com/services/…',
    namePlaceholder: 'Channel name (optional, e.g. #security)',
  },
  MICROSOFT_TEAMS: {
    title: 'Microsoft Teams',
    path: 'teams',
    hint: 'In Teams: channel ··· → Connectors / Workflows → Incoming Webhook → paste the URL below.',
    placeholder: 'https://….webhook.office.com/webhookb2/…',
    namePlaceholder: 'Channel name (optional)',
  },
  ZAPIER: {
    title: 'Zapier',
    path: 'zapier',
    hint: 'In Zapier: create a Zap → Webhooks by Zapier → Catch Hook → copy the URL and paste below.',
    placeholder: 'https://hooks.zapier.com/hooks/catch/…',
    namePlaceholder: 'Zap name (optional)',
  },
};

type StorageKey = 'GOOGLE_DRIVE' | 'DROPBOX';

const STORAGE_META: Record<
  StorageKey,
  { title: string; path: string; hint: string; placeholder: string }
> = {
  GOOGLE_DRIVE: {
    title: 'Google Drive',
    path: 'google-drive',
    hint: 'Paste the Access token from OAuth Playground (starts with ya29.…). Do NOT paste Client ID / Client Secret.',
    placeholder: 'ya29.… Google OAuth access token',
  },
  DROPBOX: {
    title: 'Dropbox',
    path: 'dropbox',
    hint: 'In Dropbox App Console → your app → Generate access token → paste below. Free Dropbox app.',
    placeholder: 'Dropbox access token (sl.…)',
  },
};

function looksLikeGoogleClientId(value: string): boolean {
  return (
    /\.apps\.googleusercontent\.com/i.test(value) ||
    (/^\d{6,}-\w+/.test(value) && !value.startsWith('ya29'))
  );
}

export function IntegrationsPanel() {
  const [connected, setConnected] = useState<ConnectedItem[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [bridgeUrl, setBridgeUrl] = useState<Record<BridgeKey, string>>({
    SLACK: '',
    MICROSOFT_TEAMS: '',
    ZAPIER: '',
  });
  const [bridgeName, setBridgeName] = useState<Record<BridgeKey, string>>({
    SLACK: '',
    MICROSOFT_TEAMS: '',
    ZAPIER: '',
  });
  const [storageToken, setStorageToken] = useState<Record<StorageKey, string>>({
    GOOGLE_DRIVE: '',
    DROPBOX: '',
  });

  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>(['integration.test', 'dna.generated']);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  /** Only the card being acted on shows Connecting… — not every card. */
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [integ, hooks] = await Promise.all([
        api.get<{ connected?: ConnectedItem[] }>(`${API_BASE_URL}/organization/integrations`),
        api.get<{ webhooks?: WebhookRow[] }>(`${API_BASE_URL}/organization/webhooks`),
      ]);
      setConnected(integ.data.connected ?? []);
      setWebhooks(hooks.data.webhooks ?? []);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Could not load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function isConnected(provider: string) {
    return connected.some((c) => c.provider === provider);
  }

  function displayOf(provider: string) {
    return connected.find((c) => c.provider === provider)?.displayName;
  }

  function isBusy(key: string) {
    return busyKey === key;
  }

  async function connectBridge(provider: BridgeKey) {
    const url = bridgeUrl[provider].trim();
    if (!url) {
      toast.error(`Paste the ${BRIDGE_META[provider].title} URL first`);
      return;
    }
    setBusyKey(provider);
    try {
      await api.post(`${API_BASE_URL}/organization/integrations/${BRIDGE_META[provider].path}`, {
        incomingWebhookUrl: url,
        channelName: bridgeName[provider].trim() || undefined,
        displayName: bridgeName[provider].trim() || undefined,
      });
      toast.success(`${BRIDGE_META[provider].title} connected`);
      setBridgeUrl((p) => ({ ...p, [provider]: '' }));
      setBridgeName((p) => ({ ...p, [provider]: '' }));
      await load();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Connect failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function testBridge(provider: BridgeKey) {
    setBusyKey(`${provider}:test`);
    try {
      await api.post(`${API_BASE_URL}/organization/integrations/${BRIDGE_META[provider].path}/test`);
      toast.success(`Test sent to ${BRIDGE_META[provider].title}`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Test failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function connectStorage(provider: StorageKey) {
    const accessToken = storageToken[provider].trim();
    if (!accessToken) {
      toast.error(`Paste the ${STORAGE_META[provider].title} access token first`);
      return;
    }
    if (provider === 'GOOGLE_DRIVE' && looksLikeGoogleClientId(accessToken)) {
      toast.error(
        'That looks like a Client ID, not an access token. Use OAuth Playground → Exchange → copy Access token (ya29.…)',
      );
      return;
    }
    if (provider === 'GOOGLE_DRIVE' && !accessToken.startsWith('ya29')) {
      toast.error('Google Drive access token usually starts with ya29.… — regenerate in OAuth Playground');
      return;
    }
    setBusyKey(provider);
    try {
      await api.post(`${API_BASE_URL}/organization/integrations/${STORAGE_META[provider].path}`, {
        accessToken,
      });
      toast.success(`${STORAGE_META[provider].title} connected`);
      setStorageToken((p) => ({ ...p, [provider]: '' }));
      await load();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error ?? 'Connect failed';
      toast.error(typeof msg === 'string' ? msg.slice(0, 180) : 'Connect failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function testStorage(provider: StorageKey) {
    setBusyKey(`${provider}:test`);
    try {
      await api.post(`${API_BASE_URL}/organization/integrations/${STORAGE_META[provider].path}/test`);
      toast.success(`${STORAGE_META[provider].title} connection OK`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Test failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function disconnect(provider: string) {
    setBusyKey(`${provider}:disconnect`);
    try {
      await api.delete(`${API_BASE_URL}/organization/integrations/${provider}`);
      toast.success('Disconnected');
      await load();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Disconnect failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function createWebhook() {
    if (!whName.trim() || !whUrl.trim()) {
      toast.error('Enter a webhook name and target URL');
      return;
    }
    setBusyKey('webhook');
    try {
      const { data } = await api.post<{ webhook?: WebhookRow & { secret?: string } }>(
        `${API_BASE_URL}/organization/webhooks`,
        { name: whName.trim(), targetUrl: whUrl.trim(), events: whEvents },
      );
      setNewSecret(data.webhook?.secret ?? null);
      toast.success('Webhook created — copy the signing secret');
      setWhName('');
      setWhUrl('');
      await load();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Could not create webhook');
    } finally {
      setBusyKey(null);
    }
  }

  async function testWebhook(id: string) {
    setBusyKey(`webhook:${id}`);
    try {
      const { data } = await api.post<{
        delivery?: { ok: boolean; statusCode: number | null; error: string | null };
      }>(`${API_BASE_URL}/organization/webhooks/${id}/test`);
      if (data.delivery?.ok) toast.success(`Delivered (HTTP ${data.delivery.statusCode})`);
      else toast.error(data.delivery?.error ?? 'Delivery failed');
      await load();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Test failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function removeWebhook(id: string) {
    setBusyKey(`webhook-del:${id}`);
    await api.delete(`${API_BASE_URL}/organization/webhooks/${id}`);
    toast.success('Webhook removed');
    await load();
    setBusyKey(null);
  }

  function toggleEvent(ev: string) {
    setWhEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]));
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
      <EnterpriseCard title="How integrations work" icon={<Plug size={16} />}>
        <p className="text-sm text-slate-700 dark:text-gray-300 leading-relaxed">
          PinIT stays the security brain (DNA, vault, monitoring). Integrations are bridges to tools
          you already use. Live now:{' '}
          <strong className="text-slate-900 dark:text-white">Slack</strong>,{' '}
          <strong className="text-slate-900 dark:text-white">Teams</strong>,{' '}
          <strong className="text-slate-900 dark:text-white">Zapier</strong>,{' '}
          <strong className="text-slate-900 dark:text-white">Google Drive</strong>,{' '}
          <strong className="text-slate-900 dark:text-white">Dropbox</strong>, and{' '}
          <strong className="text-slate-900 dark:text-white">outbound Webhooks</strong>.
          Each Connect only affects that one service.
        </p>
      </EnterpriseCard>

      {(['SLACK', 'MICROSOFT_TEAMS', 'ZAPIER'] as BridgeKey[]).map((provider) => {
        const meta = BRIDGE_META[provider];
        const connectedNow = isConnected(provider);
        return (
          <EnterpriseCard key={provider} title={meta.title} icon={<Send size={16} />}>
            {connectedNow ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-green-300 font-semibold">
                  <CheckCircle2 size={16} /> Connected
                  {displayOf(provider) && (
                    <span className="text-slate-600 dark:text-gray-400 font-normal">
                      · {displayOf(provider)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <EnterpriseButton
                    onClick={() => void testBridge(provider)}
                    disabled={busyKey !== null}
                  >
                    <Send size={14} /> {isBusy(`${provider}:test`) ? 'Sending…' : 'Send test'}
                  </EnterpriseButton>
                  <EnterpriseButton
                    variant="danger"
                    onClick={() => void disconnect(provider)}
                    disabled={busyKey !== null}
                  >
                    <Unplug size={14} /> Disconnect
                  </EnterpriseButton>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-gray-400">{meta.hint}</p>
                <input
                  value={bridgeName[provider]}
                  onChange={(e) => setBridgeName((p) => ({ ...p, [provider]: e.target.value }))}
                  placeholder={meta.namePlaceholder}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border-2 border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white"
                />
                <input
                  value={bridgeUrl[provider]}
                  onChange={(e) => setBridgeUrl((p) => ({ ...p, [provider]: e.target.value }))}
                  placeholder={meta.placeholder}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border-2 border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white font-mono"
                />
                <EnterpriseButton
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void connectBridge(provider)}
                >
                  <Link2 size={14} /> {isBusy(provider) ? 'Connecting…' : `Connect ${meta.title}`}
                </EnterpriseButton>
              </div>
            )}
          </EnterpriseCard>
        );
      })}

      {(['GOOGLE_DRIVE', 'DROPBOX'] as StorageKey[]).map((provider) => {
        const meta = STORAGE_META[provider];
        const connectedNow = isConnected(provider);
        return (
          <EnterpriseCard key={provider} title={meta.title} icon={<Plug size={16} />}>
            {connectedNow ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-green-300 font-semibold">
                  <CheckCircle2 size={16} /> Connected
                  {displayOf(provider) && (
                    <span className="text-slate-600 dark:text-gray-400 font-normal">
                      · {displayOf(provider)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Account linked. Folder auto-import into Protect file ships next — test connection anytime.
                </p>
                <div className="flex flex-wrap gap-2">
                  <EnterpriseButton
                    onClick={() => void testStorage(provider)}
                    disabled={busyKey !== null}
                  >
                    <Send size={14} /> {isBusy(`${provider}:test`) ? 'Testing…' : 'Test connection'}
                  </EnterpriseButton>
                  <EnterpriseButton
                    variant="danger"
                    onClick={() => void disconnect(provider)}
                    disabled={busyKey !== null}
                  >
                    <Unplug size={14} /> Disconnect
                  </EnterpriseButton>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-gray-400">{meta.hint}</p>
                <input
                  value={storageToken[provider]}
                  onChange={(e) => setStorageToken((p) => ({ ...p, [provider]: e.target.value }))}
                  placeholder={meta.placeholder}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border-2 border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white font-mono"
                />
                <EnterpriseButton
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void connectStorage(provider)}
                >
                  <Link2 size={14} /> {isBusy(provider) ? 'Connecting…' : `Connect ${meta.title}`}
                </EnterpriseButton>
              </div>
            )}
          </EnterpriseCard>
        );
      })}

      <EnterpriseCard title="Outbound webhooks" icon={<Webhook size={16} />}>
        <p className="text-sm text-slate-600 dark:text-gray-400 mb-3">
          PinIT POSTs signed JSON to your URL when events happen — use this for PinIT Exchange or your
          own server. Tip: try{' '}
          <a
            href="https://webhook.site"
            target="_blank"
            rel="noreferrer"
            className="text-violet-700 underline"
          >
            webhook.site
          </a>{' '}
          for a free test URL.
        </p>

        {newSecret && (
          <div className="mb-4 rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100 mb-2">
              Signing secret (shown once) — verify <code className="text-xs">X-PinIT-Signature</code>
            </p>
            <code className="block text-xs break-all font-mono bg-white dark:bg-black/30 p-2 rounded-lg border border-amber-200">
              {newSecret}
            </code>
          </div>
        )}

        <div className="space-y-3 mb-4 pb-4 border-b border-slate-200 dark:border-bg-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              placeholder="Name (e.g. Exchange)"
              className="px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border-2 border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white"
            />
            <input
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              placeholder="https://your-server.com/pinit-hook"
              className="px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border-2 border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white font-mono"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {EVENT_OPTIONS.map((ev) => (
              <button
                key={ev}
                type="button"
                onClick={() => toggleEvent(ev)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${
                  whEvents.includes(ev)
                    ? 'bg-violet-700 text-white border-violet-800'
                    : 'bg-white text-slate-700 border-slate-300 dark:bg-bg-elevated dark:text-gray-300 dark:border-bg-border'
                }`}
                style={whEvents.includes(ev) ? { color: '#fff' } : undefined}
              >
                {ev}
              </button>
            ))}
          </div>
          <EnterpriseButton type="button" disabled={busyKey !== null} onClick={() => void createWebhook()}>
            <Plus size={14} /> {isBusy('webhook') ? 'Creating…' : 'Create webhook'}
          </EnterpriseButton>
        </div>

        {webhooks.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-gray-400 text-center py-4">No webhooks yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-bg-border">
            {webhooks.map((w) => (
              <li
                key={w.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    {w.name}
                    {!w.isActive && <span className="text-xs text-amber-700">Paused</span>}
                  </p>
                  <p className="text-xs text-slate-500 font-mono truncate">{w.targetUrl}</p>
                  <p className="text-xs text-slate-500 mt-1">{w.events.join(', ')}</p>
                  {w.lastDeliveryAt && (
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                      <Clock size={10} />
                      Last: {w.lastStatusCode ?? '—'}
                      {w.lastError ? ` · ${w.lastError}` : ' · OK'}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <EnterpriseButton
                    variant="secondary"
                    onClick={() => void testWebhook(w.id)}
                    disabled={busyKey !== null}
                    className="!px-3 !py-2"
                  >
                    <Send size={14} /> Test
                  </EnterpriseButton>
                  <EnterpriseButton
                    variant="danger"
                    onClick={() => void removeWebhook(w.id)}
                    disabled={busyKey !== null}
                    className="!px-3 !py-2"
                  >
                    <Trash2 size={14} />
                  </EnterpriseButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </div>
  );
}
