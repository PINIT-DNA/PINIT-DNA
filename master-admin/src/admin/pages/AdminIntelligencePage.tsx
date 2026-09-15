import { useParams } from 'react-router-dom';
import { ExternalLink, FileSearch } from 'lucide-react';

const HUB_APP_URL = ((import.meta as any).env?.VITE_HUB_APP_URL as string | undefined) ?? 'http://localhost:3002';

/**
 * The full per-asset intelligence report (identity/provenance/integrity/
 * discovery/distribution/risk) uses the Hub SPA's dark theme + custom design
 * tokens throughout — not reskinned here. Deep-link into Hub instead of
 * shipping a half-restyled copy.
 */
export function AdminIntelligencePage() {
  const { vaultId } = useParams<{ vaultId: string }>();

  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
          <FileSearch size={22} className="text-indigo-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Full intelligence report opens in PinitHUB</h2>
        <p className="text-sm text-gray-500 mb-5">
          The detailed identity, provenance, integrity, discovery, distribution and risk
          report for this asset renders in the main Hub app.
        </p>
        {vaultId && (
          <a
            href={`${HUB_APP_URL}/intelligence/${vaultId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            Open Intelligence Report <ExternalLink size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
