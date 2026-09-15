import { ShieldOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const HUB_APP_URL = ((import.meta as any).env?.VITE_HUB_APP_URL as string | undefined) ?? 'http://localhost:3002';

/** Shown when a signed-in user's role grants no admin capability (Phase 2 RBAC — plain USER). */
export function AccessDeniedPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <ShieldOff size={22} className="text-red-500" />
        </div>
        <h1 className="text-base font-semibold text-gray-900 mb-1">No admin access</h1>
        <p className="text-sm text-gray-500 mb-1">
          {user?.shortId} is signed in, but its role doesn't grant any Master Admin capability.
        </p>
        <p className="text-sm text-gray-500 mb-5">
          Ask a platform owner to elevate this account's role, then relaunch from PinitHUB.
        </p>
        <div className="flex items-center justify-center gap-3">
          <a href={HUB_APP_URL} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">
            Back to PinitHUB
          </a>
          <button
            type="button"
            onClick={() => logout()}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
