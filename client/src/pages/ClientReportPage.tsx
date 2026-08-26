/**
 * The client-facing report page.
 *
 * Public, like the share viewer — the token in the URL is the whole authority,
 * so this page sends no auth header and holds no session. It fetches the frozen
 * snapshot and renders it with the same component the team previews, which is
 * what makes "what you checked is what they see" true rather than aspirational.
 *
 * Every failure looks the same to a visitor with a bad link: the page does not
 * distinguish "never existed" from "revoked", because that distinction is only
 * useful to someone guessing tokens.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { FileText, AlertTriangle, RefreshCw, Loader2, Download, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../config/api.config';
import { ClientReportView } from '../components/business/review/CaseEvidence';
import type { ClientReportSnapshot } from '../services/business.api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: ClientReportSnapshot }
  | { kind: 'gone'; message: string }
  | { kind: 'error'; message: string };

export function ClientReportPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      // Bare axios on purpose: this page is public and must not attach a token.
      const { data } = await axios.get<{ success: boolean; report: ClientReportSnapshot }>(
        `${API_BASE_URL}/share/client-report/${encodeURIComponent(token)}`,
      );
      setState({ kind: 'ready', snapshot: data.report });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setState({
          kind: 'gone',
          message: 'This report link is not valid. It may have been withdrawn, or the address may be incomplete.',
        });
      } else if (status === 410) {
        setState({
          kind: 'gone',
          message: 'This report has expired. Ask whoever sent it for a fresh link.',
        });
      } else {
        setState({
          kind: 'error',
          message: 'We could not load the report just now. Please try again.',
        });
      }
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-bg-base">
      <header className="border-b border-bg-border bg-bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-2">
          <FileText size={18} className="text-dna-400" />
          <span className="text-sm font-semibold text-white">Protection report</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {state.kind === 'loading' && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Loader2 size={22} className="text-dna-400 animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading your report…</p>
          </div>
        )}

        {state.kind === 'gone' && (
          <div className="rounded-xl border border-bg-border bg-bg-card px-6 py-12 text-center">
            <ShieldCheck size={24} className="text-gray-500 mx-auto mb-3" />
            <h1 className="text-base font-semibold text-white mb-1.5">Report unavailable</h1>
            <p className="text-sm text-gray-400 max-w-md mx-auto">{state.message}</p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="rounded-xl border border-danger/30 bg-danger/5 px-6 py-12 text-center">
            <AlertTriangle size={24} className="text-danger mx-auto mb-3" />
            <h1 className="text-base font-semibold text-white mb-1.5">Something went wrong</h1>
            <p className="text-sm text-gray-400 mb-4 max-w-md mx-auto">{state.message}</p>
            <button type="button" onClick={load}
              className="btn btn-secondary text-xs inline-flex items-center gap-1.5">
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <ClientReportView snapshot={state.snapshot} />

            <div className="mt-8 pt-5 border-t border-bg-border flex items-center justify-between gap-3 flex-wrap">
              <p className="text-2xs text-gray-600">
                Sealed when issued. Reference {state.snapshot.reportCode}.
              </p>
              <a
                href={`${API_BASE_URL}/share/client-report/${encodeURIComponent(token)}/pdf`}
                target="_blank" rel="noreferrer noopener"
                className="btn btn-secondary text-xs inline-flex items-center gap-1.5"
              >
                <Download size={13} /> Download PDF
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
