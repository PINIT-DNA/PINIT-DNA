/**
 * The client's handover page.
 *
 * Deliberately not the Business Account: light, calm, and containing only the
 * finished work. Someone receiving their files should not have to navigate a
 * workspace built for the team who made them.
 *
 * Every field here comes from the handover endpoint, which only ever reads the
 * handover's own asset rows — there is no campaign, no other asset and no
 * internal identifier to leak, because none is fetched.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  PackageCheck, ShieldCheck, Check, Download, Eye, AlertTriangle,
  RefreshCw, Loader2, FileText, Calendar,
} from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

interface HandoverAsset {
  filename: string;
  assetType: string | null;
  sizeBytes: number;
  versionNumber: number | null;
  changeSummary: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  certificateId: string | null;
  certificateStatus: string | null;
  certificateIssuedAt: string | null;
  protected: boolean;
  viewToken: string | null;
}

interface HandoverView {
  title: string;
  note: string | null;
  campaignName: string;
  recipientLabel: string;
  handedOverAt: string;
  expiresAt: string | null;
  assets: HandoverAsset[];
}

export function HandoverPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<HandoverView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; gone: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: res } = await axios.get<{ success: boolean; handover: HandoverView }>(
        `${API_BASE_URL}/share/handover/${token}`,
      );
      setData(res.handover);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'This handover could not be opened.';
      // 403/404 are the expected "no longer available" answers, not faults.
      setError({ message: msg, gone: status === 403 || status === 404 });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Opening your handover…
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle size={22} className="text-gray-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-1">
            {error.gone ? 'This handover is no longer available' : 'Something went wrong'}
          </h1>
          <p className="text-sm text-gray-600 mb-5 max-w-sm mx-auto">{error.message}</p>
          {error.gone ? (
            <p className="text-xs text-gray-500">
              If you still need these files, contact the team who sent them.
            </p>
          ) : (
            <button type="button" onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2
                         text-sm font-semibold text-white hover:bg-gray-800">
              <RefreshCw size={14} /> Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (!data) return null;

  return (
    <Shell>
      {/* Header — what this is, from whom, when */}
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 mb-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50
                           border border-emerald-200 px-2.5 py-1">
            <PackageCheck size={12} /> Final delivery
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-1">
          {data.title}
        </h1>
        <p className="text-sm text-gray-600">
          {data.campaignName && <>{data.campaignName} · </>}
          For {data.recipientLabel}
        </p>
        <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1.5">
          <Calendar size={11} />
          Handed over {new Date(data.handedOverAt).toLocaleDateString(undefined,
            { day: 'numeric', month: 'long', year: 'numeric' })}
          {data.expiresAt && (
            <> · available until {new Date(data.expiresAt).toLocaleDateString()}</>
          )}
        </p>
      </header>

      {data.note && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 mb-5">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.note}</p>
        </div>
      )}

      {/* Assets */}
      {data.assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center">
          <FileText size={22} className="text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-900 mb-0.5">No files in this handover</p>
          <p className="text-xs text-gray-600">Contact the team who sent it.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.assets.map((a, i) => <AssetCard key={`${a.filename}-${i}`} asset={a} />)}
        </ul>
      )}

      <footer className="mt-8 pt-5 border-t border-gray-200">
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-emerald-600" />
          Each file is protected by Pinit. The certificate shown proves it is the version that was
          approved.
        </p>
      </footer>
    </Shell>
  );
}

function AssetCard({ asset: a }: { asset: HandoverAsset }) {
  return (
    <li className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{a.filename}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {a.versionNumber !== null && <>Version {a.versionNumber}</>}
              {a.sizeBytes > 0 && <> · {formatBytes(a.sizeBytes)}</>}
            </p>
          </div>
          {a.approvedBy && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200
                             bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700
                             whitespace-nowrap">
              <Check size={12} /> Approved
            </span>
          )}
        </div>

        {a.changeSummary && (
          <p className="text-sm text-gray-600 mt-2">{a.changeSummary}</p>
        )}

        {/* Approval evidence */}
        {a.approvedBy && (
          <div className="mt-3 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5">
            <p className="text-xs text-gray-700">
              Approved by <span className="font-semibold">{a.approvedBy}</span>
              {a.approvedAt && (
                <> on {new Date(a.approvedAt).toLocaleDateString(undefined,
                  { day: 'numeric', month: 'short', year: 'numeric' })}</>
              )}
            </p>
            {a.approvalNote && (
              <p className="text-xs text-gray-600 italic mt-1">“{a.approvalNote}”</p>
            )}
          </div>
        )}

        {/* Protection */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {a.protected && (
            <span className="text-xs text-gray-600 inline-flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-emerald-600" /> Protected by Pinit
            </span>
          )}
          {a.certificateId && (
            <span className="text-xs text-gray-500 inline-flex items-center gap-1.5 min-w-0">
              Certificate
              <code className="font-mono text-2xs bg-gray-100 border border-gray-200 rounded
                               px-1.5 py-0.5 truncate max-w-[180px]" title={a.certificateId}>
                {a.certificateId}
              </code>
            </span>
          )}
        </div>
      </div>

      {a.viewToken && (
        <div className="px-4 sm:px-5 py-3 border-t border-gray-200 bg-gray-50/60
                        flex flex-wrap items-center gap-2">
          <a
            href={`/s/${a.viewToken}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2
                       text-sm font-semibold text-white hover:bg-gray-800"
          >
            <Eye size={14} /> Open file
          </a>
          <span className="text-xs text-gray-500 inline-flex items-center gap-1.5">
            <Download size={11} /> Download is available inside, if the sender allowed it.
          </span>
        </div>
      )}
    </li>
  );
}

/** Light, self-contained chrome — nothing from the Business Account. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center">
            <ShieldCheck size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold text-gray-900">Pinit</span>
          <span className="text-xs text-gray-400 ml-auto">Secure handover</span>
        </div>
      </div>
      <main className={cn('max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10')}>{children}</main>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
