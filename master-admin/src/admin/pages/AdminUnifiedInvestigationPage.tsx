import { ExternalLink, ShieldCheck } from 'lucide-react';

const HUB_APP_URL = ((import.meta as any).env?.VITE_HUB_APP_URL as string | undefined) ?? 'http://localhost:3002';

/**
 * The full investigation upload/scan tool lives in the Hub SPA (a large,
 * deeply-integrated page with its own component tree) — not duplicated here.
 * Open it in the Hub app you're already signed into rather than re-embed it.
 */
export function AdminUnifiedInvestigationPage() {
  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck size={22} className="text-indigo-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Investigation tool runs in PinitHUB</h2>
        <p className="text-sm text-gray-500 mb-5">
          Uploading, scanning and comparing files for tampering happens in the main Hub app —
          it's not duplicated in Master Admin. Open it in the tab where you're signed in to Hub.
        </p>
        <a
          href={`${HUB_APP_URL}/pinit-hub/investigation`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          Open Investigation Tool <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}
