import { LogIn } from 'lucide-react';

const HUB_APP_URL = ((import.meta as any).env?.VITE_HUB_APP_URL as string | undefined) ?? 'http://localhost:3002';

/**
 * Shown when there's no valid session. This app has no login form of its
 * own — Hub has no password login either — so the only way in is the SSO
 * bridge launched from an already-logged-in Hub session.
 */
export function SessionExpiredPage() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
          <LogIn size={22} className="text-indigo-600" />
        </div>
        <h1 className="text-base font-semibold text-gray-900 mb-1">Not signed in</h1>
        <p className="text-sm text-gray-500 mb-5">
          Master Admin doesn't have its own sign-in form. Open it from your PinitHUB dashboard instead —
          look for "Open Master Admin" once you're signed in there.
        </p>
        <a
          href={HUB_APP_URL}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          Go to PinitHUB
        </a>
      </div>
    </div>
  );
}
