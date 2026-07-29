/**
 * Extension OAuth connect page — Hub issues a short-lived code for the Chrome extension.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, Check, Copy, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config/api.config';
import { api } from '../../services/dashboard.api';
import { useAuth } from '../../context/AuthContext';
import { BRAND } from '../../config/brand.config';

export function ExtensionAuthPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const extensionId = params.get('ext_id') ?? '';
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const ready = useMemo(() => !!extensionId && !!user, [extensionId, user]);

  const issue = async () => {
    if (!extensionId) {
      toast.error('Missing extension ID — open this page from the PinIT extension');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<{ code: string; expiresAt: string }>(
        `${API_BASE_URL}/auth/extension/issue-code`,
        { extensionId },
      );
      setCode(data.code);
      setExpiresAt(data.expiresAt);
      // Notify extension if opened as a connected window
      try {
        window.postMessage(
          { type: 'PINIT_EXTENSION_AUTH_CODE', code: data.code, extensionId, expiresAt: data.expiresAt },
          '*',
        );
      } catch {
        /* ignore */
      }
      toast.success('Auth code ready — return to the extension');
    } catch {
      toast.error('Could not issue extension auth code');
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-card p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-dna-500/15 flex items-center justify-center">
            <Shield className="text-dna-400" size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Connect Chrome Extension</h1>
            <p className="text-xs text-gray-500">{BRAND.name} Publish Guardian</p>
          </div>
        </div>

        <p className="text-sm text-gray-400">
          Signed in as <span className="text-white font-medium">{user?.shortId ?? '…'}</span>.
          Approve once to let the extension protect posts and verify media with your account.
        </p>

        {!extensionId && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Open this page from the extension Sign-in button so the extension ID is included.
          </div>
        )}

        <button
          type="button"
          disabled={!ready || loading}
          onClick={() => void issue()}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
          {loading ? 'Issuing code…' : 'Authorize extension'}
        </button>

        {code && (
          <div className="rounded-xl border border-dna-500/30 bg-dna-500/5 p-3 space-y-2">
            <p className="text-2xs text-gray-500 uppercase tracking-wider">One-time code</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-white break-all mono bg-bg-elevated rounded-lg px-2 py-2">
                {code}
              </code>
              <button type="button" onClick={() => void copy()} className="btn-ghost btn-icon">
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
            {expiresAt && (
              <p className="text-2xs text-gray-500">
                Expires {new Date(expiresAt).toLocaleTimeString()} — paste in the extension if not auto-detected.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
