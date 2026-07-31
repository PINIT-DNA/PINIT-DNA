/**
 * Extension OAuth connect page — Hub issues a short-lived code for the Chrome extension.
 *
 * Standalone route (no DashboardLayout) — must host its own Toaster and inline errors,
 * otherwise Authorize failures look like a dead button.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, Check, Copy, Loader2 } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { API_BASE_URL } from '../../config/api.config';
import { api, formatApiError } from '../../services/dashboard.api';
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
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const ready = useMemo(() => !!extensionId && !!user, [extensionId, user]);

  const issue = async () => {
    if (!extensionId) {
      const msg = 'Missing extension ID — open this page from the PinIT extension Sign in button';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!user) {
      const msg = 'Not signed in — complete Hub login, then return here';
      setError(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    setError(null);
    setStatus('Contacting Hub API… (Render may take up to ~60s to wake)');
    try {
      const { data } = await api.post<{
        success?: boolean;
        code?: string;
        expiresAt?: string;
        error?: string;
      }>(
        `${API_BASE_URL}/auth/extension/issue-code`,
        { extensionId },
        { timeout: 90_000 },
      );
      const issuedCode = data?.code;
      if (!issuedCode) {
        throw new Error(data?.error || 'No code returned from Hub API');
      }
      setCode(issuedCode);
      setExpiresAt(data.expiresAt ?? null);
      setStatus('Code issued — paste it in the extension popup, then click Connect');
      try {
        window.postMessage(
          {
            type: 'PINIT_EXTENSION_AUTH_CODE',
            code: issuedCode,
            extensionId,
            expiresAt: data.expiresAt,
          },
          '*',
        );
      } catch {
        /* ignore */
      }
      toast.success('Auth code ready — return to the extension');
    } catch (err) {
      const msg =
        formatApiError(err) ||
        'Could not issue extension auth code. Wait for the API to wake, then retry.';
      setError(msg);
      setStatus(null);
      toast.error(msg);
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
      <Toaster
        position="top-center"
        containerStyle={{ top: 16, zIndex: 9999 }}
        toastOptions={{
          duration: 5000,
          style: {
            background: '#ffffff',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            fontSize: '13px',
            maxWidth: 'min(100vw - 24px, 380px)',
          },
        }}
      />
      <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-card p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-dna-500/15 flex items-center justify-center">
            <Shield className="text-dna-400" size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Connect {BRAND.name}</h1>
            <p className="text-xs text-gray-500">Chrome extension · Publish Guardian</p>
          </div>
        </div>

        <p className="text-sm text-gray-400">
          Signed in as <span className="text-white font-medium">{user?.shortId ?? '…'}</span>.
          Approve once to let the extension protect posts and verify media with your account.
        </p>

        <p className="text-2xs text-gray-500 break-all">
          API: {API_BASE_URL}
          {extensionId ? ` · ext ${extensionId.slice(0, 8)}…` : ''}
        </p>

        {!extensionId && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            Open this page from the extension Sign-in button so the extension ID is included.
          </div>
        )}

        {status && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
            {status}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-100 space-y-2">
            <p>{error}</p>
            <p className="text-rose-200/80">
              If the Hub API is waking up on Render, wait about a minute and click Authorize again.
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={!ready || loading}
          onClick={() => void issue()}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
          {loading ? 'Issuing code…' : error ? 'Retry authorize' : 'Authorize extension'}
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
                Expires {new Date(expiresAt).toLocaleTimeString()} — paste in the extension if not
                auto-detected.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
