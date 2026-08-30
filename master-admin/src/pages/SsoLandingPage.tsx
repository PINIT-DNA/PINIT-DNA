import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '../config/api.config';
import { saveAccessToken } from '../lib/auth';

const HUB_APP_URL = ((import.meta as any).env?.VITE_HUB_APP_URL as string | undefined) ?? 'http://localhost:3002';

/**
 * Landing point for the Hub -> Master Admin SSO handoff. Exchanges the
 * short-lived bridge token for a real Hub session JWT, stores it under this
 * app's own localStorage key, then does a full reload into "/" so
 * AuthContext picks up the fresh token from scratch.
 */
export function SsoLandingPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setError('No bridge token in the URL — open Master Admin from your PinitHUB dashboard.');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/admin-bridge/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? 'Bridge token exchange failed');
        }
        saveAccessToken(data.accessToken);
        window.location.replace('/');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not sign you in');
      }
    })();
  }, [params]);

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <AlertTriangle size={32} className="text-amber-500 mx-auto mb-3" />
          <h1 className="text-base font-semibold text-gray-900 mb-1">Sign-in link expired or invalid</h1>
          <p className="text-sm text-gray-500 mb-5">{error}</p>
          <a
            href={HUB_APP_URL}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            Open PinitHUB
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}
